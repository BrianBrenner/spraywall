import { describe, expect, it } from 'vitest';
import type { Hold } from '../types';
import { decodeDetections, detectionToShape, newDetections } from './detect';

/** Build a [1, 5, n] output from (cx, cy, w, h, score) rows. */
function output(rows: number[][]) {
  const n = rows.length;
  const data = new Float32Array(5 * n);
  rows.forEach((r, i) => r.forEach((v, c) => (data[c * n + i] = v)));
  return { data, n };
}

describe('decodeDetections', () => {
  it('drops low scores, removes overlapping duplicates and rescales', () => {
    const { data, n } = output([
      [100, 100, 40, 40, 0.9],
      [102, 101, 40, 40, 0.8], // duplicate of the first
      [300, 300, 20, 10, 0.7],
      [500, 500, 20, 20, 0.05], // too unsure
    ]);
    const dets = decodeDetections(data, n, 2);
    expect(dets).toHaveLength(2);
    expect(dets[0]).toEqual({ x: 40, y: 40, w: 20, h: 20, score: expect.closeTo(0.9) });
    expect(dets[1]).toMatchObject({ x: 145, y: 147.5, w: 10, h: 5 });
  });
});

describe('newDetections', () => {
  const existing: Hold[] = [{ id: 'a', shape: { type: 'ellipse', cx: 50, cy: 50, rx: 10, ry: 10 } }];

  it('skips detections on holds that are already outlined', () => {
    const dets = [
      { x: 40, y: 40, w: 20, h: 20, score: 0.9 }, // same hold
      { x: 30, y: 45, w: 50, h: 30, score: 0.9 }, // contains the existing hold's centre
      { x: 200, y: 200, w: 20, h: 20, score: 0.9 }, // new
    ];
    expect(newDetections(dets, existing)).toEqual([dets[2]]);
  });

  it('turns a box into the ellipse inside it', () => {
    expect(detectionToShape({ x: 10, y: 20, w: 40, h: 20, score: 1 })).toEqual({ type: 'ellipse', cx: 30, cy: 30, rx: 20, ry: 10 });
  });
});
