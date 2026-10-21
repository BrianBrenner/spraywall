import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HoldOutline } from '../components/HoldOutline';
import { Icon } from '../components/Icon';
import { ClimbMeta, GradeChip } from '../components/ui';
import { WallCanvas } from '../components/WallCanvas';
import { db, latestVersion, newId } from '../db';
import { shapeBox, shapePath, unionBox } from '../lib/geometry';
import { getClimbQueue, useCatalog, useWakeLock } from '../lib/hooks';
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
  const [popover, setPopover] = useState<'lists' | 'tags' | null>(null);
  const togglePopover = (p: 'lists' | 'tags') => setPopover((cur) => (cur === p ? null : p));
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
        </div>
        <div className="header-actions">
          {isOldPhoto && <span className="badge muted">photo v{version.number}</span>}
          <FullscreenButton />
          <button
            type="button"
            className={`icon-btn ${climb.benchmark ? 'starred' : ''}`}
            aria-label={climb.benchmark ? 'Remove benchmark' : 'Mark as benchmark'}
            aria-pressed={!!climb.benchmark}
            title={climb.benchmark ? 'Benchmark' : 'Mark as benchmark'}
            onClick={() => db.climbs.update(climb.id, { benchmark: !climb.benchmark, updatedAt: Date.now() })}
          >
            <Icon name="star" fill={climb.benchmark ? 'currentColor' : 'none'} />
          </button>
          <button type="button" className={`icon-btn ${popover === 'tags' ? 'on' : ''}`} aria-label="Tags" title="Tags" onClick={() => togglePopover('tags')}>
            <Icon name="tag" />
          </button>
          <button type="button" className={`icon-btn ${popover === 'lists' ? 'on' : ''}`} aria-label="Lists" title="Add to lists" onClick={() => togglePopover('lists')}>
            <Icon name="bookmark" />
          </button>
          <Link className="icon-btn" aria-label="Edit" title="Edit" to={`/climbs/${climb.id}/edit`}>
            <Icon name="edit" />
          </Link>
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
      {popover === 'tags' && <TagPicker climb={climb} catalog={catalog} onClose={() => setPopover(null)} />}
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
function TagPicker({ climb, catalog, onClose }: { climb: Climb; catalog: Catalog; onClose: () => void }) {
  const [name, setName] = useState('');

  const setTags = (tagIds: string[]) => db.climbs.update(climb.id, { tagIds, updatedAt: Date.now() });

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Reuse an existing tag with the same name rather than making a duplicate.
    const existing = catalog.tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    const id = existing?.id ?? newId();
    if (!existing) await db.tags.add({ id, name: trimmed });
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
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <input placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn" disabled={!name.trim()}>Add</button>
      </form>
    </div>
  );
}

function ListPicker({ climb, onClose }: { climb: Climb; onClose: () => void }) {
  const lists = useLiveQuery(() => db.lists.orderBy('createdAt').toArray());
  const [name, setName] = useState('');

  const toggle = async (listId: string, on: boolean) => {
    await db.lists.where('id').equals(listId).modify((l) => {
      l.climbIds = on ? [...l.climbIds.filter((id) => id !== climb.id), climb.id] : l.climbIds.filter((id) => id !== climb.id);
    });
  };

  const create = async () => {
    if (!name.trim()) return;
    await db.lists.add({ id: newId(), name: name.trim(), climbIds: [climb.id], createdAt: Date.now() });
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
