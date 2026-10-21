import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { HoldOutline } from '../components/HoldOutline';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/ui';
import { useViewScale, WallCanvas } from '../components/WallCanvas';
import { db, deleteClimbs, latestVersion, newId } from '../db';
import { holdAt, shapeBox } from '../lib/geometry';
import { useHistory, useUndoKeys } from '../lib/history';
import { useCatalog, type Catalog } from '../lib/hooks';
import { blobUrl } from '../lib/image';
import { nextRole, ROLE_COLORS, ROLE_LABELS } from '../lib/roles';
import { renderThumbnail } from '../lib/thumbnail';
import type { Climb, ClimbHold, Hold, HoldRole, WallVersion } from '../types';

export function ClimbEditorPage() {
  const { climbId } = useParams();
  const [params] = useSearchParams();
  const catalog = useCatalog();
  const data = useLiveQuery(async () => {
    if (climbId) {
      const climb = await db.climbs.get(climbId);
      return climb ? { climb, version: await db.versions.get(climb.versionId) } : null;
    }
    const wallId = params.get('wall');
    const version = params.get('version') ? await db.versions.get(params.get('version')!) : wallId ? await latestVersion(wallId) : undefined;
    return { climb: undefined, version };
  }, [climbId]);

  if (!catalog || data === undefined) return null;
  if (!data?.version) return <div className="empty">Climb not found.</div>;
  return <ClimbEditor key={climbId ?? 'new'} catalog={catalog} climb={data.climb} version={data.version} />;
}

const ROLES: HoldRole[] = ['hand', 'start', 'foot', 'finish'];

function ClimbEditor({ catalog, climb, version }: { catalog: Catalog; climb?: Climb; version: WallVersion }) {
  const navigate = useNavigate();
  const history = useHistory<ClimbHold[]>(climb?.holds ?? []);
  useUndoKeys(history.undo, history.redo);
  const [name, setName] = useState(climb?.name ?? '');
  const [gradeSystemId, setGradeSystemId] = useState(climb?.gradeSystemId ?? catalog.defaultGradeSystemId);
  const [grade, setGrade] = useState(climb?.grade ?? '');
  const [footRuleId, setFootRuleId] = useState(climb?.footRuleId ?? catalog.defaultFootRuleId);
  const [noMatching, setNoMatching] = useState(climb?.noMatching ?? false);
  const [benchmark, setBenchmark] = useState(climb?.benchmark ?? false);
  const [tagIds, setTagIds] = useState<string[]>(climb?.tagIds ?? []);
  const [notes, setNotes] = useState(climb?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const roles = new Map(history.value.map((h) => [h.holdId, h.role]));
  const system = catalog.gradeSystem(gradeSystemId);

  const onTap = (x: number, y: number) => {
    const hit = holdAt(version.holds, x, y);
    if (!hit) return;
    history.set((hs) => {
      const role = nextRole(hs.find((h) => h.holdId === hit.id)?.role ?? null);
      const rest = hs.filter((h) => h.holdId !== hit.id);
      return role ? [...rest, { holdId: hit.id, role }] : rest;
    });
  };

  const save = async () => {
    setSaving(true);
    const now = Date.now();
    const draft: Climb = {
      id: climb?.id ?? newId(),
      wallId: version.wallId,
      versionId: version.id,
      name: name.trim(),
      gradeSystemId,
      grade,
      footRuleId,
      noMatching,
      benchmark,
      tagIds,
      notes: notes.trim(),
      holds: history.value,
      createdAt: climb?.createdAt ?? now,
      updatedAt: now,
    };
    draft.thumbnail = await renderThumbnail(draft, version);
    await db.climbs.put(draft);
    navigate(`/climbs/${draft.id}`, { replace: true });
  };

  const remove = async () => {
    if (!climb || !confirm(`Delete "${climb.name || 'Untitled'}"?`)) return;
    await deleteClimbs([climb.id]);
    navigate(`/walls/${climb.wallId}`, { replace: true });
  };

  const counts = ROLES.map((r) => [r, history.value.filter((h) => h.role === r).length] as const);

  return (
    <div className="editor climb-editor">
      <PageHeader title={climb ? 'Edit climb' : 'New climb'} back>
        <button type="button" className="icon-btn" aria-label="Undo" onClick={history.undo} disabled={!history.canUndo}>
          <Icon name="undo" />
        </button>
        <button type="button" className="icon-btn" aria-label="Redo" onClick={history.redo} disabled={!history.canRedo}>
          <Icon name="redo" />
        </button>
        <button type="button" className="btn primary" disabled={!history.value.length || saving} onClick={save}>Save</button>
      </PageHeader>
      <div className="split">
        <div className="split-canvas">
          <WallCanvas image={blobUrl(version.image)} width={version.width} height={version.height} onTap={onTap}>
            {version.holds.map((h) => {
              const role = roles.get(h.id);
              return role ? (
                <HoldOutline key={h.id} shape={h.shape} color={ROLE_COLORS[role]} width={3.5} fill={`${ROLE_COLORS[role]}33`} />
              ) : (
                <HoldOutline key={h.id} shape={h.shape} color="rgba(255,255,255,0.45)" width={1} halo={false} />
              );
            })}
            {version.holds.map((h) => {
              const role = roles.get(h.id);
              return role && role !== 'hand' ? <RoleTag key={`tag-${h.id}`} hold={h} role={role} /> : null;
            })}
          </WallCanvas>
          <div className="role-legend">
            {counts.map(([r, n]) => (
              <span key={r}>
                <i style={{ background: ROLE_COLORS[r] }} /> {ROLE_LABELS[r]} {n > 0 && <b>{n}</b>}
              </span>
            ))}
            <span className="muted">Tap a hold to cycle</span>
          </div>
        </div>
        <form className="split-panel form" onSubmit={(e) => e.preventDefault()}>
          {version.holds.length === 0 && <p className="error">This photo has no holds outlined yet.</p>}
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled" />
          </label>
          <div className="row">
            <label>
              Grade
              <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                <option value="">—</option>
                {system?.grades.map((g) => <option key={g}>{g}</option>)}
                {grade && !system?.grades.includes(grade) && <option>{grade}</option>}
              </select>
            </label>
            {catalog.gradeSystems.length > 1 && (
              <label>
                System
                <select value={gradeSystemId} onChange={(e) => { setGradeSystemId(e.target.value); setGrade(''); }}>
                  {catalog.gradeSystems.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <label>
            Feet
            <select value={footRuleId} onChange={(e) => setFootRuleId(e.target.value)}>
              {catalog.footRules.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={noMatching} onChange={(e) => setNoMatching(e.target.checked)} />
            No matching
          </label>
          <label className="check">
            <input type="checkbox" checked={benchmark} onChange={(e) => setBenchmark(e.target.checked)} />
            Benchmark
            <span className="muted small">a reference climb for its grade</span>
          </label>
          <fieldset>
            <legend>Tags</legend>
            <div className="chips">
              {catalog.tags.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button
                    type="button"
                    key={t.id}
                    className={`chip ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setTagIds(on ? tagIds.filter((id) => id !== t.id) : [...tagIds, t.id])}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label>
            Notes / beta
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {climb && (
            <button type="button" className="btn ghost danger" onClick={remove}>
              <Icon name="trash" size={18} /> Delete climb
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

const TAG_TEXT: Partial<Record<HoldRole, string>> = { start: 'Start', foot: 'Foot', finish: 'Finish' };

/** Small label above a hold's top-right corner, a constant size on screen at any zoom. */
function RoleTag({ hold, role }: { hold: Hold; role: HoldRole }) {
  const s = useViewScale();
  const text = TAG_TEXT[role];
  if (!text) return null;
  const b = shapeBox(hold.shape);
  const font = 11 / s;
  const h = 18 / s;
  const w = (text.length * 6.6 + 12) / s;
  const x = b.x + b.w - w * 0.6;
  const y = b.y - h * 0.7;
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={w} height={h} rx={5 / s} fill={ROLE_COLORS[role]} stroke="rgba(0,0,0,0.45)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <text x={x + w / 2} y={y + h / 2} fontSize={font} fontWeight={700} fill={role === 'start' ? '#052e16' : '#ffffff'} textAnchor="middle" dominantBaseline="central">
        {text}
      </text>
    </g>
  );
}
