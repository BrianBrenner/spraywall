/**
 * Every change to walls, climbs, ticks, lists and settings goes through here.
 * Local mode writes straight to IndexedDB. Server mode saves to the API first and
 * then updates the local cache, so screens (which read the cache) stay simple.
 */
import { db, deleteClimbs, deleteVersion as deleteVersionLocal, deleteWall as deleteWallLocal } from '../db';
import type { AppSettings, Climb, ClimbList, FootRule, GradeSystem, Hold, Tag, Tick, Wall, WallVersion } from '../types';
import { currentSession, idToken, setOwner } from './auth';
import { backend } from './config';
import { ensureThumbnails } from './thumbnail';

async function api<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const token = await idToken();
    if (!token) throw new Error('Sign in first.');
    headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${backend!.apiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status}).`);
  return data as T;
}

// ---------- Pulling the shared state ----------

interface Catalog {
  gradeSystems: GradeSystem[];
  footRules: FootRule[];
  tags: Tag[];
  settings: Partial<AppSettings>;
}

interface State {
  catalog: Catalog | null;
  walls: Wall[];
  versions: (Omit<WallVersion, 'image'> & { photoUrl: string })[];
  climbs: Climb[];
  ticks: Tick[];
  lists: ClimbList[];
}

let pulling: Promise<void> | null = null;

/** Refresh the local cache from the server (no-op in local mode). */
export function pull(): Promise<void> {
  if (!backend) return Promise.resolve();
  pulling ??= doPull().finally(() => (pulling = null));
  return pulling;
}

async function doPull() {
  const state = await api<State>('GET', '/state', undefined, false);

  // Photos are big: reuse the cached copy unless the photo itself changed.
  const cachedVersions = new Map((await db.versions.toArray()).map((v) => [v.id, v]));
  const versions: WallVersion[] = await Promise.all(
    state.versions.map(async (v) => {
      const old = cachedVersions.get(v.id);
      if (old?.photoUrl === v.photoUrl && old.image) return { ...v, image: old.image };
      const res = await fetch(v.photoUrl);
      if (!res.ok) throw new Error('Couldn’t download a wall photo.');
      return { ...v, image: await res.blob() };
    }),
  );
  // Thumbnails are drawn on this device; keep them while the climb is unchanged.
  const cachedClimbs = new Map((await db.climbs.toArray()).map((c) => [c.id, c]));
  const climbs = state.climbs.map((c) => {
    const old = cachedClimbs.get(c.id);
    return old?.thumbnail && old.updatedAt === c.updatedAt && old.versionId === c.versionId ? { ...c, thumbnail: old.thumbnail } : c;
  });

  const tables = [db.walls, db.versions, db.climbs, db.ticks, db.lists, db.gradeSystems, db.footRules, db.tags, db.settings];
  await db.transaction('rw', tables, async () => {
    await Promise.all([db.walls.clear(), db.versions.clear(), db.climbs.clear(), db.ticks.clear(), db.lists.clear()]);
    await db.walls.bulkPut(state.walls);
    await db.versions.bulkPut(versions);
    await db.climbs.bulkPut(climbs);
    await db.ticks.bulkPut(state.ticks);
    await db.lists.bulkPut(state.lists);
    if (state.catalog) {
      await Promise.all([db.gradeSystems.clear(), db.footRules.clear(), db.tags.clear()]);
      await db.gradeSystems.bulkPut(state.catalog.gradeSystems);
      await db.footRules.bulkPut(state.catalog.footRules);
      await db.tags.bulkPut(state.catalog.tags);
      const current = await db.settings.get('app');
      await db.settings.put({ ...current!, ...state.catalog.settings, id: 'app' });
    }
  });
  ensureThumbnails();
  // A brand-new server has no settings yet: the owner's defaults become the shared ones.
  if (!state.catalog && currentSession()?.isOwner) await pushCatalog();
}

/** Ask the server who we are (mainly: is this the owner?). */
export async function refreshMe() {
  if (!backend || !currentSession()) return;
  try {
    const me = await api<{ isOwner: boolean }>('GET', '/me');
    setOwner(me.isOwner);
  } catch {
    // Offline or signed out; permissions just stay as they were.
  }
}

// ---------- Climbs ----------

export async function saveClimb(climb: Climb): Promise<Climb> {
  if (!backend) {
    await db.climbs.put(climb);
    return climb;
  }
  const { thumbnail, ...rest } = climb;
  const saved = await api<Climb>('PUT', `/climbs/${climb.id}`, rest);
  await db.climbs.put({ ...saved, thumbnail });
  return saved;
}

export async function updateClimb(id: string, patch: Partial<Climb>) {
  const climb = await db.climbs.get(id);
  if (climb) await saveClimb({ ...climb, ...patch, updatedAt: Date.now() });
}

export async function removeClimb(id: string) {
  if (backend) await api('DELETE', `/climbs/${id}`);
  await deleteClimbs([id]);
}

// ---------- Ticks ----------

export async function saveTick(climbId: string, tick: { grade: string; stars: number; note: string }) {
  const saved = await api<Tick>('PUT', `/ticks/${climbId}`, tick);
  await db.ticks.put(saved);
}

export async function removeTick(climbId: string) {
  const s = currentSession();
  if (!s) return;
  await api('DELETE', `/ticks/${climbId}`);
  await db.ticks.delete(`${climbId}#${s.sub}`);
}

// ---------- Walls & photos (owner) ----------

export async function saveWall(wall: Wall) {
  if (backend) await api('PUT', `/walls/${wall.id}`, wall);
  await db.walls.put(wall);
}

export async function removeWall(id: string) {
  if (backend) await api('DELETE', `/walls/${id}`);
  await deleteWallLocal(id);
}

/** Upload a photo to S3 (server mode) and return where it lives. */
async function uploadPhoto(image: Blob): Promise<string> {
  const type = image.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const { uploadUrl, photoUrl } = await api<{ uploadUrl: string; photoUrl: string }>('POST', '/photos', { contentType: type });
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': type }, body: image });
  if (!res.ok) throw new Error('Photo upload failed.');
  return photoUrl;
}

export async function createVersion(version: WallVersion) {
  if (!backend) {
    await db.versions.add(version);
    return;
  }
  const photoUrl = await uploadPhoto(version.image);
  const { image, ...rest } = version;
  const saved = await api<WallVersion>('PUT', `/versions/${version.id}`, { ...rest, photoUrl });
  await db.versions.put({ ...saved, image });
}

export async function saveHolds(versionId: string, holds: Hold[]) {
  if (backend) await api('PUT', `/versions/${versionId}`, { holds });
  await db.versions.update(versionId, { holds });
}

export async function removeVersion(id: string) {
  if (backend) await api('DELETE', `/versions/${id}`);
  await deleteVersionLocal(id);
}

// ---------- Lists (owner) ----------

export async function saveList(list: ClimbList) {
  if (backend) await api('PUT', `/lists/${list.id}`, list);
  await db.lists.put(list);
}

export async function removeList(id: string) {
  if (backend) await api('DELETE', `/lists/${id}`);
  await db.lists.delete(id);
}

// ---------- Catalog: grades, foot rules, tags (owner) ----------

/** Call after changing grades, foot rules, tags or defaults locally. */
export async function pushCatalog() {
  if (!backend) return;
  const [gradeSystems, footRules, tags, settings] = await Promise.all([
    db.gradeSystems.toArray(),
    db.footRules.toArray(),
    db.tags.toArray(),
    db.settings.get('app'),
  ]);
  await api('PUT', '/catalog', {
    gradeSystems,
    footRules,
    tags,
    settings: { defaultGradeSystemId: settings?.defaultGradeSystemId, defaultFootRuleId: settings?.defaultFootRuleId },
  });
}

// ---------- Admin (owner) ----------

export const getInvite = () => api<{ code: string }>('GET', '/admin/invite');
export const setInvite = (code: string) => api<{ code: string }>('PUT', '/admin/invite', { code });
export const listMembers = () => api<{ username: string; name: string; email: string; createdAt: number }[]>('GET', '/admin/members');
export const removeMember = (username: string) => api('DELETE', `/admin/members/${encodeURIComponent(username)}`);

/** Move a backup (export zip contents) up to the server, photos first. */
export async function importToServer(data: {
  walls: Wall[];
  versions: WallVersion[];
  climbs: Climb[];
  lists: ClimbList[];
  catalog: Catalog;
}, onProgress?: (msg: string) => void) {
  const versions = [];
  for (const [i, v] of data.versions.entries()) {
    onProgress?.(`Uploading photo ${i + 1} of ${data.versions.length}…`);
    const { image, ...rest } = v;
    versions.push({ ...rest, photoUrl: await uploadPhoto(image) });
  }
  onProgress?.('Saving climbs…');
  const climbs = data.climbs.map(({ thumbnail: _t, ...c }) => c);
  const res = await api<{ imported: number }>('POST', '/admin/import', { ...data, versions, climbs });
  await pull();
  return res.imported;
}
