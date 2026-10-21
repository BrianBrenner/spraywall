import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, DEFAULT_FOOT_RULES, DEFAULT_GRADE_SYSTEMS } from '../db';
import type { FootRule, GradeSystem, Tag } from '../types';

export interface Catalog {
  gradeSystems: GradeSystem[];
  footRules: FootRule[];
  tags: Tag[];
  gradeSystem: (id: string) => GradeSystem | undefined;
  footRule: (id: string) => FootRule | undefined;
  tag: (id: string) => Tag | undefined;
  defaultGradeSystemId: string;
  defaultFootRuleId: string;
}

/** Grade systems, foot rules, tags and defaults, kept live. */
export function useCatalog(): Catalog | undefined {
  return useLiveQuery(async () => {
    const [gradeSystems, footRules, tags, settings] = await Promise.all([
      db.gradeSystems.toArray(),
      db.footRules.toArray(),
      db.tags.toArray(),
      db.settings.get('app'),
    ]);
    tags.sort((a, b) => a.name.localeCompare(b.name));
    gradeSystems.sort(builtInsFirst(DEFAULT_GRADE_SYSTEMS));
    footRules.sort(builtInsFirst(DEFAULT_FOOT_RULES));
    const gs = new Map(gradeSystems.map((g) => [g.id, g]));
    const fr = new Map(footRules.map((f) => [f.id, f]));
    const tg = new Map(tags.map((t) => [t.id, t]));
    return {
      gradeSystems,
      footRules,
      tags,
      gradeSystem: (id: string) => gs.get(id),
      footRule: (id: string) => fr.get(id),
      tag: (id: string) => tg.get(id),
      defaultGradeSystemId: settings?.defaultGradeSystemId ?? gradeSystems[0]?.id ?? '',
      defaultFootRuleId: settings?.defaultFootRuleId ?? footRules[0]?.id ?? '',
    };
  });
}

/** Built-in entries in their defined order, then custom ones by name. */
function builtInsFirst(builtIns: { id: string }[]) {
  const rank = (id: string) => {
    const i = builtIns.findIndex((b) => b.id === id);
    return i < 0 ? builtIns.length : i;
  };
  return (a: { id: string; name: string }, b: { id: string; name: string }) =>
    rank(a.id) - rank(b.id) || a.name.localeCompare(b.name);
}

/** Index of a grade within its system, for sorting and range filters. Unknown grades sort last. */
export function gradeIndex(system: GradeSystem | undefined, grade: string) {
  const i = system?.grades.indexOf(grade) ?? -1;
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

/** useState persisted to localStorage (per-device conveniences like filters). */
export function useStoredState<T extends object>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private mode etc. — filters just won't persist.
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/** Keep the screen on while mounted (climbing view). */
export function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
        if (cancelled) lock?.release();
      } catch {
        // Not supported or denied; nothing to do.
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && acquire();
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release();
    };
  }, []);
}

const QUEUE_KEY = 'climb-queue';

/** The ordered climbs the climbing view steps through (current filter results or a list). */
export function setClimbQueue(ids: string[]) {
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(ids));
  } catch {
    // Prev/next just won't be available.
  }
}

export function getClimbQueue(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}
