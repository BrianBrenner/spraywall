export type Point = [number, number];

/**
 * Keep only the largest 4-connected blob of a binary grid (drops stray specks
 * that would otherwise drag the outline out).
 */
export function largestComponent(grid: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(w * h);
  const stack: number[] = [];
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!grid[start] || label[start]) continue;
    next++;
    let size = 0;
    stack.push(start);
    label[start] = next;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const n of neighbours) {
        if (n >= 0 && n < w * h && grid[n] && !label[n]) {
          label[n] = next;
          stack.push(n);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = label[i] === best && best > 0 ? 1 : 0;
  return out;
}

/** Monotone-chain convex hull, counter-clockwise, no repeated end point. */
export function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/**
 * Repeatedly drop the vertex whose removal changes the area least, until the
 * polygon has at most `maxPoints` and every remaining corner matters
 * (removing it would change the area by more than `minFraction`).
 */
export function simplifyPolygon(poly: Point[], maxPoints = 10, minFraction = 0.01): Point[] {
  const p = [...poly];
  const total = polygonArea(poly);
  while (p.length > 4) {
    let best = -1;
    let bestArea = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length];
      const b = p[i];
      const c = p[(i + 1) % p.length];
      const t = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      if (t < bestArea) {
        bestArea = t;
        best = i;
      }
    }
    if (p.length <= maxPoints && bestArea > total * minFraction) break;
    p.splice(best, 1);
  }
  return p;
}

/**
 * Binary mask (grid at `scale` image pixels per cell, top-left at `ox, oy`) to
 * a simple outline like hand-drawn hold shapes: largest blob → convex hull → ≤10 corners.
 */
export function maskToPolygon(grid: Uint8Array, w: number, h: number, ox: number, oy: number, scale = 1): Point[] | null {
  const blob = largestComponent(grid, w, h);
  const edge: Point[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!blob[y * w + x]) continue;
      // Pixel corners, so the hull wraps the pixels rather than their centres.
      const left = x === 0 || !blob[y * w + x - 1];
      const right = x === w - 1 || !blob[y * w + x + 1];
      if (!left && !right) continue;
      edge.push([ox + x * scale, oy + y * scale], [ox + (x + 1) * scale, oy + y * scale]);
      edge.push([ox + x * scale, oy + (y + 1) * scale], [ox + (x + 1) * scale, oy + (y + 1) * scale]);
    }
  }
  if (edge.length < 12) return null;
  const hull = convexHull(edge);
  return hull.length >= 3 ? simplifyPolygon(hull) : null;
}
