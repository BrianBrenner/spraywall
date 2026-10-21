import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSeeded } from '../db';
import type { Climb } from '../types';
import { exportAll, importAll } from './transfer';

const climb = (id: string): Climb => ({
  id,
  wallId: 'w1',
  versionId: 'v1',
  name: `Climb ${id}`,
  gradeSystemId: 'v-font',
  grade: 'V3 / 6A+',
  footRuleId: 'no-kicker',
  noMatching: true,
  tagIds: [],
  notes: '',
  holds: [{ holdId: 'h1', role: 'start' }],
  thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
  createdAt: 1,
  updatedAt: 1,
});

async function seedWall() {
  await db.walls.put({ id: 'w1', name: 'Garage', createdAt: 1 });
  await db.versions.put({
    id: 'v1',
    wallId: 'w1',
    number: 1,
    image: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    width: 100,
    height: 80,
    holds: [{ id: 'h1', shape: { type: 'ellipse', cx: 10, cy: 10, rx: 5, ry: 5 } }],
    createdAt: 1,
  });
  await db.climbs.put(climb('c1'));
  await db.lists.put({ id: 'l1', name: 'Warm-ups', climbIds: ['c1'], createdAt: 1 });
}

describe('export / import', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await ensureSeeded();
    await seedWall();
  });

  it('round-trips everything except thumbnails through replace', async () => {
    const zip = await exportAll();
    await Promise.all(db.tables.map((t) => t.clear()));

    const summary = await importAll(zip, 'replace');
    expect(summary).toEqual({ walls: 1, climbs: 1, lists: 1 });
    const version = await db.versions.get('v1');
    expect(new Uint8Array(await version!.image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(version!.holds).toHaveLength(1);
    const c = await db.climbs.get('c1');
    expect(c).toMatchObject({ grade: 'V3 / 6A+', noMatching: true, footRuleId: 'no-kicker' });
    expect(c!.thumbnail).toBeUndefined();
    expect(await db.gradeSystems.count()).toBe(1);
  });

  it('merge keeps local records and adds only new ones', async () => {
    const zip = await exportAll();
    await db.climbs.update('c1', { name: 'Renamed locally' });
    await db.climbs.put(climb('c2'));

    const summary = await importAll(zip, 'merge');
    expect(summary.climbs).toBe(0);
    expect((await db.climbs.get('c1'))!.name).toBe('Renamed locally');
    expect(await db.climbs.count()).toBe(2);

    await db.climbs.delete('c1');
    expect((await importAll(zip, 'merge')).climbs).toBe(1);
  });

  it('rejects files that are not exports', async () => {
    await expect(importAll(new Blob(['nope']), 'merge')).rejects.toThrow();
  });
});
