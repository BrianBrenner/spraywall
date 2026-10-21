const MAX_EDGE = 2560;

/** Decode a blob into an <img>. Browsers apply EXIF rotation to <img> by default. */
export async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  try {
    await img.decode();
  } finally {
    URL.revokeObjectURL(img.src);
  }
  return img;
}

/** Plain <canvas> rather than OffscreenCanvas, for older iPad Safari. */
export function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d')! };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
  );
}

/** Decode a user photo and downscale it for storage. */
export async function prepareWallImage(file: Blob): Promise<{ image: Blob; width: number; height: number }> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const { canvas, ctx } = makeCanvas(width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const image = await canvasToBlob(canvas, 'image/jpeg', 0.88);
  return { image, width, height };
}

const urlCache = new WeakMap<Blob, string>();

/** Stable object URL per blob, so re-renders don't leak or flicker. */
export function blobUrl(blob: Blob): string {
  let url = urlCache.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    urlCache.set(blob, url);
  }
  return url;
}
