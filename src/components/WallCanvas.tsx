import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Box } from '../lib/geometry';

export interface DragHandlers {
  /** Return true to take over the drag (otherwise one-finger drags pan). */
  onDragStart?: (x: number, y: number, target: Element) => boolean;
  onDragMove?: (x: number, y: number) => void;
  onDragEnd?: () => void;
}

interface Props extends DragHandlers {
  image: string;
  width: number;
  height: number;
  /** SVG content drawn in image pixel coordinates. */
  children?: ReactNode;
  onTap?: (x: number, y: number, target: Element) => void;
  /** Region to fit on first layout (and whenever its value changes). Defaults to the whole photo. */
  focus?: Box | null;
  imageStyle?: React.CSSProperties;
  className?: string;
}

interface View {
  s: number;
  tx: number;
  ty: number;
}

const TAP_SLOP = 8;

const ScaleContext = createContext(1);

/** Current zoom (screen px per image px), for sizing handles that should stay a constant on-screen size. */
export const useViewScale = () => useContext(ScaleContext);

/**
 * Photo with an SVG overlay that supports pan and zoom: pinch / two-finger drag
 * on touch, trackpad scroll and pinch, mouse wheel to zoom.
 */
export function WallCanvas({ image, width, height, children, onTap, onDragStart, onDragMove, onDragEnd, focus, imageStyle, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ s: 0, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const handlers = useRef({ onTap, onDragStart, onDragMove, onDragEnd });
  handlers.current = { onTap, onDragStart, onDragMove, onDragEnd };

  const fitBox = useCallback(
    (box: Box) => {
      const el = containerRef.current;
      if (!el) return;
      const { clientWidth: cw, clientHeight: ch } = el;
      if (!cw || !ch) return;
      const pad = 16;
      const s = Math.min((cw - pad * 2) / box.w, (ch - pad * 2) / box.h, 4);
      setView({ s, tx: cw / 2 - (box.x + box.w / 2) * s, ty: ch / 2 - (box.y + box.h / 2) * s });
    },
    [],
  );

  const fitAll = useCallback(() => fitBox(focus ?? { x: 0, y: 0, w: width, h: height }), [fitBox, focus, width, height]);
  const focusKey = focus ? `${focus.x},${focus.y},${focus.w},${focus.h}` : `all:${width}x${height}`;
  useLayoutEffect(() => {
    fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      // Re-fit if we never managed to (container had no size yet).
      if (first || viewRef.current.s === 0) fitAll();
      first = false;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitAll]);

  const minScale = useCallback(() => {
    const el = containerRef.current!;
    return Math.min(el.clientWidth / width, el.clientHeight / height) * 0.5;
  }, [width, height]);

  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      setView((v) => {
        const s = Math.max(minScale(), Math.min(8, v.s * factor));
        const k = s / v.s;
        return { s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
      });
    },
    [minScale],
  );

  // Wheel must be non-passive to stop page scroll / browser zoom.
  useEffect(() => {
    const el = containerRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const isMouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || isMouseWheel) {
        zoomAt(px, py, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
      } else {
        setView((v) => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    mode: 'none' | 'pending' | 'pan' | 'drag' | 'pinch';
    startX: number;
    startY: number;
    target: Element | null;
    pinchDist: number;
    pinchMid: { x: number; y: number };
  }>({ mode: 'none', startX: 0, startY: 0, target: null, pinchDist: 0, pinchMid: { x: 0, y: 0 } });

  const toImage = (clientX: number, clientY: number): [number, number] => {
    const r = containerRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(clientX - r.left - v.tx) / v.s, (clientY - r.top - v.ty) / v.s];
  };

  const pinchInfo = () => {
    const [a, b] = [...pointers.current.values()];
    const r = containerRef.current!.getBoundingClientRect();
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top },
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    containerRef.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 2) {
      if (g.mode === 'drag') handlers.current.onDragEnd?.();
      const p = pinchInfo();
      Object.assign(g, { mode: 'pinch', pinchDist: p.dist, pinchMid: p.mid });
    } else if (pointers.current.size === 1) {
      Object.assign(g, { mode: 'pending', startX: e.clientX, startY: e.clientY, target: e.target as Element });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.mode === 'pinch' && pointers.current.size === 2) {
      const p = pinchInfo();
      const factor = p.dist / g.pinchDist;
      setView((v) => {
        const s = Math.max(minScale(), Math.min(8, v.s * factor));
        const k = s / v.s;
        return {
          s,
          tx: p.mid.x - (g.pinchMid.x - v.tx) * k,
          ty: p.mid.y - (g.pinchMid.y - v.ty) * k,
        };
      });
      g.pinchDist = p.dist;
      g.pinchMid = p.mid;
      return;
    }
    if (g.mode === 'pending') {
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < TAP_SLOP) return;
      const [sx, sy] = toImage(g.startX, g.startY);
      g.mode = handlers.current.onDragStart?.(sx, sy, g.target!) ? 'drag' : 'pan';
    }
    if (g.mode === 'drag') {
      handlers.current.onDragMove?.(...toImage(e.clientX, e.clientY));
    } else if (g.mode === 'pan') {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g.mode === 'pending' && e.type === 'pointerup') {
      handlers.current.onTap?.(...toImage(e.clientX, e.clientY), g.target!);
    } else if (g.mode === 'drag') {
      handlers.current.onDragEnd?.();
    }
    // After a pinch, the remaining finger shouldn't suddenly tap or drag.
    g.mode = pointers.current.size ? 'pan' : 'none';
  };

  const center = () => {
    const el = containerRef.current!;
    return [el.clientWidth / 2, el.clientHeight / 2] as const;
  };

  return (
    <div
      ref={containerRef}
      className={`wall-canvas ${className ?? ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="wall-canvas-stage"
        style={{ width, height, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, visibility: view.s ? 'visible' : 'hidden' }}
      >
        <img src={image} width={width} height={height} alt="" draggable={false} style={imageStyle} />
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
          <ScaleContext.Provider value={view.s || 1}>{children}</ScaleContext.Provider>
        </svg>
      </div>
      <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(...center(), 1.4)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(...center(), 1 / 1.4)}>−</button>
        <button type="button" aria-label="Fit" onClick={fitAll}>⤢</button>
      </div>
    </div>
  );
}
