import type { InferenceSession } from 'onnxruntime-web';
import type { Hold, HoldShape } from '../types';
import { shapeBox } from './geometry';
import { importFresh } from './appUpdate';
import { loadImage, makeCanvas } from './image';
import { bestTile, encode, lumaGrid, makeTile, outlineAtPoint, outlineBoxes, planTiles, preprocess, SAM_SIZE, type Embedding, type Tile } from './samCore';

const base = `${import.meta.env.BASE_URL}models/`;

let sessions: Promise<{ encoder: InferenceSession; decoder: InferenceSession; Tensor: typeof import('onnxruntime-web').Tensor }> | null = null;

function getSam() {
  sessions ??= (async () => {
    const ort = await importFresh(() => import('onnxruntime-web/webgpu'));
    ort.env.wasm.numThreads = 1;
    const load = async (name: string) => {
      const r = await fetch(base + name);
      if (!r.ok) throw new Error(`Couldn't download ${name} (${r.status}).`);
      // The int8 models run best on the WASM backend.
      return ort.InferenceSession.create(await r.arrayBuffer(), { executionProviders: ['wasm'] });
    };
    const [encoder, decoder] = await Promise.all([load('sam-encoder.onnx'), load('sam-decoder.onnx')]);
    return { encoder, decoder, Tensor: ort.Tensor };
  })();
  sessions.catch(() => (sessions = null));
  return sessions;
}

/** Let the browser paint progress between heavy steps. */
const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

async function embedTile(img: HTMLImageElement, tile: Tile): Promise<Embedding> {
  const { encoder, Tensor } = await getSam();
  const w = Math.round(tile.w * tile.scale);
  const h = Math.round(tile.h * tile.scale);
  const { canvas, ctx } = makeCanvas(Math.min(w, SAM_SIZE), Math.min(h, SAM_SIZE));
  ctx.drawImage(img, tile.x, tile.y, tile.w, tile.h, 0, 0, canvas.width, canvas.height);
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels = preprocess(rgba, canvas.width, canvas.height);
  const luma = lumaGrid(rgba, canvas.width, canvas.height);
  canvas.width = 0;
  return encode(encoder, Tensor, tile, pixels, luma);
}

/**
 * Replace ellipse outlines with polygons that follow each hold, using the
 * ellipse's bounding box as the SAM prompt. Holds SAM can't separate from the
 * wall keep their ellipse (they're simply missing from the result).
 */
export async function refineOutlines(
  image: Blob,
  width: number,
  height: number,
  holds: Hold[],
  onProgress: (done: number, total: number) => void,
): Promise<Map<string, HoldShape>> {
  const targets = holds.filter((h) => h.shape.type === 'ellipse');
  const tiles = planTiles(width, height);
  const groups = tiles.map(() => [] as Hold[]);
  const boxOf = (h: Hold) => {
    const b = shapeBox(h.shape);
    return { x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h };
  };
  for (const h of targets) groups[bestTile(tiles, boxOf(h))].push(h);

  const [img, { decoder, Tensor }] = await Promise.all([loadImage(image), getSam()]);
  const result = new Map<string, HoldShape>();
  let done = 0;
  onProgress(0, targets.length);
  for (const [i, group] of groups.entries()) {
    if (!group.length) continue;
    await yieldToUi();
    const emb = await embedTile(img, tiles[i]);
    const polys = await outlineBoxes(decoder, Tensor, emb, group.map(boxOf));
    group.forEach((h, k) => {
      const p = polys[k];
      if (p) result.set(h.id, { type: 'polygon', points: p });
    });
    done += group.length;
    onProgress(done, targets.length);
  }
  return result;
}

/** Traces holds at tapped points, re-using the last tile's embedding for nearby taps. */
export class HoldTracer {
  private image: Blob;
  private img: Promise<HTMLImageElement> | null = null;
  private cached: Embedding | null = null;
  private width: number;
  private height: number;

  constructor(image: Blob, width: number, height: number) {
    this.image = image;
    this.width = width;
    this.height = height;
  }

  /**
   * Outline the hold at a tapped point. When re-tracing an existing outline,
   * pass it so SAM knows which hold is meant; if that doesn't give a clean
   * shape (e.g. a circle placed off-centre), retry with the tap alone.
   */
  async trace(x: number, y: number, existing?: HoldShape): Promise<HoldShape | null> {
    const t = this.cached?.tile;
    // Reuse while the tap is well inside the cached tile (not near its edges).
    const margin = 150;
    const reuse = t && x > t.x + margin && x < t.x + t.w - margin && y > t.y + margin && y < t.y + t.h - margin;
    if (!reuse) {
      const tw = Math.min(SAM_SIZE, this.width);
      const th = Math.min(SAM_SIZE, this.height);
      const tx = Math.max(0, Math.min(this.width - tw, Math.round(x - tw / 2)));
      const ty = Math.max(0, Math.min(this.height - th, Math.round(y - th / 2)));
      this.img ??= loadImage(this.image);
      this.cached = await embedTile(await this.img, makeTile(tx, ty, tw, th));
    }
    const { decoder, Tensor } = await getSam();
    let points = null;
    if (existing) {
      const b = shapeBox(existing);
      const g = 0.25 * Math.max(b.w, b.h);
      points = await outlineAtPoint(decoder, Tensor, this.cached!, x, y, { x1: b.x - g, y1: b.y - g, x2: b.x + b.w + g, y2: b.y + b.h + g });
    }
    points ??= await outlineAtPoint(decoder, Tensor, this.cached!, x, y);
    return points ? { type: 'polygon', points } : null;
  }
}
