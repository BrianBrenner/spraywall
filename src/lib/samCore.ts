/**
 * Segment Anything (SlimSAM) pre/post-processing, independent of the browser so
 * it can be exercised from Node. Model I/O:
 *   encoder: pixel_values [1,3,1024,1024] → image_embeddings, image_positional_embeddings [1,256,64,64]
 *   decoder: input_points [1,n,k,2] (1024-space), input_labels [1,n,k] int64,
 *            embeddings → iou_scores [1,n,3], pred_masks [1,n,3,256,256] (logits over the padded 1024 input)
 */
import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { maskToPolygon, type Point } from './polygon';

export const SAM_SIZE = 1024;
const MASK_SIZE = 256;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

type TensorCtor = new (type: 'float32' | 'int64', data: Float32Array | BigInt64Array, dims: number[]) => Tensor;

/** A crop of the photo (photo pixels) and the factor that scales it to SAM's 1024 input. */
export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Embedding {
  tile: Tile;
  feeds: Record<string, Tensor>;
  /** Brightness (0–1) on the 256×256 mask grid, for telling shadows from holds. */
  luma?: Float32Array;
}

export function makeTile(x: number, y: number, w: number, h: number): Tile {
  return { x, y, w, h, scale: SAM_SIZE / Math.max(w, h) };
}

/**
 * Overlapping crops of about 1024 photo pixels. Holds are small, so cropping
 * makes them ~2.5× bigger in SAM's input than a whole-photo pass would.
 */
export function planTiles(width: number, height: number, size = SAM_SIZE, overlap = 300): Tile[] {
  const tw = Math.min(size, width);
  const th = Math.min(size, height);
  const starts = (total: number, t: number) => {
    const out: number[] = [];
    for (let p = 0; ; p += t - overlap) {
      out.push(Math.min(p, total - t));
      if (p + t >= total) break;
    }
    return out;
  };
  return starts(height, th).flatMap((y) => starts(width, tw).map((x) => makeTile(x, y, tw, th)));
}

/** Tile that fully contains the box with the most margin (falls back to the nearest centre). */
export function bestTile(tiles: Tile[], b: Box): number {
  let best = -1;
  let bestScore = -Infinity;
  const cx = (b.x1 + b.x2) / 2;
  const cy = (b.y1 + b.y2) / 2;
  tiles.forEach((t, i) => {
    const margin = Math.min(b.x1 - t.x, b.y1 - t.y, t.x + t.w - b.x2, t.y + t.h - b.y2);
    const score = margin >= 0 ? margin : -1e6 - Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** RGBA pixels of the tile already resized so its long edge is ≤1024 → normalised, zero-padded CHW. */
export function preprocess(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const plane = SAM_SIZE * SAM_SIZE;
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = y * SAM_SIZE + x;
      for (let c = 0; c < 3; c++) out[c * plane + o] = (rgba[i + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  return out;
}

/** Average brightness of each 4×4 block of the (≤1024px) tile, i.e. one value per mask cell. */
export function lumaGrid(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const out = new Float32Array(MASK_SIZE * MASK_SIZE);
  for (let my = 0; my < Math.ceil(h / 4); my++) {
    for (let mx = 0; mx < Math.ceil(w / 4); mx++) {
      let sum = 0;
      let n = 0;
      for (let y = my * 4; y < Math.min(h, my * 4 + 4); y++) {
        for (let x = mx * 4; x < Math.min(w, mx * 4 + 4); x++) {
          const i = (y * w + x) * 4;
          sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          n++;
        }
      }
      out[my * MASK_SIZE + mx] = sum / n / 255;
    }
  }
  return out;
}

export async function encode(encoder: InferenceSession, Tensor: TensorCtor, tile: Tile, pixels: Float32Array, luma?: Float32Array): Promise<Embedding> {
  const out = await encoder.run({ pixel_values: new Tensor('float32', pixels, [1, 3, SAM_SIZE, SAM_SIZE]) });
  return { tile, luma, feeds: { image_embeddings: out.image_embeddings, image_positional_embeddings: out.image_positional_embeddings } };
}

/**
 * Of SAM's candidate masks (cells on the 256 grid), the best-scoring one —
 * unless a smaller candidate covers the same hold and the extra band the bigger
 * one adds is darker than both the hold and the wall around it. That band is
 * the hold's shadow, so the smaller mask is the better outline.
 */
export function preferWithoutShadow(cands: { cells: Uint8Array; iou: number }[], luma: Float32Array, size = MASK_SIZE): number {
  if (!cands.length) return -1;
  const area = (c: Uint8Array) => c.reduce((s, v) => s + v, 0);
  const order = cands.map((_, i) => i).sort((a, b) => cands[b].iou - cands[a].iou);
  const best = order[0];
  const big = cands[best].cells;
  const bigArea = area(big);
  const mean = (pick: (i: number) => boolean) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < size * size; i++) if (pick(i)) (sum += luma[i], n++);
    return n ? sum / n : NaN;
  };
  // A band just outside the big mask stands in for "the wall around the hold".
  let x1 = size, y1 = size, x2 = -1, y2 = -1;
  for (let i = 0; i < size * size; i++) {
    if (!big[i]) continue;
    const x = i % size, y = (i / size) | 0;
    x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  }
  const pad = 3;
  const outside = mean((i) => {
    const x = i % size, y = (i / size) | 0;
    return !big[i] && x >= x1 - pad && x <= x2 + pad && y >= y1 - pad && y <= y2 + pad;
  });
  for (const k of order.slice(1)) {
    const small = cands[k].cells;
    const smallArea = area(small);
    if (smallArea < bigArea * 0.3 || smallArea > bigArea * 0.85) continue;
    const ring = mean((i) => !!big[i] && !small[i]);
    const inner = mean((i) => !!small[i]);
    if (ring < inner * 0.8 && ring < outside * 0.8) return k;
  }
  return best;
}

/** Candidate m's cells (logit > 0) as a 0/1 grid. */
function cellsOf(masks: Float32Array, offset: number) {
  const cells = new Uint8Array(MASK_SIZE * MASK_SIZE);
  for (let i = 0; i < cells.length; i++) cells[i] = masks[offset + i] > 0 ? 1 : 0;
  return cells;
}

interface Decoded {
  iou: Float32Array;
  masks: Float32Array;
}

async function decode(decoder: InferenceSession, Tensor: TensorCtor, emb: Embedding, points: number[][][], labels: number[][]): Promise<Decoded> {
  const n = points.length;
  const k = points[0].length;
  const s = emb.tile.scale;
  const pts = new Float32Array(points.flat(2).map((v, i) => (v - (i % 2 ? emb.tile.y : emb.tile.x)) * s));
  const lbl = new BigInt64Array(labels.flat().map((l) => BigInt(l)));
  const out = await decoder.run({
    ...emb.feeds,
    input_points: new Tensor('float32', pts, [1, n, k, 2]),
    input_labels: new Tensor('int64', lbl, [1, n, k]),
  });
  return { iou: out.iou_scores.data as Float32Array, masks: out.pred_masks.data as Float32Array };
}

/** Bilinear sample of one candidate mask's logits at a photo-pixel position inside the tile. */
function logitAt(masks: Float32Array, offset: number, tile: Tile, px: number, py: number) {
  const u = Math.min(MASK_SIZE - 1, Math.max(0, ((px - tile.x + 0.5) * tile.scale) / 4 - 0.5));
  const v = Math.min(MASK_SIZE - 1, Math.max(0, ((py - tile.y + 0.5) * tile.scale) / 4 - 0.5));
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const x1 = Math.min(MASK_SIZE - 1, x0 + 1);
  const y1 = Math.min(MASK_SIZE - 1, y0 + 1);
  const fx = u - x0;
  const fy = v - y0;
  const m = (x: number, y: number) => masks[offset + y * MASK_SIZE + x];
  return (m(x0, y0) * (1 - fx) + m(x1, y0) * fx) * (1 - fy) + (m(x0, y1) * (1 - fx) + m(x1, y1) * fx) * fy;
}

/** Positive-cell stats of a candidate mask on the 256 grid, in photo pixels. */
function maskStats(masks: Float32Array, offset: number, tile: Tile, region?: Box) {
  const cell = 4 / tile.scale; // photo pixels per mask cell
  let total = 0;
  let inside = 0;
  const bounds = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  const lim = Math.ceil((Math.max(tile.w, tile.h) * tile.scale) / 4);
  for (let my = 0; my < lim; my++) {
    for (let mx = 0; mx < lim; mx++) {
      if (masks[offset + my * MASK_SIZE + mx] <= 0) continue;
      total++;
      const px = tile.x + (mx + 0.5) * cell;
      const py = tile.y + (my + 0.5) * cell;
      if (region && px >= region.x1 && px <= region.x2 && py >= region.y1 && py <= region.y2) inside++;
      bounds.x1 = Math.min(bounds.x1, px - cell / 2);
      bounds.y1 = Math.min(bounds.y1, py - cell / 2);
      bounds.x2 = Math.max(bounds.x2, px + cell / 2);
      bounds.y2 = Math.max(bounds.y2, py + cell / 2);
    }
  }
  return { area: total * cell * cell, insideFrac: total ? inside / total : 0, bounds };
}

/** Sample a candidate mask over a region at about 80 cells across and trace its outline. */
function outline(masks: Float32Array, offset: number, tile: Tile, r: Box): Point[] | null {
  const step = Math.max(1, Math.max(r.x2 - r.x1, r.y2 - r.y1) / 80);
  const w = Math.max(1, Math.ceil((r.x2 - r.x1) / step));
  const h = Math.max(1, Math.ceil((r.y2 - r.y1) / step));
  const grid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      grid[y * w + x] = logitAt(masks, offset, tile, r.x1 + (x + 0.5) * step, r.y1 + (y + 0.5) * step) > 0 ? 1 : 0;
    }
  }
  return maskToPolygon(grid, w, h, r.x1, r.y1, step);
}

const grow = (b: Box, f: number): Box => {
  const g = f * Math.max(b.x2 - b.x1, b.y2 - b.y1);
  return { x1: b.x1 - g, y1: b.y1 - g, x2: b.x2 + g, y2: b.y2 + g };
};

/**
 * Outline each box (photo pixels) using SAM with the box as the prompt.
 * Returns null for boxes where no candidate mask stays inside the box —
 * SAM often prefers the wall panel behind a small hold.
 */
export async function outlineBoxes(decoder: InferenceSession, Tensor: TensorCtor, emb: Embedding, boxes: Box[], batch = 16): Promise<(Point[] | null)[]> {
  const result: (Point[] | null)[] = [];
  for (let start = 0; start < boxes.length; start += batch) {
    const chunk = boxes.slice(start, start + batch);
    // Box prompt as its two corners with SAM's box labels (2 = top-left, 3 = bottom-right).
    const { iou, masks } = await decode(decoder, Tensor, emb, chunk.map((b) => [[b.x1, b.y1], [b.x2, b.y2]]), chunk.map(() => [2, 3]));
    chunk.forEach((b, k) => {
      const region = grow(b, 0.15);
      const boxArea = (b.x2 - b.x1) * (b.y2 - b.y1);
      const valid: { m: number; cells: Uint8Array; iou: number }[] = [];
      for (let m = 0; m < 3; m++) {
        const offset = (k * 3 + m) * MASK_SIZE * MASK_SIZE;
        const st = maskStats(masks, offset, emb.tile, region);
        if (st.area > 0.25 * boxArea && st.insideFrac > 0.9) valid.push({ m, cells: cellsOf(masks, offset), iou: iou[k * 3 + m] });
      }
      if (!valid.length) {
        result.push(null);
        return;
      }
      const pick = emb.luma ? valid[preferWithoutShadow(valid, emb.luma)] : valid.reduce((a, c) => (c.iou > a.iou ? c : a));
      // The detector's box is usually tight around the hold itself; clipping to it
      // (plus a sliver) trims shadows SAM tends to include.
      result.push(outline(masks, (k * 3 + pick.m) * MASK_SIZE * MASK_SIZE, emb.tile, grow(b, 0.03)));
    });
  }
  return result;
}

/**
 * Outline the hold under a tapped point, or null if SAM only finds something
 * wall-sized. An optional box (e.g. the hold's old outline) narrows it down.
 */
export async function outlineAtPoint(decoder: InferenceSession, Tensor: TensorCtor, emb: Embedding, x: number, y: number, box?: Box): Promise<Point[] | null> {
  const { iou, masks } = box
    ? await decode(decoder, Tensor, emb, [[[x, y], [box.x1, box.y1], [box.x2, box.y2]]], [[1, 2, 3]])
    : await decode(decoder, Tensor, emb, [[[x, y]]], [[1]]);
  const tileArea = emb.tile.w * emb.tile.h;
  const valid: { m: number; cells: Uint8Array; iou: number; bounds: Box }[] = [];
  for (let m = 0; m < 3; m++) {
    const offset = m * MASK_SIZE * MASK_SIZE;
    if (logitAt(masks, offset, emb.tile, x, y) <= 0) continue;
    const st = maskStats(masks, offset, emb.tile);
    if (st.area < 30 || st.area > 0.06 * tileArea) continue;
    valid.push({ m, cells: cellsOf(masks, offset), iou: iou[m], bounds: st.bounds });
  }
  if (!valid.length) return null;
  const pick = emb.luma ? valid[preferWithoutShadow(valid, emb.luma)] : valid.reduce((a, c) => (c.iou > a.iou ? c : a));
  return outline(masks, pick.m * MASK_SIZE * MASK_SIZE, emb.tile, grow(pick.bounds, 0.05));
}
