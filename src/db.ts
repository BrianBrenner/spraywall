import Dexie, { type EntityTable } from 'dexie';
import { backend } from './lib/config';
import type {
  AppSettings,
  Climb,
  ClimbList,
  FootRule,
  GradeSystem,
  Tag,
  Tick,
  Wall,
  WallVersion,
} from './types';

// Server mode keeps its cache apart from any walls made locally before the server existed.
export const db = new Dexie(backend ? 'spraywall-cloud' : 'spraywall') as Dexie & {
  walls: EntityTable<Wall, 'id'>;
  versions: EntityTable<WallVersion, 'id'>;
  climbs: EntityTable<Climb, 'id'>;
  lists: EntityTable<ClimbList, 'id'>;
  gradeSystems: EntityTable<GradeSystem, 'id'>;
  footRules: EntityTable<FootRule, 'id'>;
  tags: EntityTable<Tag, 'id'>;
  settings: EntityTable<AppSettings, 'id'>;
  ticks: EntityTable<Tick, 'id'>;
};

db.version(1).stores({
  walls: 'id, createdAt',
  versions: 'id, wallId, [wallId+number]',
  climbs: 'id, wallId, versionId, updatedAt',
  lists: 'id, createdAt',
  gradeSystems: 'id',
  footRules: 'id',
  tags: 'id',
  settings: 'id',
});

// v2: role colours changed, so drop thumbnails drawn with the old ones; ensureThumbnails() redraws them.
db.version(2).upgrade((tx) =>
  tx.table('climbs').toCollection().modify((c: Climb) => {
    delete c.thumbnail;
  }),
);

// v3: the built-in foot rules became Open kicker / No kicker / Footless.
const OLD_FOOT_RULES: Record<string, string> = {
  'any-feet': 'open-kicker',
  'feet-follow-hands': 'no-kicker',
  'no-kickboard': 'no-kicker',
  'follow-plus-kickboard': 'open-kicker',
  'kickboard-only': 'open-kicker',
};
db.version(3).upgrade(async (tx) => {
  const rules = tx.table('footRules');
  if (!(await rules.count())) return; // Fresh install; ensureSeeded() adds the new rules.
  await rules.bulkDelete(Object.keys(OLD_FOOT_RULES));
  await rules.bulkPut(DEFAULT_FOOT_RULES);
  await tx.table('climbs').toCollection().modify((c: Climb) => {
    c.footRuleId = OLD_FOOT_RULES[c.footRuleId] ?? c.footRuleId;
  });
  await tx.table('settings').toCollection().modify((st: AppSettings) => {
    st.defaultFootRuleId = OLD_FOOT_RULES[st.defaultFootRuleId] ?? st.defaultFootRuleId;
  });
});

// v4: V-scale and Font merged into one combined scale.
db.version(4).upgrade(async (tx) => {
  const systems = tx.table('gradeSystems');
  if (!(await systems.count())) return; // Fresh install; ensureSeeded() adds the scale.
  await systems.bulkDelete(['v-scale', 'font']);
  await systems.bulkPut(DEFAULT_GRADE_SYSTEMS);
  await tx.table('climbs').toCollection().modify((c: Climb) => {
    if (c.gradeSystemId !== 'v-scale' && c.gradeSystemId !== 'font') return;
    c.grade = c.grade ? combinedGrade(c.grade) ?? c.grade : '';
    c.gradeSystemId = COMBINED_ID;
  });
  await tx.table('settings').toCollection().modify((st: AppSettings) => {
    if (st.defaultGradeSystemId === 'v-scale' || st.defaultGradeSystemId === 'font') st.defaultGradeSystemId = COMBINED_ID;
  });
});

// v5: the combined scale lists every Font grade (two V4s: 6B and 6B+, etc.).
db.version(5).upgrade(async (tx) => {
  const systems = tx.table('gradeSystems');
  if (await systems.get(COMBINED_ID)) await systems.put(DEFAULT_GRADE_SYSTEMS[0]);
});

// v6: ticks (server mode).
db.version(6).stores({ ticks: 'id, climbId, userId' });

export const newId = () => crypto.randomUUID();

const COMBINED_ID = 'v-font';

/** Every Font grade with its usual V equivalent, easiest first. */
const FONT_V: [string, string][] = [
  ['3', 'VB'],
  ['4', 'V0'],
  ['4+', 'V0'],
  ['5', 'V1'],
  ['5+', 'V2'],
  ['6A', 'V3'],
  ['6A+', 'V3'],
  ['6B', 'V4'],
  ['6B+', 'V4'],
  ['6C', 'V5'],
  ['6C+', 'V5'],
  ['7A', 'V6'],
  ['7A+', 'V7'],
  ['7B', 'V8'],
  ['7B+', 'V8'],
  ['7C', 'V9'],
  ['7C+', 'V10'],
  ['8A', 'V11'],
  ['8A+', 'V12'],
  ['8B', 'V13'],
  ['8B+', 'V14'],
  ['8C', 'V15'],
  ['8C+', 'V16'],
  ['9A', 'V17'],
];

/** Combined label for a V or Font grade, e.g. "6B" → "V4 / 6B" (a bare V grade takes its first Font grade). */
export function combinedGrade(grade: string): string | undefined {
  const row = FONT_V.find(([f, v]) => f === grade || v === grade);
  return row && `${row[1]} / ${row[0]}`;
}

export const DEFAULT_GRADE_SYSTEMS: GradeSystem[] = [
  { id: COMBINED_ID, name: 'V / Font', grades: FONT_V.map(([f, v]) => `${v} / ${f}`) },
];

export const DEFAULT_FOOT_RULES: FootRule[] = [
  { id: 'open-kicker', name: 'Open kicker', description: 'Marked foot holds plus anything on the kickboard.' },
  { id: 'no-kicker', name: 'No kicker', description: 'Marked foot holds only; the kickboard is off.' },
  { id: 'footless', name: 'Footless', description: 'Campus it.' },
];

const DEFAULT_TAGS = ['Crimpy', 'Slopey', 'Pinchy', 'Compression', 'Dyno', 'Powerful', 'Technical', 'Heel hook', 'Toe hook'];

/** Seed settings and defaults on first run. Safe to call repeatedly. */
export async function ensureSeeded() {
  await db.transaction('rw', [db.settings, db.gradeSystems, db.footRules, db.tags], async () => {
    if (await db.settings.get('app')) return;
    await db.gradeSystems.bulkPut(DEFAULT_GRADE_SYSTEMS);
    await db.footRules.bulkPut(DEFAULT_FOOT_RULES);
    await db.tags.bulkPut(DEFAULT_TAGS.map((name) => ({ id: newId(), name })));
    await db.settings.put({ id: 'app', defaultGradeSystemId: COMBINED_ID, defaultFootRuleId: 'open-kicker' });
  });
}

/** Ask the browser not to evict our data (Safari is aggressive about this). */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function latestVersion(wallId: string) {
  return db.versions.where('[wallId+number]').between([wallId, Dexie.minKey], [wallId, Dexie.maxKey]).last();
}

/** Local-cache deletes. Pages go through lib/mutations, which also tells the server. */
export async function deleteClimbs(ids: string[]) {
  await db.transaction('rw', [db.climbs, db.lists, db.ticks], async () => {
    await db.climbs.bulkDelete(ids);
    await db.ticks.where('climbId').anyOf(ids).delete();
    const gone = new Set(ids);
    await db.lists.toCollection().modify((l) => {
      l.climbIds = l.climbIds.filter((id) => !gone.has(id));
    });
  });
}

export async function deleteWall(wallId: string) {
  const climbIds = (await db.climbs.where('wallId').equals(wallId).primaryKeys()) as string[];
  await deleteClimbs(climbIds);
  await db.transaction('rw', [db.walls, db.versions], async () => {
    await db.versions.where('wallId').equals(wallId).delete();
    await db.walls.delete(wallId);
  });
}

export async function deleteVersion(versionId: string) {
  const climbIds = (await db.climbs.where('versionId').equals(versionId).primaryKeys()) as string[];
  await deleteClimbs(climbIds);
  await db.versions.delete(versionId);
}
