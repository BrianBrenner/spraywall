import type { InferenceSession } from 'onnxruntime-web';
import type { Hold, HoldShape } from '../types';
import { pointInShape, shapeCenter } from './geometry';
import { loadImage, makeCanvas } from './image';

/** Model input is a square letterboxed image of this size. */
const SIZE = 2560;
const MODEL_URL = `${import.meta.env.BASE_URL}models/holds-detect.onnx`;

export interface Detection {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

/**
 * Decode YOLOv8 output `[1, 5, n]` (cx, cy, w, h, score in model pixels), drop
 * low scores, map back to image pixels and remove duplicates with NMS.
 */
export function decodeDetections(data: ArrayLike<number>, n: number, scale: number, minScore = 0.2, iouThreshold = 0.5): Detection[] {
  const candidates: Detection[] = [];
  for (let i = 0; i < n; i++) {
    const score = data[4 * n + i];
    if (score < minScore) continue;
    const w = data[2 * n + i] / scale;
    const h = data[3 * n + i] / scale;
    candidates.push({ x: data[i] / scale - w / 2, y: data[n + i] / scale - h / 2, w, h, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const c of candidates) if (kept.every((k) => iou(k, c) < iouThreshold)) kept.push(c);
  return kept;
}

function iou(a: Detection, b: Detection) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

export function detectionToShape(d: Detection): HoldShape {
  return { type: 'ellipse', cx: d.x + d.w / 2, cy: d.y + d.h / 2, rx: d.w / 2, ry: d.h / 2 };
}

/** Detections that don't overlap a hold that's already outlined. */
export function newDetections(detections: Detection[], holds: Hold[]): Detection[] {
  return detections.filter((d) => {
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    return !holds.some((h) => {
      if (pointInShape(h.shape, cx, cy)) return true;
      const [hx, hy] = shapeCenter(h.shape);
      return hx >= d.x && hx <= d.x + d.w && hy >= d.y && hy <= d.y + d.h;
    });
  });
}

let session: Promise<InferenceSession> | null = null;

function getSession() {
  session ??= (async () => {
    // Loaded on demand: the runtime and model are large and most visits never detect.
    const ort = await import('onnxruntime-web/webgpu');
    ort.env.wasm.numThreads = 1; // Threads need cross-origin isolation, which a static host won't give us.
    const model = await fetch(MODEL_URL).then((r) => {
      if (!r.ok) throw new Error(`Couldn't download the hold model (${r.status}).`);
      return r.arrayBuffer();
    });
    const providers = 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm'];
    try {
      return await ort.InferenceSession.create(model, { executionProviders: providers });
    } catch {
      return ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    }
  })();
  session.catch(() => (session = null));
  return session;
}

/** Run the hold detector on a wall photo. Coordinates in the result are photo pixels. */
export async function detectHolds(image: Blob, width: number, height: number): Promise<Detection[]> {
  const [sess, img] = await Promise.all([getSession(), loadImage(image)]);
  const ort = await import('onnxruntime-web/webgpu');

  const scale = SIZE / Math.max(width, height);
  const { canvas, ctx } = makeCanvas(SIZE, SIZE);
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(img, 0, 0, Math.round(width * scale), Math.round(height * scale));
  const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
  canvas.width = 0; // Free the canvas memory early (matters on iPad).

  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = rgba[i * 4] / 255;
    input[plane + i] = rgba[i * 4 + 1] / 255;
    input[2 * plane + i] = rgba[i * 4 + 2] / 255;
  }

  const feeds = { [sess.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) };
  const output = (await sess.run(feeds))[sess.outputNames[0]];
  const data = (await output.getData()) as Float32Array;
  output.dispose();
  return decodeDetections(data, output.dims[2], scale);
}
