/**
 * Scans public/assets and writes public/assets/manifest.json, which the game loads at boot.
 * For every image it records size and a ground anchor (bottom-centre of the opaque pixels, e.g.
 * the rear-wheel contact point of a rider sprite). For backgrounds it detects the horizon line.
 *
 *   npm run assets:manifest
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve('public/assets');

function walk(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  } catch {
    return [];
  }
}

async function anchor(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const opaque = (x: number, y: number) => data[(y * w + x) * 4 + 3] > 110;
  let bottom = h - 1;
  for (; bottom > 0; bottom--) {
    let n = 0;
    for (let x = 0; x < w; x++) if (opaque(x, bottom)) n++;
    if (n >= 3) break;
  }
  const band = Math.max(3, Math.round(h * 0.03));
  let sum = 0, n = 0;
  for (let y = Math.max(0, bottom - band); y <= bottom; y++) {
    for (let x = 0; x < w; x++) if (opaque(x, y)) (sum += x), n++;
  }
  return { w, h, ax: n ? Math.round(sum / n) : Math.round(w / 2), ay: bottom + 1 };
}

/** Finds where the busy scenery ends and flat ground begins, scanning upward from the bottom. */
async function horizon(file: string): Promise<number> {
  const { data, info } = await sharp(file).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const rowStd: number[] = [];
  for (let y = 0; y < h; y++) {
    let s = 0, s2 = 0;
    for (let x = 0; x < w; x += 2) {
      const v = data[y * w + x];
      s += v;
      s2 += v * v;
    }
    const n = Math.ceil(w / 2);
    rowStd.push(Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)));
  }
  const tail = rowStd.slice(Math.round(h * 0.88)).sort((a, b) => a - b);
  const base = tail[Math.floor(tail.length / 2)] ?? 5;
  let run = 0;
  for (let y = h - 1; y > h * 0.3; y--) {
    run = rowStd[y] > base * 2.5 + 10 ? run + 1 : 0;
    if (run >= 4) return Math.min(0.95, (y + 4) / h);
  }
  return 0.62;
}

async function main() {
  const images: Record<string, unknown> = {};
  for (const file of walk(join(ROOT, 'images'))) {
    if (!/\.(png|jpg|webp)$/.test(file)) continue;
    const rel = relative(ROOT, file);
    const id = relative(join(ROOT, 'images'), file).replace(/\.(png|jpg|webp)$/, '');
    if (!file.endsWith('.jpg')) {
      images[id] = { file: rel, ...(await anchor(file)) };
    } else {
      const meta = await sharp(file).metadata();
      const entry: Record<string, unknown> = { file: rel, w: meta.width, h: meta.height, ax: (meta.width ?? 0) / 2, ay: meta.height };
      if (id.startsWith('bg/')) entry.horizon = Number((await horizon(file)).toFixed(3));
      images[id] = entry;
    }
  }
  const audio: Record<string, string> = {};
  for (const file of walk(join(ROOT, 'audio'))) {
    if (!/\.(mp3|wav|ogg)$/.test(file)) continue;
    audio[relative(join(ROOT, 'audio'), file).replace(/\.(mp3|wav|ogg)$/, '')] = relative(ROOT, file);
  }
  writeFileSync(join(ROOT, 'manifest.json'), JSON.stringify({ images, audio }, null, 1));
  console.log(`manifest.json: ${Object.keys(images).length} images, ${Object.keys(audio).length} audio files`);
  for (const [id, e] of Object.entries(images)) if (id.startsWith('bg/')) console.log(`  ${id} horizon=${(e as any).horizon}`);
}

main();
