import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Climb, GradeSystem, Tick } from '../types';
import { useSession } from './auth';

export interface TickStats {
  count: number;
  /** Average of the stars people gave (ignoring ticks with none), or 0. */
  stars: number;
  /** Median of people's grade opinions, when anyone gave one. */
  consensus?: string;
  /** The signed-in climber's own tick. */
  mine?: Tick;
  ticks: Tick[];
}

export function statsFor(ticks: Tick[], system: GradeSystem | undefined, me?: string): TickStats {
  const rated = ticks.filter((t) => t.stars > 0);
  const graded = ticks
    .map((t) => system?.grades.indexOf(t.grade) ?? -1)
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  return {
    count: ticks.length,
    stars: rated.length ? rated.reduce((s, t) => s + t.stars, 0) / rated.length : 0,
    consensus: graded.length ? system!.grades[graded[Math.floor((graded.length - 1) / 2)]] : undefined,
    mine: me ? ticks.find((t) => t.userId === me) : undefined,
    ticks: [...ticks].sort((a, b) => b.date - a.date),
  };
}

const EMPTY: TickStats = { count: 0, stars: 0, ticks: [] };

/** Tick stats for every climb, live. `get(climb)` is cheap to call per row. */
export function useTickStats(gradeSystem: (id: string) => GradeSystem | undefined) {
  const session = useSession();
  const ticks = useLiveQuery(() => db.ticks.toArray(), []);
  const byClimb = new Map<string, Tick[]>();
  for (const t of ticks ?? []) byClimb.set(t.climbId, [...(byClimb.get(t.climbId) ?? []), t]);
  return (climb: Pick<Climb, 'id' | 'gradeSystemId'>): TickStats => {
    const list = byClimb.get(climb.id);
    return list ? statsFor(list, gradeSystem(climb.gradeSystemId), session?.sub) : EMPTY;
  };
}
