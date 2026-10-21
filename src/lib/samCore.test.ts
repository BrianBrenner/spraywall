import { describe, expect, it } from 'vitest';
import { preferWithoutShadow } from './samCore';

const SIZE = 20;

/** Cells inside an axis-aligned rectangle on a SIZE×SIZE grid. */
function rect(x1: number, y1: number, x2: number, y2: number) {
  const cells = new Uint8Array(SIZE * SIZE);
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) cells[y * SIZE + x] = 1;
  return cells;
}

/** Wall at 0.7 brightness, a hold, and (optionally) a dark band under it. */
function scene(hold: number, shadow: number | null) {
  const luma = new Float32Array(SIZE * SIZE).fill(0.7);
  const h = rect(6, 6, 13, 11);
  h.forEach((v, i) => v && (luma[i] = hold));
  if (shadow !== null) rect(6, 12, 13, 14).forEach((v, i) => v && (luma[i] = shadow));
  return luma;
}

const holdOnly = rect(6, 6, 13, 11);
const holdPlusShadow = rect(6, 6, 13, 14);

describe('preferWithoutShadow', () => {
  it('drops a dark band that SAM added below the hold', () => {
    const luma = scene(0.6, 0.3);
    const pick = preferWithoutShadow([{ cells: holdPlusShadow, iou: 0.95 }, { cells: holdOnly, iou: 0.9 }], luma, SIZE);
    expect(pick).toBe(1);
  });

  it('keeps the bigger outline when the extra part is as bright as the hold (it is the hold)', () => {
    const luma = scene(0.6, 0.6);
    const pick = preferWithoutShadow([{ cells: holdPlusShadow, iou: 0.95 }, { cells: holdOnly, iou: 0.9 }], luma, SIZE);
    expect(pick).toBe(0);
  });

  it('keeps a dark hold whole instead of shrinking it', () => {
    // Black hold: the "extra" part is no darker than the rest of the hold.
    const luma = scene(0.15, 0.15);
    const pick = preferWithoutShadow([{ cells: holdPlusShadow, iou: 0.95 }, { cells: holdOnly, iou: 0.9 }], luma, SIZE);
    expect(pick).toBe(0);
  });
});
