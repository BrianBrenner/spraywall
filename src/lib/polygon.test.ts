import { describe, expect, it } from 'vitest';
import { convexHull, largestComponent, maskToPolygon, polygonArea, simplifyPolygon, type Point } from './polygon';

function grid(rows: string[]) {
  const h = rows.length;
  const w = rows[0].length;
  const g = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => (g[y * w + x] = c === '#' ? 1 : 0)));
  return { g, w, h };
}

describe('polygon helpers', () => {
  it('keeps only the largest blob', () => {
    const { g, w, h } = grid(['##...#', '##....', '......']);
    expect([...largestComponent(g, w, h)]).toEqual([1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('builds a convex hull', () => {
    const pts: Point[] = [[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]];
    expect(polygonArea(convexHull(pts))).toBe(4);
    expect(convexHull(pts)).toHaveLength(4);
  });

  it('simplifies a near-circle to at most 10 corners without losing much area', () => {
    const circle: Point[] = Array.from({ length: 64 }, (_, i) => [Math.cos((i / 64) * Math.PI * 2) * 50, Math.sin((i / 64) * Math.PI * 2) * 50]);
    const simple = simplifyPolygon(circle);
    expect(simple.length).toBeLessThanOrEqual(10);
    expect(polygonArea(simple) / polygonArea(circle)).toBeGreaterThan(0.9);
  });

  it('turns a mask into an outline in image coordinates, ignoring specks', () => {
    const { g, w, h } = grid([
      '..........',
      '..####....',
      '..#####...',
      '..####....',
      '.........#',
    ]);
    const poly = maskToPolygon(g, w, h, 100, 200, 2)!;
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    expect(Math.min(...xs)).toBe(104);
    expect(Math.max(...xs)).toBe(114);
    expect(Math.min(...ys)).toBe(202);
    expect(Math.max(...ys)).toBe(208);
  });
});
