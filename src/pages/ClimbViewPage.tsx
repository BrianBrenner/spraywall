import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HoldOutline } from '../components/HoldOutline';
import { Icon, type IconName } from '../components/Icon';
import { ClimbMeta, ClimbRules, GradeChip, TickSummary } from '../components/ui';
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

type Panel = 'send' | 'info' | 'menu' | 'tags' | 'lists';

/** High-contrast view for propping up next to the wall. */
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
  const [popover, setPopover] = useState<Panel | null>(null);
  const togglePopover = (p: Panel) => setPopover((cur) => (cur === p ? null : p));
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
  // Everything except Send and Info lives in the ⋯ menu, with words instead of mystery icons.
  const menuItems: { label: string; icon: IconName; run: () => void }[] = [
    ...(canEdit ? [{ label: 'Edit climb', icon: 'edit' as const, run: () => navigate(`/climbs/${climb.id}/edit`) }] : []),
    ...(canEdit ? [{ label: 'Edit tags', icon: 'tag' as const, run: () => setPopover('tags') }] : []),
    ...(perms.isOwner
      ? [
          {
            label: climb.benchmark ? 'Remove from classics' : 'Mark as classic',
            icon: 'star' as const,
            run: () => void updateClimb(climb.id, { benchmark: !climb.benchmark }).catch((e) => alert(e.message)),
          },
          { label: 'Add to list', icon: 'bookmark' as const, run: () => setPopover('lists') },
        ]
      : []),
  ];
  const holdsById = new Map(version.holds.map((h) => [h.id, h]));
  const used = climb.holds.flatMap((ch) => {
    const hold = holdsById.get(ch.holdId);
    return hold ? [{ hold, role: ch.role }] : [];
  });

  return (
    <div className="climb-view">
      <div className="climb-view-top">
        <header className="climb-view-header">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}>
            <Icon name="back" size={24} />
          </button>
          <div className="climb-view-title">
            <h1>
              {climb.name || 'Untitled'} <GradeChip grade={climb.grade} />
            </h1>
            {climb.setterName && <span className="byline">Set by {climb.setterName}</span>}
            <ClimbRules climb={climb} catalog={catalog} full />
            <ClimbMeta climb={climb} catalog={catalog} />
            {perms.server && (
              <button type="button" className="summary-btn" onClick={() => setPopover('info')}>
                <TickSummary climb={climb} stats={stats} />
              </button>
            )}
          </div>
          <div className="header-actions">
            {isOldPhoto && <span className="badge muted">photo v{version.number}</span>}
            {perms.server && perms.signedIn && (
              <button type="button" className={`btn send-btn ${stats.mine ? 'sent' : ''}`} onClick={() => togglePopover('send')}>
                <Icon name="check" size={18} /> {stats.mine ? 'Sent' : 'Send'}
              </button>
            )}
            <button type="button" className={`icon-btn ${popover === 'info' ? 'on' : ''}`} aria-label="Info" title="Info" onClick={() => togglePopover('info')}>
              <Icon name="info" />
            </button>
            {menuItems.length > 0 && (
              <button type="button" className={`icon-btn ${popover === 'menu' ? 'on' : ''}`} aria-label="More" aria-haspopup="menu" onClick={() => togglePopover('menu')}>
                <Icon name="more" />
              </button>
            )}
          </div>
        </header>
        {popover === 'lists' && <ListPicker climb={climb} onClose={() => setPopover(null)} />}
        {popover === 'tags' && <TagPicker climb={climb} catalog={catalog} canCreate={perms.isOwner} onClose={() => setPopover(null)} />}
        {popover === 'send' && <TickSheet climb={climb} catalog={catalog} stats={stats} onClose={() => setPopover(null)} />}
        {popover === 'info' && <InfoPanel climb={climb} catalog={catalog} stats={stats} server={perms.server} onClose={() => setPopover(null)} />}
        {popover === 'menu' && (
          <div className="popover menu" role="menu">
            {menuItems.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setPopover(null);
                  item.run();
                }}
              >
                <Icon name={item.icon} size={18} /> {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

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

/** Your tick: grade opinion, stars, note. */
function TickSheet({ climb, catalog, stats, onClose }: { climb: Climb; catalog: Catalog; stats: TickStats; onClose: () => void }) {
  const mine = stats.mine;
  const [grade, setGrade] = useState(mine?.grade ?? climb.grade);
  const [stars, setStars] = useState(mine?.stars ?? 0);
  const [note, setNote] = useState(mine?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const grades = catalog.gradeSystem(climb.gradeSystemId)?.grades ?? [];

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await f();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="popover tick-sheet" role="dialog" aria-label="Your send">
      <div className="popover-head">
        <strong>{mine ? 'Your send' : 'Log your send'}</strong>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(() => saveTick(climb.id, { grade, stars, note })); }}>
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
        <textarea rows={2} placeholder="Comment (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <div className="row-actions end">
          {mine && (
            <button type="button" className="btn ghost danger" disabled={busy} onClick={() => run(() => removeTick(climb.id))}>
              Remove
            </button>
          )}
          <button type="submit" className="btn primary" disabled={busy}>
            <Icon name="check" size={18} /> {mine ? 'Update' : 'Log send'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Everything about the climb that isn't on the wall: grade opinions, rating, setter, who sent it. */
function InfoPanel({ climb, catalog, stats, server, onClose }: {
  climb: Climb;
  catalog: Catalog;
  stats: TickStats;
  server: boolean;
  onClose: () => void;
}) {
  const grades = catalog.gradeSystem(climb.gradeSystemId)?.grades ?? [];
  const opinions = new Map<string, number>();
  for (const t of stats.ticks) if (t.grade) opinions.set(t.grade, (opinions.get(t.grade) ?? 0) + 1);
  const spread = [...opinions.entries()].sort((a, b) => grades.indexOf(a[0]) - grades.indexOf(b[0]));
  const rated = stats.ticks.filter((t) => t.stars > 0).length;

  return (
    <div className="popover info-panel" role="dialog" aria-label="Climb info">
      <div className="popover-head">
        <strong>{climb.name || 'Untitled'}</strong>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <dl className="info-list">
        <dt>Grade</dt>
        <dd>
          {climb.grade || '—'} <span className="muted small">setter</span>
          {stats.consensus && (
            <>
              <br />
              {stats.consensus} <span className="muted small">consensus</span>
            </>
          )}
          {spread.length > 0 && (
            <div className="muted small">{spread.map(([g, n]) => `${g} ×${n}`).join(' · ')}</div>
          )}
        </dd>
        {server && (
          <>
            <dt>Rating</dt>
            <dd>
              {rated ? (
                <>
                  <span className="stars">★ {stats.stars.toFixed(1)}</span> <span className="muted small">from {rated} {rated === 1 ? 'rating' : 'ratings'}</span>
                </>
              ) : (
                <span className="muted">Not rated yet</span>
              )}
            </dd>
          </>
        )}
        <dt>Set by</dt>
        <dd>
          {climb.setterName || <span className="muted">—</span>}
          <span className="muted small"> · {new Date(climb.createdAt).toLocaleDateString()}</span>
        </dd>
      </dl>
      {server && (
        <>
          <h3 className="panel-subtitle">Sends · {stats.count}</h3>
          {stats.ticks.length === 0 ? (
            <p className="muted small">No sends yet.</p>
          ) : (
            <ul className="tick-list">
              {stats.ticks.map((t) => (
                <li key={t.id}>
                  <div>
                    <strong>{t === stats.mine ? `${t.userName} (you)` : t.userName}</strong>
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
        </>
      )}
    </div>
  );
}
