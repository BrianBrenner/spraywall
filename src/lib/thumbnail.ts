import { db } from '../db';
import type { Climb, WallVersion } from '../types';
import { shapeBox, shapePath, unionBox } from './geometry';
import { canvasToBlob, loadImage, makeCanvas } from './image';
import { ROLE_COLORS } from './roles';

const THUMB_W = 360;
const THUMB_H = 270;

/** Crop of the wall photo around the climb's holds, with holds outlined in role colours. */
export async function renderThumbnail(climb: Pick<Climb, 'holds'>, version: WallVersion): Promise<Blob> {
  const byId = new Map(version.holds.map((h) => [h.id, h]));
  const used = climb.holds.flatMap((ch) => {
    const h = byId.get(ch.holdId);
    return h ? [{ hold: h, role: ch.role }] : [];
  });

  const box = unionBox(used.map((u) => shapeBox(u.hold.shape))) ?? { x: 0, y: 0, w: version.width, h: version.height };
  // Pad the crop and widen it to the thumbnail's aspect ratio.
  const pad = Math.max(box.w, box.h) * 0.12 + 40;
  let w = box.w + pad * 2;
  let h = box.h + pad * 2;
  const aspect = THUMB_W / THUMB_H;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  w = Math.min(w, version.width);
  h = Math.min(h, version.height);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const sx = clamp(cx - w / 2, 0, version.width - w);
  const sy = clamp(cy - h / 2, 0, version.height - h);

  const scale = Math.min(THUMB_W / w, THUMB_H / h);
  const { canvas, ctx } = makeCanvas(Math.round(w * scale), Math.round(h * scale));
  ctx.drawImage(await loadImage(version.image), sx, sy, w, h, 0, 0, canvas.width, canvas.height);

  ctx.setTransform(scale, 0, 0, scale, -sx * scale, -sy * scale);
  // Dim everything except the climb's holds.
  const holes = new Path2D();
  holes.rect(sx, sy, w, h);
  for (const u of used) holes.addPath(new Path2D(shapePath(u.hold.shape)));
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill(holes, 'evenodd');

  ctx.lineWidth = Math.max(3, 3 / scale);
  for (const u of used) {
    ctx.strokeStyle = ROLE_COLORS[u.role];
    ctx.stroke(new Path2D(shapePath(u.hold.shape)));
  }
  return canvasToBlob(canvas, 'image/jpeg', 0.8);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Rebuild missing thumbnails, e.g. after an import (thumbnails aren't exported). */
export async function ensureThumbnails() {
  const missing = await db.climbs.filter((c) => !c.thumbnail).toArray();
  const versions = new Map<string, WallVersion | undefined>();
  for (const climb of missing) {
    if (!versions.has(climb.versionId)) versions.set(climb.versionId, await db.versions.get(climb.versionId));
    const version = versions.get(climb.versionId);
    if (!version) continue;
    await db.climbs.update(climb.id, { thumbnail: await renderThumbnail(climb, version) });
  }
}
