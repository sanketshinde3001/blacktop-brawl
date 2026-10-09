import sharp from 'sharp';

/**
 * Removes a flat magenta (#FF00FF) background.
 * Alpha comes from how "magenta" a pixel is; edge colours are un-mixed from the key
 * colour so outlines stay dark instead of turning purple.
 */
export async function chromaKey(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  const T0 = 70; // below this "magenta-ness" the pixel is fully opaque
  const T1 = 175; // above this it is fully transparent
  floodKey(px, info.width, info.height); // off-shade backgrounds first, on the original colours
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const m = Math.min(r, b) - g;
    let a = 1 - (m - T0) / (T1 - T0);
    if (a >= 1) continue;
    if (a <= 0.04) { px[i + 3] = 0; continue; }
    // un-mix: c = a*fg + (1-a)*key  ->  fg = (c - (1-a)*key) / a
    const k = 1 - a;
    px[i] = (r - k * 255) / a;
    px[i + 1] = g / a;
    px[i + 2] = (b - k * 255) / a;
    px[i + 3] = a * 255;
  }
  despeckle(px, info.width, info.height);
  return { data: Buffer.from(px.buffer, px.byteOffset, px.length), width: info.width, height: info.height };
}

/**
 * Second pass for images where the model painted an off-shade or gradient pink background
 * instead of pure #FF00FF: flood-fill pinkish pixels connected to the image border.
 */
function floodKey(px: Uint8ClampedArray, w: number, h: number) {
  const pinkish = (i: number) => {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    return px[i * 4 + 3] > 0 && r > 140 && b > 100 && r - g > 12 && b - g > 12 && Math.abs(r - b) < 90;
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !pinkish(i)) continue;
    seen[i] = 1;
    px[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  // soften the fringe next to removed background
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || px[i * 4 + 3] === 0) continue;
    const x = i % w;
    const near = (x > 0 && seen[i - 1]) || (x < w - 1 && seen[i + 1]) || seen[i - w] || seen[i + w];
    if (near && px[i * 4] - px[i * 4 + 1] > 30 && px[i * 4 + 2] - px[i * 4 + 1] > 30) px[i * 4 + 3] *= 0.35;
  }
}

/** Kills tiny isolated semi-opaque specks left by JPEG noise in the background. */
function despeckle(px: Uint8ClampedArray, w: number, h: number) {
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (alpha[i] === 0) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (alpha[i + dy * w + dx] > 40) n++;
      if (n <= 2) px[i * 4 + 3] = 0;
    }
  }
}

/** Bounding box of pixels whose alpha exceeds `threshold`. */
export function alphaBounds(px: Buffer, w: number, h: number, threshold = 60) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export interface SpriteOptions {
  scale?: number;
  maxDim?: number;
  pad?: number;
  /** neutralise leftover magenta/purple tints (local models leave more spill in shadows and edges) */
  despill?: boolean;
}

/** Turns purple-ish pixels (magenta spill) grey, keeping their brightness. */
function despillPurple(px: Uint8Array | Buffer) {
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    if (r - g > 25 && b - g > 25 && Math.abs(r - b) < 80) {
      const v = Math.round(0.4 * Math.min(r, b) + 0.6 * g);
      px[i] = px[i + 1] = px[i + 2] = v;
      if (px[i + 3] < 200) px[i + 3] = Math.round(px[i + 3] * 0.6);
    }
  }
}

/** Magenta-keyed raw image -> trimmed, scaled, transparent PNG. */
export async function processSprite(raw: Buffer, opts: SpriteOptions = {}): Promise<Buffer> {
  const keyed = await chromaKey(raw);
  if (opts.despill) despillPurple(keyed.data);
  const b = alphaBounds(keyed.data, keyed.width, keyed.height);
  const pad = opts.pad ?? 2;
  const left = Math.max(0, b.x - pad), top = Math.max(0, b.y - pad);
  const width = Math.min(keyed.width - left, b.w + pad * 2), height = Math.min(keyed.height - top, b.h + pad * 2);
  let img = sharp(keyed.data, { raw: { width: keyed.width, height: keyed.height, channels: 4 } }).extract({ left, top, width, height });
  let scale = opts.scale ?? 1;
  if (opts.maxDim) scale = Math.min(scale, opts.maxDim / Math.max(width, height));
  if (scale !== 1) {
    img = sharp(await img.png().toBuffer()).resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), { kernel: 'lanczos3' });
  }
  // WebP keeps alpha at a fraction of PNG size (every current browser decodes it).
  return img.webp({ quality: 90, alphaQuality: 100, effort: 5 }).toBuffer();
}

export interface PictureOptions { maxWidth?: number; tile?: boolean; quality?: number }

/** Opaque illustration -> JPEG, optionally made horizontally seamless by cross-fading the edges. */
export async function processPicture(raw: Buffer, opts: PictureOptions = {}): Promise<Buffer> {
  let img = sharp(raw).removeAlpha();
  if (opts.tile) {
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height, c = info.channels;
    const overlap = Math.round(w * 0.12);
    const outW = w - overlap;
    const out = Buffer.alloc(outW * h * c);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < outW; x++) {
        const dst = (y * outW + x) * c;
        const src = (y * w + x) * c;
        if (x < overlap) {
          const t = x / overlap;
          const src2 = (y * w + (outW + x)) * c; // right strip that wraps onto the left edge
          for (let k = 0; k < c; k++) out[dst + k] = data[src2 + k] * (1 - t) + data[src + k] * t;
        } else {
          for (let k = 0; k < c; k++) out[dst + k] = data[src + k];
        }
      }
    }
    img = sharp(out, { raw: { width: outW, height: h, channels: c as 3 } });
  }
  if (opts.maxWidth) img = img.resize({ width: opts.maxWidth, withoutEnlargement: true });
  return img.jpeg({ quality: opts.quality ?? 86, mozjpeg: true }).toBuffer();
}
