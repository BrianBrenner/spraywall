import type { Hold, HoldShape } from '../types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function shapeBox(s: HoldShape): Box {
  if (s.type === 'ellipse') return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const bt = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: bt - y };
}

export function shapeCenter(s: HoldShape): [number, number] {
  if (s.type === 'ellipse') return [s.cx, s.cy];
  const b = shapeBox(s);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

export function shapePath(s: HoldShape): string {
  if (s.type === 'ellipse') {
    const { cx, cy, rx, ry } = s;
    return `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 ${-rx * 2},0Z`;
  }
  return 'M' + s.points.map((p) => `${p[0]},${p[1]}`).join('L') + 'Z';
}

export function translateShape(s: HoldShape, dx: number, dy: number): HoldShape {
  if (s.type === 'ellipse') return { ...s, cx: s.cx + dx, cy: s.cy + dy };
  return { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy]) };
}

export function scaleShape(s: HoldShape, sx: number, sy: number): HoldShape {
  if (s.type === 'ellipse') return { type: 'ellipse', cx: s.cx * sx, cy: s.cy * sy, rx: s.rx * sx, ry: s.ry * sy };
  return { type: 'polygon', points: s.points.map(([x, y]) => [x * sx, y * sy]) };
}

export function pointInShape(s: HoldShape, x: number, y: number): boolean {
  if (s.type === 'ellipse') {
    const dx = (x - s.cx) / s.rx;
    const dy = (y - s.cy) / s.ry;
    return dx * dx + dy * dy <= 1;
  }
  let inside = false;
  const pts = s.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Topmost hold containing the point, preferring the smallest when holds overlap. */
export function holdAt(holds: Hold[], x: number, y: number): Hold | undefined {
  let best: Hold | undefined;
  let bestArea = Infinity;
  for (const h of holds) {
    if (!pointInShape(h.shape, x, y)) continue;
    const b = shapeBox(h.shape);
    if (b.w * b.h < bestArea) {
      best = h;
      bestArea = b.w * b.h;
    }
  }
  return best;
}
