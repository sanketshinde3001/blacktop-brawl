/**
 * Builds the rider frames that were never generated, using only local image processing.
 *
 *  - Rival attack poses: the extended arm / leg / club is cut from the player's matching frame,
 *    recoloured to the rival's own sleeve or trouser colour (shading kept), scaled to the rival
 *    and pasted on the rival's riding frame, aligned on the rear-wheel contact point.
 *  - Rival crash frames: the player's tumble / fallen-bike frames recoloured to the rival.
 *  - Second running frames and the flag-down starter: mirrored copies.
 *
 * Real generated art always wins: existing files are never overwritten. Frames this script made
 * are listed in public/assets/images/derived.json; --rebuild deletes and remakes only those.
 *   npx tsx scripts/derive-frames.ts [--rebuild]
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const DIR = 'public/assets/images';
const LIST = join(DIR, 'derived.json');
const DESIGNS = ['brawler', 'racer', 'punk', 'yellow', 'bomber', 'rebel', 'cop'];
const POSES = ['punchL', 'punchR', 'kickL', 'kickR', 'clubL', 'clubR'];

interface Img {
  data: Buffer;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

const file = (id: string) => join(DIR, `${id}.webp`);

async function load(id: string): Promise<Img> {
  const { data, info } = await sharp(file(id)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = { data, w: info.width, h: info.height, ax: 0, ay: 0 };
  // ground anchor: bottom-centre of the lowest opaque rows (same rule as build-manifest)
  let bottom = img.h - 1;
  for (; bottom > 0; bottom--) {
    let n = 0;
    for (let x = 0; x < img.w; x++) if (data[(bottom * img.w + x) * 4 + 3] > 110) n++;
    if (n >= 3) break;
  }
  let sum = 0, n = 0;
  for (let y = Math.max(0, bottom - Math.round(img.h * 0.03)); y <= bottom; y++)
    for (let x = 0; x < img.w; x++) if (data[(y * img.w + x) * 4 + 3] > 110) (sum += x), n++;
  img.ax = n ? sum / n : img.w / 2;
  img.ay = bottom + 1;
  return img;
}

async function save(id: string, img: { data: Buffer; w: number; h: number }) {
  await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).webp({ quality: 90, alphaQuality: 100 }).toFile(file(id));
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const sat = (r: number, g: number, b: number) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

/** Median colour of opaque pixels inside a box given as fractions of the opaque bounding box. */
function sample(img: Img, fx0: number, fx1: number, fy0: number, fy1: number, accept = (_r: number, _g: number, _b: number) => true): [number, number, number] {
  let x0 = img.w, x1 = 0, y0 = img.h, y1 = 0;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.data[(y * img.w + x) * 4 + 3] > 200) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const bw = x1 - x0, bh = y1 - y0;
  for (let y = Math.round(y0 + bh * fy0); y < y0 + bh * fy1; y++) {
    for (let x = Math.round(x0 + bw * fx0); x < x0 + bw * fx1; x++) {
      const i = (y * img.w + x) * 4;
      if (img.data[i + 3] < 200) continue;
      const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      if (!accept(r, g, b)) continue;
      rs.push(r), gs.push(g), bs.push(b);
    }
  }
  if (!rs.length) return [60, 60, 60];
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/** Recolour pixels matching `pick` to `color`, keeping their relative shading. */
function recolor(img: { data: Buffer }, pick: (r: number, g: number, b: number) => boolean, color: [number, number, number]) {
  const d = img.data;
  const lums: number[] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && pick(d[i], d[i + 1], d[i + 2])) lums.push(lum(d[i], d[i + 1], d[i + 2]));
  if (!lums.length) return;
  lums.sort((a, b) => a - b);
  const ref = Math.max(8, lums[lums.length >> 1]);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0 || !pick(d[i], d[i + 1], d[i + 2])) continue;
    const k = Math.min(1.9, lum(d[i], d[i + 1], d[i + 2]) / ref);
    d[i] = Math.min(255, color[0] * k);
    d[i + 1] = Math.min(255, color[1] * k);
    d[i + 2] = Math.min(255, color[2] * k);
  }
}

/** Opaque mask of `img`, grown by `radius` pixels. */
function dilate(img: Img, radius: number): Uint8Array {
  const { w, h } = img;
  const a = new Uint8Array(w * h), b = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = img.data[i * 4 + 3] > 30 ? 1 : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -radius; k <= radius && !v; k++) v = a[y * w + Math.min(w - 1, Math.max(0, x + k))];
      b[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -radius; k <= radius && !v; k++) v = b[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      a[y * w + x] = v;
    }
  return a;
}

// pixel classes in the player's art
const isLeather = (r: number, g: number, b: number) => sat(r, g, b) < 0.32 && lum(r, g, b) < 150; // black jacket + gloves
const isDenim = (r: number, g: number, b: number) => b > r + 12 && b >= g && sat(r, g, b) > 0.2; // blue jeans
const isHelmet = (r: number, g: number, b: number) => r > 120 && r > g * 1.8 && r > b * 1.8; // red helmet

type RGB = [number, number, number];
interface Palette {
  arm: RGB;
  torso: RGB;
  legs: RGB;
  helmet: RGB;
  bike: RGB;
}

/** Where sampling the sprite picks the wrong colour (stripes, white paint), say it outright. */
const OVERRIDES: Record<string, Partial<Palette>> = {
  yellow: { arm: [236, 188, 28], torso: [236, 188, 28], legs: [52, 50, 48], helmet: [240, 196, 30], bike: [236, 188, 28] },
  cop: { bike: [236, 236, 236] },
  brawler: { bike: [44, 44, 50] },
};

function palette(t: Img, design: string): Palette {
  const notChrome = (r: number, g: number, b: number) => !(sat(r, g, b) < 0.12 && lum(r, g, b) > 170);
  const painted = (r: number, g: number, b: number) => sat(r, g, b) > 0.35 && lum(r, g, b) > 50;
  return {
    bike: sample(t, 0.25, 0.75, 0.6, 0.85, painted),
    // shoulders/upper arms sit at the sides of the torso, upper third of the sprite
    arm: sample(t, 0.12, 0.3, 0.16, 0.34, notChrome),
    torso: sample(t, 0.38, 0.62, 0.18, 0.4, notChrome),
    legs: sample(t, 0.1, 0.3, 0.55, 0.72, notChrome),
    helmet: sample(t, 0.4, 0.6, 0.0, 0.1, notChrome),
    ...OVERRIDES[design],
  } as Palette;
}

async function pose(design: string, poseId: string, pRide: Img, rideMask: Uint8Array) {
  const out = `riders/${design}/${poseId}`;
  if (existsSync(file(out))) return false;
  const pPose = await load(`riders/player/${poseId}`);
  const t = await load(`riders/${design}/ride`);
  const pal = palette(t, design);
  // cut the limb: everything in the pose frame outside the riding silhouette
  const limb = { data: Buffer.from(pPose.data), w: pPose.w, h: pPose.h };
  for (let y = 0; y < pPose.h; y++)
    for (let x = 0; x < pPose.w; x++) {
      const rx = Math.round(x - pPose.ax + pRide.ax), ry = Math.round(y - pPose.ay + pRide.ay);
      if (rx >= 0 && ry >= 0 && rx < pRide.w && ry < pRide.h && rideMask[ry * pRide.w + rx]) limb.data[(y * pPose.w + x) * 4 + 3] = 0;
    }
  if (poseId.startsWith('kick')) recolor(limb, isDenim, pal.legs);
  else recolor(limb, isLeather, pal.arm);
  // scale to the rival and composite on the rival's riding frame
  const s = t.h / pRide.h;
  const lw = Math.max(1, Math.round(pPose.w * s)), lh = Math.max(1, Math.round(pPose.h * s));
  const limbPng = await sharp(limb.data, { raw: { width: limb.w, height: limb.h, channels: 4 } }).resize(lw, lh).png().toBuffer();
  const ox = Math.round(t.ax - pPose.ax * s), oy = Math.round(t.ay - pPose.ay * s);
  const minX = Math.min(0, ox), minY = Math.min(0, oy);
  const W = Math.max(t.w, ox + lw) - minX, H = Math.max(t.h, oy + lh) - minY;
  const tPng = await sharp(t.data, { raw: { width: t.w, height: t.h, channels: 4 } }).png().toBuffer();
  const merged = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: tPng, left: -minX, top: -minY },
      { input: limbPng, left: ox - minX, top: oy - minY },
    ])
    .raw()
    .toBuffer();
  await save(out, { data: merged, w: W, h: H });
  return true;
}

async function crashFrame(design: string, frame: 'tumble' | 'bikeDown') {
  const out = `riders/${design}/${frame}`;
  if (existsSync(file(out))) return false;
  const src = await load(`riders/player/${frame}`);
  const pal = palette(await load(`riders/${design}/ride`), design);
  const img = { data: Buffer.from(src.data), w: src.w, h: src.h };
  if (frame === 'tumble') {
    recolor(img, isLeather, pal.torso);
    recolor(img, isDenim, pal.legs);
    recolor(img, isHelmet, pal.helmet);
  } else {
    // the player's bike is blue with red trim: repaint the blue in the rival's bike colour
    recolor(img, isDenim, pal.bike);
  }
  await save(out, img);
  return true;
}

async function mirror(from: string, to: string) {
  if (existsSync(file(to))) return false;
  if (!existsSync(file(from))) return false;
  await sharp(file(from)).flop().webp({ quality: 90, alphaQuality: 100 }).toFile(file(to));
  return true;
}

async function main() {
  const previous: string[] = existsSync(LIST) ? JSON.parse(readFileSync(LIST, 'utf8')) : [];
  if (process.argv.includes('--rebuild')) for (const id of previous) rmSync(file(id), { force: true });
  const made: string[] = [];
  const pRide = await load('riders/player/ride');
  const mask = dilate(pRide, 4);
  for (const d of DESIGNS) {
    if (!existsSync(file(`riders/${d}/ride`))) continue;
    const poses = d === 'cop' ? ['punchL', 'punchR', 'clubL', 'clubR'] : POSES;
    for (const p of poses) if (await pose(d, p, pRide, mask)) made.push(`riders/${d}/${p}`);
    for (const f of ['tumble', 'bikeDown'] as const) if (await crashFrame(d, f)) made.push(`riders/${d}/${f}`);
  }
  for (const [a, b] of [
    ['riders/player/runBack1', 'riders/player/runBack2'],
    ['riders/player/runFront1', 'riders/player/runFront2'],
    ['props/flagmanUp', 'props/flagmanDown'],
  ])
    if (await mirror(a, b)) made.push(b);
  writeFileSync(LIST, JSON.stringify([...new Set([...previous, ...made])].sort(), null, 1));
  console.log(`derived ${made.length} frames${made.length ? ':\n  ' + made.join('\n  ') : ''}`);
}

main();
