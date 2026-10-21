import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HoldOutline } from '../components/HoldOutline';
import { Icon, type IconName } from '../components/Icon';
import { OwnerOnly, PageHeader } from '../components/ui';
import { usePermissions } from '../lib/permissions';
import { useViewScale, WallCanvas } from '../components/WallCanvas';
import { db, newId } from '../db';
import { detectHolds, detectionToShape, newDetections, type Detection } from '../lib/detect';
import { holdAt, shapePath, translateShape } from '../lib/geometry';
import { saveHolds } from '../lib/mutations';
import { HoldTracer, refineOutlines } from '../lib/sam';
import { useHistory, useUndoKeys } from '../lib/history';
import { blobUrl } from '../lib/image';
import type { Hold, HoldShape, WallVersion } from '../types';

type Tool = 'select' | 'circle' | 'polygon' | 'trace' | 'moveAll';

export function HoldEditorPage() {
  const { isOwner } = usePermissions();
  if (!isOwner) return <OwnerOnly />;
  return <HoldEditorRoute />;
}

function HoldEditorRoute() {
  const { versionId } = useParams();
  const version = useLiveQuery(() => db.versions.get(versionId!), [versionId]);
  if (version === undefined) return null;
  return <HoldEditor key={version.id} version={version} />;
}

type DetectionState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'message'; message: string }
  | { status: 'refining'; done: number; total: number }
  | { status: 'review'; detections: Detection[]; minScore: number; rejected: Set<Detection> };

type DragState =
  | { kind: 'move'; id: string; lastX: number; lastY: number }
  | { kind: 'moveAll'; lastX: number; lastY: number }
  | { kind: 'vertex'; id: string; index: number }
  | { kind: 'radius'; id: string; axis: 'x' | 'y' | 'both' };

function HoldEditor({ version }: { version: WallVersion }) {
  const history = useHistory<Hold[]>(version.holds);
  const holds = history.value;
  const [tool, setTool] = useState<Tool>(version.holds.length ? 'select' : 'circle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const drag = useRef<DragState | null>(null);
  const [detection, setDetection] = useState<DetectionState>({ status: 'idle' });
  useUndoKeys(history.undo, history.redo);

  const usage = useLiveQuery(async () => {
    const counts = new Map<string, number>();
    await db.climbs.where('versionId').equals(version.id).each((c) => {
      for (const h of c.holds) counts.set(h.holdId, (counts.get(h.holdId) ?? 0) + 1);
    });
    return counts;
  }, [version.id]);

  // Autosave; the undo history lives in memory only.
  const saved = useRef(version.holds);
  useEffect(() => {
    if (holds === saved.current) return;
    const t = setTimeout(() => {
      saved.current = holds;
      saveHolds(version.id, holds).catch((e) => setDetection({ status: 'error', message: `Couldn’t save: ${(e as Error).message}` }));
    }, 600);
    return () => clearTimeout(t);
  }, [holds, version.id]);
  const latest = useRef(holds);
  latest.current = holds;
  useEffect(
    () => () => {
      // Flush on leave.
      if (latest.current !== saved.current) saveHolds(version.id, latest.current).catch(() => {});
    },
    [version.id],
  );

  const selected = holds.find((h) => h.id === selectedId);
  const selectedUses = selected ? usage?.get(selected.id) ?? 0 : 0;
  const defaultRadius = useMemo(() => {
    const radii = holds.flatMap((h) => (h.shape.type === 'ellipse' ? [(h.shape.rx + h.shape.ry) / 2] : []));
    if (!radii.length) return Math.max(version.width, version.height) / 70;
    radii.sort((a, b) => a - b);
    return radii[Math.floor(radii.length / 2)];
  }, [holds, version.width, version.height]);

  const updateShape = (id: string, f: (s: HoldShape) => HoldShape) =>
    history.replace((hs) => hs.map((h) => (h.id === id ? { ...h, shape: f(h.shape) } : h)));

  const addHold = (shape: HoldShape) => {
    const hold = { id: newId(), shape };
    history.set((hs) => [...hs, hold]);
    setSelectedId(hold.id);
    return hold;
  };

  const deleteSelected = () => {
    if (!selected || selectedUses > 0) return;
    history.set((hs) => hs.filter((h) => h.id !== selected.id));
    setSelectedId(null);
  };

  const finishPolygon = () => {
    if (draft.length >= 3) addHold({ type: 'polygon', points: draft });
    setDraft([]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === 'Escape') {
        setDraft([]);
        setSelectedId(null);
      } else if (e.key === 'Enter' && draft.length) finishPolygon();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const suggestions =
    detection.status === 'review'
      ? newDetections(detection.detections, holds).filter((d) => d.score >= detection.minScore && !detection.rejected.has(d))
      : [];

  const runDetection = async () => {
    setDraft([]);
    setSelectedId(null);
    setDetection({ status: 'running' });
    try {
      const detections = await detectHolds(version.image, version.width, version.height);
      setDetection({ status: 'review', detections, minScore: 0.5, rejected: new Set() });
    } catch (e) {
      setDetection({ status: 'error', message: (e as Error).message || 'Detection failed.' });
    }
  };

  const ellipseCount = holds.filter((h) => h.shape.type === 'ellipse').length;
  const busy = detection.status === 'running' || detection.status === 'refining' || detection.status === 'review';

  const runRefine = async () => {
    setSelectedId(null);
    setDetection({ status: 'refining', done: 0, total: ellipseCount });
    try {
      const shapes = await refineOutlines(version.image, version.width, version.height, holds, (done, total) =>
        setDetection({ status: 'refining', done, total }),
      );
      // One history step; holds edited or deleted meanwhile keep their current state.
      history.set((hs) => hs.map((h) => (shapes.has(h.id) && h.shape.type === 'ellipse' ? { ...h, shape: shapes.get(h.id)! } : h)));
      const kept = ellipseCount - shapes.size;
      setDetection({
        status: 'message',
        message: `Refined ${shapes.size} outline${shapes.size === 1 ? '' : 's'}.` + (kept ? ` ${kept} kept as circles where the hold blends into the wall.` : ''),
      });
    } catch (e) {
      setDetection({ status: 'error', message: (e as Error).message || 'Refining outlines failed.' });
    }
  };

  const tracer = useMemo(() => new HoldTracer(version.image, version.width, version.height), [version.image, version.width, version.height]);
  const [tracing, setTracing] = useState(false);
  /** Trace a new hold, or re-trace `existing` in place (same id, so climbs keep it). */
  const traceAt = async (x: number, y: number, existing?: Hold) => {
    setTracing(true);
    try {
      const shape = await tracer.trace(x, y, existing?.shape);
      if (shape) {
        if (existing) {
          history.set((hs) => hs.map((h) => (h.id === existing.id ? { ...h, shape } : h)));
          setSelectedId(existing.id);
        } else {
          addHold(shape);
        }
        if (detection.status === 'message') setDetection({ status: 'idle' });
      } else {
        setDetection({ status: 'message', message: 'Couldn’t find a hold there. Try tapping its middle, or use Circle or Shape.' });
      }
    } catch (e) {
      setDetection({ status: 'error', message: (e as Error).message || 'Tracing failed.' });
    } finally {
      setTracing(false);
    }
  };

  const acceptSuggestions = () => {
    // One history step, so a single Undo removes the whole batch.
    history.set((hs) => [...hs, ...suggestions.map((d) => ({ id: newId(), shape: detectionToShape(d) }))]);
    setDetection({ status: 'idle' });
  };

  const onTap = (x: number, y: number, target: Element) => {
    if (detection.status === 'review') {
      // Tap a suggestion to drop it.
      const hit = suggestions.find((d) => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h);
      if (hit) setDetection({ ...detection, rejected: new Set(detection.rejected).add(hit) });
      return;
    }
    if (tool === 'polygon') {
      if (target.closest('[data-close]') && draft.length >= 3) finishPolygon();
      else setDraft((d) => [...d, [x, y]]);
      return;
    }
    if (tool === 'moveAll') return;
    const hit = holdAt(holds, x, y);
    if (tool === 'trace') {
      if (!tracing) traceAt(x, y, hit);
    } else if (hit) setSelectedId(hit.id === selectedId && tool === 'select' ? null : hit.id);
    else if (tool === 'circle') addHold({ type: 'ellipse', cx: x, cy: y, rx: defaultRadius, ry: defaultRadius });
    else setSelectedId(null);
  };

  const onDragStart = (x: number, y: number, target: Element) => {
    if (detection.status === 'review') return false;
    if (tool === 'moveAll') {
      if (!holds.length) return false;
      history.checkpoint();
      drag.current = { kind: 'moveAll', lastX: x, lastY: y };
      return true;
    }
    const handle = (target as HTMLElement).dataset;
    if (selected && handle.vertex !== undefined) {
      history.checkpoint();
      drag.current = { kind: 'vertex', id: selected.id, index: Number(handle.vertex) };
      return true;
    }
    if (selected && handle.radius) {
      history.checkpoint();
      drag.current = { kind: 'radius', id: selected.id, axis: handle.radius as 'x' | 'y' | 'both' };
      return true;
    }
    if (tool === 'polygon') return false;
    const hit = holdAt(holds, x, y);
    if (hit && (hit.id === selectedId || tool === 'select')) {
      setSelectedId(hit.id);
      history.checkpoint();
      drag.current = { kind: 'move', id: hit.id, lastX: x, lastY: y };
      return true;
    }
    if (!hit && tool === 'circle') {
      const hold = addHold({ type: 'ellipse', cx: x, cy: y, rx: 1, ry: 1 });
      drag.current = { kind: 'radius', id: hold.id, axis: 'both' };
      return true;
    }
    return false;
  };

  const onDragMove = (x: number, y: number) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'move' || d.kind === 'moveAll') {
      const dx = x - d.lastX;
      const dy = y - d.lastY;
      d.lastX = x;
      d.lastY = y;
      if (d.kind === 'move') updateShape(d.id, (s) => translateShape(s, dx, dy));
      else history.replace((hs) => hs.map((h) => ({ ...h, shape: translateShape(h.shape, dx, dy) })));
    } else if (d.kind === 'vertex') {
      updateShape(d.id, (s) =>
        s.type === 'polygon' ? { ...s, points: s.points.map((p, i) => (i === d.index ? [x, y] : p)) } : s,
      );
    } else {
      updateShape(d.id, (s) => {
        if (s.type !== 'ellipse') return s;
        const rx = Math.max(4, Math.abs(x - s.cx));
        const ry = Math.max(4, Math.abs(y - s.cy));
        if (d.axis === 'both') {
          const r = Math.max(4, Math.hypot(x - s.cx, y - s.cy));
          return { ...s, rx: r, ry: r };
        }
        return d.axis === 'x' ? { ...s, rx } : { ...s, ry };
      });
    }
  };

  const switchTool = (t: Tool) => {
    if (draft.length) finishPolygon();
    setTool(t);
  };

  return (
    <div className="editor">
      <PageHeader title={`Holds · photo v${version.number}`} back={`/walls/${version.wallId}`}>
        <span className="muted small">{holds.length} holds</span>
        <Link className="btn primary" to={`/walls/${version.wallId}`}>Done</Link>
      </PageHeader>
      <WallCanvas
        image={blobUrl(version.image)}
        width={version.width}
        height={version.height}
        onTap={onTap}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={() => (drag.current = null)}
      >
        {holds.map((h) => (
          <HoldOutline
            key={h.id}
            shape={h.shape}
            color={h.id === selectedId ? '#fb923c' : usage?.get(h.id) ? '#ffffff' : '#a5f3fc'}
            fill={h.id === selectedId ? 'rgba(251,146,60,0.25)' : 'none'}
          />
        ))}
        {selected && <Handles hold={selected} />}
        {draft.length > 0 && <PolygonDraft points={draft} />}
        {suggestions.map((d, i) => (
          <HoldOutline key={i} shape={detectionToShape(d)} color="#4ade80" width={2} strokeDasharray="5 4" />
        ))}
      </WallCanvas>
      {detection.status !== 'idle' && (
        <div className="detect-panel">
          {detection.status === 'running' && <span>Finding holds… the first run downloads the model (14 MB).</span>}
          {detection.status === 'refining' && (
            <span>
              Refining outlines… {detection.done} / {detection.total}
              {detection.done === 0 && ' (the first run downloads the model, 14 MB)'}
            </span>
          )}
          {(detection.status === 'error' || detection.status === 'message') && (
            <>
              <span className={detection.status === 'error' ? 'error' : ''}>{detection.message}</span>
              <button type="button" className="btn" onClick={() => setDetection({ status: 'idle' })}>Close</button>
            </>
          )}
          {detection.status === 'review' && (
            <>
              <label className="detect-slider">
                <span>
                  {suggestions.length} new {suggestions.length === 1 ? 'hold' : 'holds'} · tap one to drop it
                </span>
                <span className="muted small">
                  Fewer
                  <input
                    type="range"
                    min={0.2}
                    max={0.9}
                    step={0.05}
                    // Slider reads "more holds" to the right, i.e. lower confidence cutoff.
                    value={1.1 - detection.minScore}
                    onChange={(e) => setDetection({ ...detection, minScore: 1.1 - Number(e.target.value) })}
                    aria-label="How many suggestions to show"
                  />
                  More
                </span>
              </label>
              <div className="toolbar-group">
                <button type="button" className="btn" onClick={() => setDetection({ status: 'idle' })}>Cancel</button>
                <button type="button" className="btn primary" disabled={!suggestions.length} onClick={acceptSuggestions}>
                  Add {suggestions.length} {suggestions.length === 1 ? 'hold' : 'holds'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="toolbar">
        <div className="segmented">
          <ToolButton tool="select" current={tool} onPick={switchTool} icon="pointer" label="Select" />
          <ToolButton tool="circle" current={tool} onPick={switchTool} icon="circle" label="Circle" />
          <ToolButton tool="polygon" current={tool} onPick={switchTool} icon="shape" label="Shape" />
          <ToolButton tool="trace" current={tool} onPick={switchTool} icon="trace" label={tracing ? 'Tracing…' : 'Trace'} />
          <ToolButton tool="moveAll" current={tool} onPick={switchTool} icon="move" label="Move all" />
        </div>
        <div className="toolbar-group">
          <button type="button" className="btn tonal" disabled={busy} onClick={runDetection}>
            <Icon name="sparkles" size={18} /> Detect holds
          </button>
          <button type="button" className="btn tonal" disabled={busy || !ellipseCount} onClick={runRefine} title="Turn circles into outlines that follow each hold">
            <Icon name="wand" size={18} /> Refine outlines
          </button>
        </div>
        <div className="toolbar-group">
          <button type="button" className="icon-btn" aria-label="Undo" onClick={history.undo} disabled={!history.canUndo}>
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-btn" aria-label="Redo" onClick={history.redo} disabled={!history.canRedo}>
            <Icon name="redo" />
          </button>
          {draft.length > 0 ? (
            <>
              <button type="button" className="btn" onClick={() => setDraft([])}>Cancel</button>
              <button type="button" className="btn primary" disabled={draft.length < 3} onClick={finishPolygon}>Finish shape</button>
            </>
          ) : (
            <button
              type="button"
              className="btn ghost danger"
              disabled={!selected || selectedUses > 0}
              title={selectedUses ? 'Used by climbs on this photo' : undefined}
              onClick={deleteSelected}
            >
              <Icon name="trash" size={18} />
              {selectedUses ? `In ${selectedUses} climb${selectedUses > 1 ? 's' : ''}` : 'Delete'}
            </button>
          )}
        </div>
      </div>
      <p className="toolbar-hint">{HINTS[tool]}</p>
    </div>
  );
}

const HINTS: Record<Tool, string> = {
  select: 'Tap a hold to select it. Drag it to move; drag the dots to reshape.',
  circle: 'Tap a hold to add a circle; drag to size it as you place it.',
  polygon: 'Tap around a hold’s edge, then tap the first point or Finish shape.',
  trace: 'Tap a hold to outline it, or tap an existing outline to redo it.',
  moveAll: 'Drag to shift every outline at once, e.g. to line up copied holds with a new photo.',
};

function ToolButton({ tool, current, onPick, icon, label }: { tool: Tool; current: Tool; onPick: (t: Tool) => void; icon: IconName; label: string }) {
  return (
    <button type="button" className={tool === current ? 'active' : ''} aria-pressed={tool === current} onClick={() => onPick(tool)}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}

function Handles({ hold }: { hold: Hold }) {
  const s = useViewScale();
  // Small dot to look at, larger invisible circle for fingers.
  const handle = (key: string | number, x: number, y: number, data: Record<string, string | number>, light = false) => (
    <g key={key} className="handle">
      <circle cx={x} cy={y} r={7 / s} fill={light ? 'white' : '#fb923c'} stroke={light ? '#fb923c' : 'white'} strokeWidth={2} vectorEffect="non-scaling-stroke" {...data} />
      <circle cx={x} cy={y} r={18 / s} fill="transparent" {...data} />
    </g>
  );
  if (hold.shape.type === 'polygon') {
    return <g>{hold.shape.points.map(([x, y], i) => handle(i, x, y, { 'data-vertex': i }))}</g>;
  }
  const { cx, cy, rx, ry } = hold.shape;
  return (
    <g>
      {handle('x', cx + rx, cy, { 'data-radius': 'x' })}
      {handle('y', cx, cy + ry, { 'data-radius': 'y' })}
      {handle('both', cx + rx * Math.SQRT1_2, cy - ry * Math.SQRT1_2, { 'data-radius': 'both' }, true)}
    </g>
  );
}

function PolygonDraft({ points }: { points: [number, number][] }) {
  const s = useViewScale();
  const d = 'M' + points.map((p) => p.join(',')).join('L');
  return (
    <g>
      <path d={d} fill="rgba(251,146,60,0.2)" stroke="#fb923c" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={(i === 0 ? 12 : 6) / s} fill={i === 0 ? 'white' : '#fb923c'} stroke="#fb923c" strokeWidth={2} vectorEffect="non-scaling-stroke" data-close={i === 0 ? '' : undefined} />
      ))}
      {points.length >= 3 && <path d={shapePath({ type: 'polygon', points })} fill="none" stroke="#fb923c" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
    </g>
  );
}
