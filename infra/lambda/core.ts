/**
 * The whole API as one function of (request, dependencies), so it can run in
 * Lambda, in the local dev server and in tests with in-memory fakes.
 *
 * Access rules:
 *   anyone          GET /state (everything needed to browse)
 *   signed in       set climbs, edit/delete their own climbs, tick
 *   owner           walls, photos, holds, lists, catalog, invite code, members, any climb
 */

export type EntityType = 'wall' | 'version' | 'climb' | 'tick' | 'list' | 'catalog' | 'config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Item = { id: string } & Record<string, any>;

export interface Repo {
  list(type: EntityType): Promise<Item[]>;
  get(type: EntityType, id: string): Promise<Item | undefined>;
  put(type: EntityType, item: Item): Promise<void>;
  delete(type: EntityType, id: string): Promise<void>;
}

export interface Member {
  username: string;
  name: string;
  email: string;
  createdAt: number;
}

export interface Deps {
  repo: Repo;
  ownerEmail: string;
  initialInvite: string;
  photos: { createUpload(contentType: string): Promise<{ uploadUrl: string; photoUrl: string }> };
  members: { list(): Promise<Member[]>; remove(username: string): Promise<void> };
  now?: () => number;
}

/** Verified claims from the sign-in token (API Gateway checks the signature). */
export interface Claims {
  sub: string;
  email?: string;
  name?: string;
  email_verified?: string | boolean;
  'cognito:username'?: string;
}

export interface Request {
  method: string;
  path: string;
  body?: unknown;
  claims?: Claims;
}

export interface Response {
  status: number;
  body?: unknown;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

interface User {
  sub: string;
  name: string;
  email: string;
  isOwner: boolean;
}

function userFrom(claims: Claims | undefined, ownerEmail: string): User | null {
  if (!claims?.sub) return null;
  const email = (claims.email ?? '').toLowerCase();
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  return {
    sub: claims.sub,
    name: claims.name || email.split('@')[0] || 'Climber',
    email,
    isOwner: verified && !!ownerEmail && email === ownerEmail.toLowerCase(),
  };
}

// ---------- Validation (just enough to keep junk out) ----------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 500) : []);
const ROLES = new Set(['start', 'hand', 'foot', 'finish']);

function climbFields(body: unknown) {
  if (!isObj(body)) fail(400, 'Expected a climb.');
  const b = body as Record<string, unknown>;
  const holds = Array.isArray(b.holds)
    ? b.holds
        .filter((h): h is Record<string, unknown> => isObj(h) && typeof h.holdId === 'string' && ROLES.has(h.role as string))
        .map((h) => ({ holdId: h.holdId as string, role: h.role as string }))
        .slice(0, 300)
    : [];
  if (!str(b.wallId) || !str(b.versionId)) fail(400, 'A climb needs a wall and photo.');
  if (!holds.length) fail(400, 'A climb needs at least one hold.');
  return {
    wallId: str(b.wallId),
    versionId: str(b.versionId),
    name: str(b.name, 120),
    gradeSystemId: str(b.gradeSystemId),
    grade: str(b.grade, 40),
    footRuleId: str(b.footRuleId),
    noMatching: b.noMatching === true,
    benchmark: b.benchmark === true,
    tagIds: strArr(b.tagIds),
    notes: str(b.notes, 4000),
    holds,
    /** Who set it, for display. Can be anyone, not just account holders. */
    setterName: str(b.setterName, 60).trim(),
  };
}

function idOf(path: string, prefix: string) {
  const id = decodeURIComponent(path.slice(prefix.length));
  if (!id || id.includes('/') || id.length > 100) fail(400, 'Bad id.');
  return id;
}

// ---------- Cascading deletes ----------

async function deleteClimbs(repo: Repo, ids: Set<string>) {
  if (!ids.size) return;
  for (const t of await repo.list('tick')) if (ids.has(t.climbId)) await repo.delete('tick', t.id);
  for (const l of await repo.list('list')) {
    const kept = (l.climbIds as string[]).filter((id) => !ids.has(id));
    if (kept.length !== l.climbIds.length) await repo.put('list', { ...l, climbIds: kept });
  }
  for (const id of ids) await repo.delete('climb', id);
}

async function deleteVersion(repo: Repo, versionId: string) {
  const climbs = (await repo.list('climb')).filter((c) => c.versionId === versionId);
  await deleteClimbs(repo, new Set(climbs.map((c) => c.id)));
  await repo.delete('version', versionId);
}

// ---------- Handler ----------

export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    return await route(req, deps);
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
    console.error(e);
    return { status: 500, body: { error: 'Something went wrong.' } };
  }
}

async function route(req: Request, deps: Deps): Promise<Response> {
  const { repo } = deps;
  const now = deps.now ?? Date.now;
  const user = userFrom(req.claims, deps.ownerEmail);
  const { method, path } = req;
  const signedIn = () => user ?? fail(401, 'Sign in first.');
  const owner = () => (signedIn().isOwner ? user! : fail(403, 'Only the wall owner can do that.'));

  // Public: everything needed to browse.
  if (method === 'GET' && path === '/state') {
    const [catalog, walls, versions, climbs, ticks, lists] = await Promise.all([
      repo.get('catalog', 'catalog'),
      repo.list('wall'),
      repo.list('version'),
      repo.list('climb'),
      repo.list('tick'),
      repo.list('list'),
    ]);
    return { status: 200, body: { catalog: catalog ?? null, walls, versions, climbs, ticks, lists } };
  }

  if (method === 'GET' && path === '/me') {
    const u = signedIn();
    return { status: 200, body: { sub: u.sub, name: u.name, email: u.email, isOwner: u.isOwner } };
  }

  // ----- Climbs: anyone signed in can set; only the setter or owner can change. -----
  if (path.startsWith('/climbs/')) {
    const id = idOf(path, '/climbs/');
    const u = signedIn();
    const existing = await repo.get('climb', id);
    if (existing && existing.createdBy !== u.sub && !u.isOwner) fail(403, 'Only the setter or the wall owner can change this climb.');
    if (method === 'PUT') {
      const fields = climbFields(req.body);
      if (!(await repo.get('version', fields.versionId))) fail(400, 'That wall photo no longer exists.');
      // Only the owner marks benchmarks.
      if (!u.isOwner) fields.benchmark = existing?.benchmark === true;
      const climb: Item = {
        ...fields,
        id,
        // createdBy (who logged it) controls editing; setterName is just who gets credit.
        createdBy: existing?.createdBy ?? u.sub,
        setterName: fields.setterName || existing?.setterName || u.name,
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
      };
      await repo.put('climb', climb);
      return { status: 200, body: climb };
    }
    if (method === 'DELETE') {
      if (existing) await deleteClimbs(repo, new Set([id]));
      return { status: 204 };
    }
  }

  // ----- Ticks: your own only. -----
  if (path.startsWith('/ticks/')) {
    const climbId = idOf(path, '/ticks/');
    const u = signedIn();
    const id = `${climbId}#${u.sub}`;
    if (method === 'PUT') {
      if (!(await repo.get('climb', climbId))) fail(404, 'Climb not found.');
      const b = isObj(req.body) ? req.body : {};
      const existing = await repo.get('tick', id);
      const tick: Item = {
        id,
        climbId,
        userId: u.sub,
        userName: u.name,
        grade: str(b.grade, 40),
        stars: Math.max(0, Math.min(3, Math.round(num(b.stars)))),
        note: str(b.note, 2000),
        date: existing?.date ?? now(),
        updatedAt: now(),
      };
      await repo.put('tick', tick);
      return { status: 200, body: tick };
    }
    if (method === 'DELETE') {
      await repo.delete('tick', id);
      return { status: 204 };
    }
  }

  // ----- Owner only from here. -----
  if (path.startsWith('/walls/')) {
    owner();
    const id = idOf(path, '/walls/');
    if (method === 'PUT') {
      const b = isObj(req.body) ? req.body : {};
      const existing = await repo.get('wall', id);
      const wall = { id, name: str(b.name, 120) || 'My wall', createdAt: existing?.createdAt ?? now() };
      await repo.put('wall', wall);
      return { status: 200, body: wall };
    }
    if (method === 'DELETE') {
      for (const v of (await repo.list('version')).filter((v) => v.wallId === id)) await deleteVersion(repo, v.id);
      await repo.delete('wall', id);
      return { status: 204 };
    }
  }

  if (path.startsWith('/versions/')) {
    owner();
    const id = idOf(path, '/versions/');
    if (method === 'PUT') {
      if (!isObj(req.body)) fail(400, 'Expected a photo version.');
      const b = req.body as Record<string, unknown>;
      const existing = await repo.get('version', id);
      if (!existing && !(await repo.get('wall', str(b.wallId)))) fail(400, 'Wall not found.');
      const version: Item = {
        id,
        wallId: existing?.wallId ?? str(b.wallId),
        number: existing?.number ?? num(b.number),
        photoUrl: existing?.photoUrl ?? str(b.photoUrl, 500),
        width: existing?.width ?? num(b.width),
        height: existing?.height ?? num(b.height),
        holds: Array.isArray(b.holds) ? b.holds.slice(0, 2000) : existing?.holds ?? [],
        createdAt: existing?.createdAt ?? now(),
      };
      if (!version.photoUrl || !version.width || !version.height) fail(400, 'A photo version needs a photo.');
      await repo.put('version', version);
      return { status: 200, body: version };
    }
    if (method === 'DELETE') {
      await deleteVersion(repo, id);
      return { status: 204 };
    }
  }

  if (method === 'POST' && path === '/photos') {
    owner();
    const b = isObj(req.body) ? req.body : {};
    const type = b.contentType === 'image/png' ? 'image/png' : 'image/jpeg';
    return { status: 200, body: await deps.photos.createUpload(type) };
  }

  if (path.startsWith('/lists/')) {
    owner();
    const id = idOf(path, '/lists/');
    if (method === 'PUT') {
      const b = isObj(req.body) ? req.body : {};
      const existing = await repo.get('list', id);
      const list = { id, name: str(b.name, 120) || 'List', climbIds: strArr(b.climbIds), createdAt: existing?.createdAt ?? now() };
      await repo.put('list', list);
      return { status: 200, body: list };
    }
    if (method === 'DELETE') {
      await repo.delete('list', id);
      return { status: 204 };
    }
  }

  if (method === 'PUT' && path === '/catalog') {
    owner();
    if (!isObj(req.body)) fail(400, 'Expected the catalog.');
    const b = req.body as Record<string, unknown>;
    const catalog = {
      id: 'catalog',
      gradeSystems: Array.isArray(b.gradeSystems) ? b.gradeSystems.slice(0, 20) : [],
      footRules: Array.isArray(b.footRules) ? b.footRules.slice(0, 50) : [],
      tags: Array.isArray(b.tags) ? b.tags.slice(0, 200) : [],
      settings: isObj(b.settings) ? b.settings : {},
    };
    await repo.put('catalog', catalog);
    return { status: 200, body: catalog };
  }

  if (path === '/admin/invite') {
    owner();
    if (method === 'GET') return { status: 200, body: { code: await currentInvite(deps) } };
    if (method === 'PUT') {
      const code = str(isObj(req.body) ? req.body.code : '', 60).trim();
      if (code.length < 4) fail(400, 'Use at least 4 characters.');
      await repo.put('config', { id: 'invite', code });
      return { status: 200, body: { code } };
    }
  }

  if (path === '/admin/members' && method === 'GET') {
    owner();
    return { status: 200, body: await deps.members.list() };
  }

  if (path.startsWith('/admin/members/') && method === 'DELETE') {
    const u = owner();
    const username = idOf(path, '/admin/members/');
    if (username === u.sub || username === req.claims?.['cognito:username']) fail(400, 'You can’t remove yourself.');
    await deps.members.remove(username);
    return { status: 204 };
  }

  // One-off move of local data to the server. Photos are uploaded first via /photos.
  if (method === 'POST' && path === '/admin/import') {
    const u = owner();
    if (!isObj(req.body)) fail(400, 'Expected data to import.');
    const b = req.body as Record<string, unknown>;
    const items = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Item => isObj(x) && typeof x.id === 'string') : []);
    let count = 0;
    for (const w of items(b.walls)) (await repo.put('wall', { id: w.id, name: str(w.name, 120), createdAt: num(w.createdAt) || now() }), count++);
    for (const v of items(b.versions)) (await repo.put('version', v), count++);
    for (const c of items(b.climbs)) {
      const fields = climbFields(c);
      await repo.put('climb', { ...c, ...fields, id: c.id, createdBy: c.createdBy ?? u.sub, setterName: fields.setterName || u.name, createdAt: num(c.createdAt) || now(), updatedAt: now() });
      count++;
    }
    for (const l of items(b.lists)) (await repo.put('list', { id: l.id, name: str(l.name, 120), climbIds: strArr(l.climbIds), createdAt: num(l.createdAt) || now() }), count++);
    if (isObj(b.catalog)) await repo.put('catalog', { ...(b.catalog as Item), id: 'catalog' });
    return { status: 200, body: { imported: count } };
  }

  return fail(404, 'Not found.');
}

export async function currentInvite(deps: Pick<Deps, 'repo' | 'initialInvite'>) {
  const stored = await deps.repo.get('config', 'invite');
  return (stored?.code as string | undefined) ?? deps.initialInvite;
}

/** Simple in-memory repo for tests and the local dev server. */
export function memoryRepo(): Repo & { data: Map<string, Item> } {
  const data = new Map<string, Item>();
  const key = (type: EntityType, id: string) => `${type}:${id}`;
  return {
    data,
    async list(type) {
      return [...data.entries()].filter(([k]) => k.startsWith(`${type}:`)).map(([, v]) => structuredClone(v));
    },
    async get(type, id) {
      const v = data.get(key(type, id));
      return v && structuredClone(v);
    },
    async put(type, item) {
      data.set(key(type, item.id), structuredClone(item));
    },
    async delete(type, id) {
      data.delete(key(type, id));
    },
  };
}
