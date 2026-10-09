/**
 * Paints real-world brand badges out of generated art by cloning neighbouring pixels over them.
 * Each patch: copy a w x h block from (sx, sy) to (dx, dy). Originals are kept in .asset-cache/retired/.
 *   npx tsx scripts/debadge.ts
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

type Patch =
  /** copy a w x h block from (sx, sy) to (dx, dy) */
  | { kind: 'clone'; sx: number; sy: number; dx: number; dy: number; w: number; h: number }
  /** fill each row of the box by blending between the pixels just left and right of it */
  | { kind: 'rows'; x: number; y: number; w: number; h: number };

const PATCHES: Record<string, Patch[]> = {
  // prancing-horse emblem in the rear grille: grille slats continue from the left
  'cars/sportsRear': [{ kind: 'clone', sx: 205, sy: 146, dx: 241, dy: 146, w: 32, h: 38 }],
  // bug-style badge on the truck's hood: the hood bands run straight across under it
  'cars/semiFront': [{ kind: 'rows', x: 189, y: 198, w: 26, h: 37 }],
};

const only = process.argv[2];
for (const [id, patches] of Object.entries(PATCHES)) {
  if (only && id !== only) continue;
  const file = `public/assets/images/${id}.webp`;
  const { data, info } = await sharp(readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  for (const p of patches) {
    if (p.kind === 'clone') {
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++) {
          const s = ((p.sy + y) * W + p.sx + x) * 4, d = ((p.dy + y) * W + p.dx + x) * 4;
          for (let k = 0; k < 4; k++) data[d + k] = data[s + k];
        }
    } else {
      for (let y = p.y; y < p.y + p.h; y++) {
        const l = (y * W + p.x - 1) * 4, r = (y * W + p.x + p.w) * 4;
        for (let x = 0; x < p.w; x++) {
          const t = (x + 1) / (p.w + 1), d = (y * W + p.x + x) * 4;
          for (let k = 0; k < 4; k++) data[d + k] = Math.round(data[l + k] * (1 - t) + data[r + k] * t);
        }
      }
    }
  }
  writeFileSync(file, await sharp(data, { raw: { width: W, height: info.height, channels: 4 } }).webp({ quality: 92, alphaQuality: 100 }).toBuffer());
  console.log('patched', id);
}
