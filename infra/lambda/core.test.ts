import { beforeEach, describe, expect, it } from 'vitest';
import { handle, memoryRepo, type Claims, type Deps } from './core';

const OWNER: Claims = { sub: 'owner-sub', email: 'Me@Example.com', email_verified: 'true', name: 'Brian' };
const ALEX: Claims = { sub: 'alex-sub', email: 'alex@example.com', email_verified: 'true', name: 'Alex' };
const SAM: Claims = { sub: 'sam-sub', email: 'sam@example.com', email_verified: 'true', name: 'Sam' };

let deps: Deps;
const call = (method: string, path: string, claims?: Claims, body?: unknown) => handle({ method, path, claims, body }, deps);

const climb = (extra = {}) => ({ wallId: 'w1', versionId: 'v1', name: 'Blue', grade: 'V3 / 6A', holds: [{ holdId: 'h1', role: 'start' }], ...extra });

beforeEach(async () => {
  deps = {
    repo: memoryRepo(),
    ownerEmail: 'me@example.com',
    initialInvite: 'crimp',
    photos: { createUpload: async () => ({ uploadUrl: 'https://upload', photoUrl: 'https://cdn/p.jpg' }) },
    members: { list: async () => [], remove: async () => {} },
    now: () => 1000,
  };
  await call('PUT', '/walls/w1', OWNER, { name: 'Garage' });
  await call('PUT', '/versions/v1', OWNER, { wallId: 'w1', number: 1, photoUrl: 'https://cdn/p.jpg', width: 100, height: 80, holds: [] });
});

describe('access', () => {
  it('lets anyone read the state', async () => {
    const res = await call('GET', '/state');
    expect(res.status).toBe(200);
    expect((res.body as { walls: unknown[] }).walls).toHaveLength(1);
  });

  it('needs sign-in to set climbs', async () => {
    expect((await call('PUT', '/climbs/c1', undefined, climb())).status).toBe(401);
    const res = await call('PUT', '/climbs/c1', ALEX, climb());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ createdBy: 'alex-sub', setterName: 'Alex' });
  });

  it('only lets the setter or owner change a climb', async () => {
    await call('PUT', '/climbs/c1', ALEX, climb());
    expect((await call('PUT', '/climbs/c1', SAM, climb({ name: 'Hijack' }))).status).toBe(403);
    expect((await call('DELETE', '/climbs/c1', SAM)).status).toBe(403);
    const edited = await call('PUT', '/climbs/c1', OWNER, climb({ name: 'Fixed' }));
    expect(edited.body).toMatchObject({ name: 'Fixed', createdBy: 'alex-sub', setterName: 'Alex' });
    expect((await call('DELETE', '/climbs/c1', ALEX)).status).toBe(204);
  });

  it('keeps walls, photos, lists and settings owner-only', async () => {
    expect((await call('PUT', '/walls/w2', ALEX, { name: 'Mine' })).status).toBe(403);
    expect((await call('DELETE', '/versions/v1', ALEX)).status).toBe(403);
    expect((await call('POST', '/photos', ALEX, {})).status).toBe(403);
    expect((await call('PUT', '/lists/l1', ALEX, { name: 'x' })).status).toBe(403);
    expect((await call('PUT', '/catalog', ALEX, {})).status).toBe(403);
    expect((await call('GET', '/admin/invite', ALEX)).status).toBe(403);
    expect((await call('GET', '/admin/invite', OWNER)).body).toEqual({ code: 'crimp' });
  });

  it('does not treat an unverified owner email as the owner', async () => {
    const fake = { ...OWNER, sub: 'imposter', email_verified: 'false' };
    expect((await call('PUT', '/walls/w2', fake, { name: 'x' })).status).toBe(403);
  });

  it('credits whoever the setter names, while editing stays with who logged it', async () => {
    const res = await call('PUT', '/climbs/c1', ALEX, climb({ setterName: '  Jordan ' }));
    expect(res.body).toMatchObject({ setterName: 'Jordan', createdBy: 'alex-sub' });
    // No name given: falls back to the existing credit, then the account name.
    expect((await call('PUT', '/climbs/c1', ALEX, climb())).body).toMatchObject({ setterName: 'Jordan' });
    expect((await call('PUT', '/climbs/c2', SAM, climb())).body).toMatchObject({ setterName: 'Sam' });
    expect((await call('PUT', '/climbs/c1', SAM, climb({ setterName: 'Sam' }))).status).toBe(403);
  });

  it('only lets the owner mark benchmarks', async () => {
    const res = await call('PUT', '/climbs/c1', ALEX, climb({ benchmark: true }));
    expect(res.body).toMatchObject({ benchmark: false });
    const marked = await call('PUT', '/climbs/c1', OWNER, climb({ benchmark: true }));
    expect(marked.body).toMatchObject({ benchmark: true });
    // A later edit by the setter keeps the owner's benchmark.
    expect((await call('PUT', '/climbs/c1', ALEX, climb({ name: 'Renamed' }))).body).toMatchObject({ benchmark: true });
  });
});

describe('ticks', () => {
  it('stores one tick per person per climb and cleans up with the climb', async () => {
    await call('PUT', '/climbs/c1', ALEX, climb());
    await call('PUT', '/ticks/c1', ALEX, { grade: 'V4 / 6B', stars: 3, note: 'fun' });
    await call('PUT', '/ticks/c1', SAM, { grade: 'V3 / 6A', stars: 9 });
    const ticks = ((await call('GET', '/state')).body as { ticks: { userName: string; stars: number }[] }).ticks;
    expect(ticks.map((t) => [t.userName, t.stars]).sort()).toEqual([['Alex', 3], ['Sam', 3]]);
    await call('DELETE', '/ticks/c1', SAM);
    await call('PUT', '/lists/l1', OWNER, { name: 'Warm-ups', climbIds: ['c1'] });
    await call('DELETE', '/climbs/c1', OWNER);
    const state = (await call('GET', '/state')).body as { ticks: unknown[]; lists: { climbIds: string[] }[] };
    expect(state.ticks).toEqual([]);
    expect(state.lists[0].climbIds).toEqual([]);
  });

  it('cascades a photo delete to its climbs and their ticks', async () => {
    await call('PUT', '/climbs/c1', ALEX, climb());
    await call('PUT', '/ticks/c1', ALEX, { stars: 2 });
    await call('DELETE', '/walls/w1', OWNER);
    const state = (await call('GET', '/state')).body as Record<string, unknown[]>;
    expect([state.walls, state.versions, state.climbs, state.ticks]).toEqual([[], [], [], []]);
  });
});

describe('invite code', () => {
  it('lets the owner change it', async () => {
    expect((await call('PUT', '/admin/invite', OWNER, { code: 'ab' })).status).toBe(400);
    await call('PUT', '/admin/invite', OWNER, { code: 'jugs4days' });
    expect((await call('GET', '/admin/invite', OWNER)).body).toEqual({ code: 'jugs4days' });
  });
});
