import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HoldOutline } from '../components/HoldOutline';
import { Icon } from '../components/Icon';
import { ClimbMeta, GradeChip, SignInPrompt, TickSummary } from '../components/ui';
import { WallCanvas } from '../components/WallCanvas';
import { db, latestVersion, newId } from '../db';
import { shapeBox, shapePath, unionBox } from '../lib/geometry';
import { getClimbQueue, useCatalog, useWakeLock } from '../lib/hooks';
import { pushCatalog, removeTick, saveList, saveTick, updateClimb } from '../lib/mutations';
import { usePermissions } from '../lib/permissions';
import { useTickStats, type TickStats } from '../lib/ticks';
import { blobUrl } from '../lib/image';
import { ROLE_COLORS } from '../lib/roles';
import type { Climb } from '../types';
import type { Catalog } from '../lib/hooks';

/** Full-screen, high-contrast view for propping up next to the wall. */
export function ClimbViewPage() {
  const { climbId } = useParams();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const data = useLiveQuery(async () => {
    const climb = await db.climbs.get(climbId!);
    if (!climb) return null;
    const [version, latest] = await Promise.all([db.versions.get(climb.versionId), latestVersion(climb.wallId)]);
    return { climb, version, isOldPhoto: latest?.id !== climb.versionId };
  }, [climbId]);
  // One popover at a time.
  const [popover, setPopover] = useState<'lists' | 'tags' | 'ticks' | null>(null);
  const togglePopover = (p: 'lists' | 'tags' | 'ticks') => setPopover((cur) => (cur === p ? null : p));
  // Moving to another climb closes whatever panel was open.
  useEffect(() => setPopover(null), [climbId]);
  const perms = usePermissions();
  const tickStats = useTickStats((id) => catalog?.gradeSystem(id));
  const [showNotes, setShowNotes] = useState(true);
  useWakeLock();

  const queue = useMemo(() => getClimbQueue(), []);
  const index = queue.indexOf(climbId!);
  const go = (delta: number) => {
    const id = queue[index + delta];
    if (id) navigate(`/climbs/${id}`, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape' && !document.fullscreenElement) navigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const focus = useMemo(() => {
    if (!data?.version) return null;
    const byId = new Map(data.version.holds.map((h) => [h.id, h]));
    const box = unionBox(data.climb.holds.flatMap((ch) => (byId.has(ch.holdId) ? [shapeBox(byId.get(ch.holdId)!.shape)] : [])));
    if (!box) return null;
    const pad = Math.max(box.w, box.h) * 0.1 + 60;
    return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  }, [data]);

  if (data === undefined || !catalog) return <div className="climb-view" />;
  if (!data?.version) {
    return (
      <div className="climb-view">
        <div className="empty">Climb not found. <Link to="/">Back</Link></div>
      </div>
    );
  }
  const { climb, version, isOldPhoto } = data;
  const stats = tickStats(climb);
  const canEdit = perms.canEdit(climb);
  const holdsById = new Map(version.holds.map((h) => [h.id, h]));
  const used = climb.holds.flatMap((ch) => {
    const hold = holdsById.get(ch.holdId);
    return hold ? [{ hold, role: ch.role }] : [];
  });

  return (
    <div className="climb-view">
      <header className="climb-view-header">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}>
          <Icon name="back" size={24} />
        </button>
        <div className="climb-view-title">
          <h1>
            {climb.name || 'Untitled'} <GradeChip grade={climb.grade} />
          </h1>
          <ClimbMeta climb={climb} catalog={catalog} />
          {perms.server && <TickSummary climb={climb} stats={stats} />}
        </div>
        <div className="header-actions">
          {isOldPhoto && <span className="badge muted">photo v{version.number}</span>}
          <FullscreenButton />
          {perms.server && (
            <button
              type="button"
              className={`icon-btn ${popover === 'ticks' ? 'on' : ''} ${stats.mine ? 'sent' : ''}`}
              aria-label={stats.mine ? 'Your tick' : 'Tick this climb'}
              title={stats.mine ? 'Your tick' : 'Tick'}
              onClick={() => togglePopover('ticks')}
            >
              <Icon name="check" />
            </button>
          )}
          {perms.isOwner && <button
            type="button"
            className={`icon-btn ${climb.benchmark ? 'starred' : ''}`}
            aria-label={climb.benchmark ? 'Remove benchmark' : 'Mark as benchmark'}
            aria-pressed={!!climb.benchmark}
            title={climb.benchmark ? 'Benchmark' : 'Mark as benchmark'}
            onClick={() => updateClimb(climb.id, { benchmark: !climb.benchmark }).catch((e) => alert(e.message))}
          >
            <Icon name="star" fill={climb.benchmark ? 'currentColor' : 'none'} />
          </button>}
          {canEdit && (
            <button type="button" className={`icon-btn ${popover === 'tags' ? 'on' : ''}`} aria-label="Tags" title="Tags" onClick={() => togglePopover('tags')}>
              <Icon name="tag" />
            </button>
          )}
          {perms.isOwner && (
            <button type="button" className={`icon-btn ${popover === 'lists' ? 'on' : ''}`} aria-label="Lists" title="Add to lists" onClick={() => togglePopover('lists')}>
              <Icon name="bookmark" />
            </button>
          )}
          {canEdit && (
            <Link className="icon-btn" aria-label="Edit" title="Edit" to={`/climbs/${climb.id}/edit`}>
              <Icon name="edit" />
            </Link>
          )}
        </div>
      </header>

      <WallCanvas image={blobUrl(version.image)} width={version.width} height={version.height} focus={focus} className="dark">
        <defs>
          <mask id="climb-mask">
            <rect width={version.width} height={version.height} fill="white" />
            {used.map(({ hold }) => <path key={hold.id} d={shapePath(hold.shape)} fill="black" />)}
          </mask>
        </defs>
        <rect width={version.width} height={version.height} fill="rgba(0,0,0,0.62)" mask="url(#climb-mask)" />
        {used.map(({ hold, role }) => <HoldOutline key={hold.id} shape={hold.shape} color={ROLE_COLORS[role]} width={4} />)}
      </WallCanvas>

      {popover === 'lists' && <ListPicker climb={climb} onClose={() => setPopover(null)} />}
      {popover === 'tags' && <TagPicker climb={climb} catalog={catalog} canCreate={perms.isOwner} onClose={() => setPopover(null)} />}
      {popover === 'ticks' && <TickSheet climb={climb} catalog={catalog} stats={stats} signedIn={perms.signedIn} onClose={() => setPopover(null)} />}
      {climb.notes && (
        <button type="button" className={`climb-notes ${showNotes ? '' : 'collapsed'}`} onClick={() => setShowNotes((s) => !s)}>
          {showNotes ? climb.notes : 'Notes'}
        </button>
      )}

      {queue.length > 1 && index >= 0 && (
        <footer className="climb-nav">
          <button type="button" className="btn big" disabled={index <= 0} onClick={() => go(-1)}>
            <Icon name="back" /> Prev
          </button>
          <span>{index + 1} / {queue.length}</span>
          <button type="button" className="btn big" disabled={index >= queue.length - 1} onClick={() => go(1)}>
            Next <Icon name="back" style={{ transform: 'scaleX(-1)' }} />
          </button>
        </footer>
      )}
    </div>
  );
}

function FullscreenButton() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const [on, setOn] = useState(!!(document.fullscreenElement ?? doc.webkitFullscreenElement));
  useEffect(() => {
    const update = () => setOn(!!(document.fullscreenElement ?? doc.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
    };
  }, [doc]);
  // iPhone Safari has no element fullscreen; installing to the home screen does the same job.
  if (!el.requestFullscreen && !el.webkitRequestFullscreen) return null;
  const toggle = () => {
    if (on) (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
    else (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
  };
  return (
    <button type="button" className="icon-btn" aria-label={on ? 'Exit full screen' : 'Full screen'} title="Full screen" onClick={toggle}>
      <Icon name="expand" />
    </button>
  );
}

/** Tag the climb in place, including creating a new tag, without opening the editor. */
function TagPicker({ climb, catalog, canCreate, onClose }: { climb: Climb; catalog: Catalog; canCreate: boolean; onClose: () => void }) {
  const [name, setName] = useState('');

  const setTags = (tagIds: string[]) => updateClimb(climb.id, { tagIds }).catch((e) => alert(e.message));

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Reuse an existing tag with the same name rather than making a duplicate.
    const existing = catalog.tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    const id = existing?.id ?? newId();
    if (!existing) {
      await db.tags.add({ id, name: trimmed });
      await pushCatalog().catch((e) => alert(e.message));
    }
    if (!climb.tagIds.includes(id)) await setTags([...climb.tagIds, id]);
    setName('');
  };

  return (
    <div className="popover" role="dialog" aria-label="Tags">
      <div className="popover-head">
        <strong>Tags</strong>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="chips">
        {catalog.tags.map((t) => {
          const on = climb.tagIds.includes(t.id);
          return (
            <button
              type="button"
              key={t.id}
              className={`chip ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={() => setTags(on ? climb.tagIds.filter((id) => id !== t.id) : [...climb.tagIds, t.id])}
            >
              {t.name}
            </button>
          );
        })}
      </div>
      {canCreate && (
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <input placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn" disabled={!name.trim()}>Add</button>
        </form>
      )}
    </div>
  );
}

function ListPicker({ climb, onClose }: { climb: Climb; onClose: () => void }) {
  const lists = useLiveQuery(() => db.lists.orderBy('createdAt').toArray());
  const [name, setName] = useState('');

  const toggle = async (listId: string, on: boolean) => {
    const l = lists?.find((x) => x.id === listId);
    if (!l) return;
    const climbIds = on ? [...l.climbIds.filter((id) => id !== climb.id), climb.id] : l.climbIds.filter((id) => id !== climb.id);
    await saveList({ ...l, climbIds }).catch((e) => alert(e.message));
  };

  const create = async () => {
    if (!name.trim()) return;
    await saveList({ id: newId(), name: name.trim(), climbIds: [climb.id], createdAt: Date.now() }).catch((e) => alert(e.message));
    setName('');
  };

  return (
    <div className="popover" role="dialog" aria-label="Add to lists">
      <div className="popover-head">
        <strong>Add to lists</strong>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      {lists?.map((l) => (
        <label key={l.id} className="check">
          <input type="checkbox" checked={l.climbIds.includes(climb.id)} onChange={(e) => toggle(l.id, e.target.checked)} />
          {l.name}
        </label>
      ))}
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <input placeholder="New list" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn" disabled={!name.trim()}>Add</button>
      </form>
    </div>
  );
}

/** Your tick (grade opinion, stars, note) plus everyone else's sends. */
function TickSheet({ climb, catalog, stats, signedIn, onClose }: {
  climb: Climb;
  catalog: Catalog;
  stats: TickStats;
  signedIn: boolean;
  onClose: () => void;
}) {
  const mine = stats.mine;
  const [grade, setGrade] = useState(mine?.grade ?? climb.grade);
  const [stars, setStars] = useState(mine?.stars ?? 0);
  const [note, setNote] = useState(mine?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const grades = catalog.gradeSystem(climb.gradeSystemId)?.grades ?? [];
  const others = stats.ticks.filter((t) => t !== mine);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="popover tick-sheet" role="dialog" aria-label="Ticks">
      <div className="popover-head">
        <strong>{mine ? 'Your tick' : 'Tick this climb'}</strong>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      {signedIn ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(() => saveTick(climb.id, { grade, stars, note }).then(onClose)); }}>
          <label className="field">
            Felt like
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">No opinion</option>
              {grades.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <div className="field">
            Quality
            <div className="star-picker" role="radiogroup" aria-label="Quality">
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setStars(stars === n ? 0 : n)}>
                  <Icon name="star" size={26} fill={n <= stars ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
          </div>
          <textarea rows={2} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <p className="error">{error}</p>}
          <div className="row-actions end">
            {mine && (
              <button type="button" className="btn ghost danger" disabled={busy} onClick={() => run(() => removeTick(climb.id).then(onClose))}>
                Remove
              </button>
            )}
            <button type="submit" className="btn primary" disabled={busy}>
              <Icon name="check" size={18} /> {mine ? 'Update' : 'Tick it'}
            </button>
          </div>
        </form>
      ) : (
        <SignInPrompt what="tick climbs" />
      )}
      {others.length > 0 && (
        <ul className="tick-list">
          {others.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.userName}</strong>
                <span className="muted small"> {new Date(t.date).toLocaleDateString()}</span>
              </div>
              <div className="muted small">
                {[t.grade && `felt ${t.grade}`, t.stars > 0 && '★'.repeat(t.stars)].filter(Boolean).join(' · ')}
              </div>
              {t.note && <div className="small">{t.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
