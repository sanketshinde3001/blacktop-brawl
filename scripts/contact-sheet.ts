/**
 * Builds a contact sheet of generated images on a checkerboard so chroma-key quality is easy to eyeball.
 *   npx tsx scripts/contact-sheet.ts <prefix> [out.png] [cellSize]
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';

const prefix = process.argv[2] ?? '';
const out = process.argv[3] ?? 'contact-sheet.png';
const cell = Number(process.argv[4] ?? 256);
const root = resolve('public/assets/images');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

async function main() {
  const files = walk(root)
    .filter((f) => /\.(png|jpg|webp)$/.test(f) && relative(root, f).startsWith(prefix))
    .sort();
  const cols = Math.min(8, Math.max(1, files.length));
  const rows = Math.ceil(files.length / cols);
  const labelH = 18;
  const W = cols * cell, H = rows * (cell + labelH);
  const checker = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = ((x >> 4) + (y >> 4)) % 2 ? 150 : 200;
      const i = (y * W + x) * 4;
      checker[i] = c; checker[i + 1] = c + 20; checker[i + 2] = c; checker[i + 3] = 255;
    }
  const composites: OverlayOptions[] = [];
  for (let i = 0; i < files.length; i++) {
    const x = (i % cols) * cell, y = Math.floor(i / cols) * (cell + labelH);
    const img = await sharp(files[i]).resize(cell - 8, cell - 8, { fit: 'inside' }).png().toBuffer();
    const meta = await sharp(img).metadata();
    composites.push({ input: img, left: x + Math.round((cell - (meta.width ?? 0)) / 2), top: y + Math.round((cell - (meta.height ?? 0)) / 2) });
    const name = relative(root, files[i]).replace(/\.(png|jpg|webp)$/, '');
    const svg = `<svg width="${cell}" height="${labelH}"><rect width="100%" height="100%" fill="black"/><text x="4" y="13" font-size="12" font-family="monospace" fill="white">${name.slice(-34)}</text></svg>`;
    composites.push({ input: Buffer.from(svg), left: x, top: y + cell });
  }
  await sharp(checker, { raw: { width: W, height: H, channels: 4 } }).composite(composites).png().toFile(out);
  console.log(`${files.length} images -> ${out}`);
}
main();
