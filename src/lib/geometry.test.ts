import { describe, expect, it } from 'vitest';
import type { Hold } from '../types';
import { holdAt, pointInShape, scaleShape } from './geometry';
import { nextRole } from './roles';

describe('geometry', () => {
  const square: Hold = { id: 'sq', shape: { type: 'polygon', points: [[0, 0], [100, 0], [100, 100], [0, 100]] } };
  const small: Hold = { id: 'small', shape: { type: 'ellipse', cx: 50, cy: 50, rx: 10, ry: 5 } };

  it('hit-tests ellipses and polygons', () => {
    expect(pointInShape(small.shape, 58, 50)).toBe(true);
    expect(pointInShape(small.shape, 50, 58)).toBe(false);
    expect(pointInShape(square.shape, 99, 1)).toBe(true);
    expect(pointInShape(square.shape, 101, 50)).toBe(false);
  });

  it('prefers the smallest hold when outlines overlap', () => {
    expect(holdAt([square, small], 50, 50)?.id).toBe('small');
    expect(holdAt([square, small], 10, 10)?.id).toBe('sq');
    expect(holdAt([square, small], 200, 200)).toBeUndefined();
  });

  it('scales shapes to a new photo size', () => {
    expect(scaleShape(small.shape, 2, 0.5)).toEqual({ type: 'ellipse', cx: 100, cy: 25, rx: 20, ry: 2.5 });
  });

  it('cycles roles hand → start → foot → finish → off', () => {
    const seen = [];
    let r = nextRole(null);
    while (r) {
      seen.push(r);
      r = nextRole(r);
    }
    expect(seen).toEqual(['hand', 'start', 'foot', 'finish']);
  });
});

describe('combined grades', () => {
  it('maps V and Font grades onto the combined scale', async () => {
    const { combinedGrade } = await import('../db');
    expect(combinedGrade('V4')).toBe('V4 / 6B');
    expect(combinedGrade('6B+')).toBe('V4 / 6B+');
    expect(combinedGrade('7A')).toBe('V6 / 7A');
    expect(combinedGrade('nope')).toBeUndefined();
  });
});
