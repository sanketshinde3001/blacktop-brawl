/** Crops the rider's helmet into favicon / app icons. npx tsx scripts/make-icons.ts */
import sharp from 'sharp';

const src = 'public/assets/images/riders/player/runFront1.webp';
async function main() {
const meta = await sharp(src).metadata();
const w = meta.width!, size = Math.round(w * 0.62);
const helmet = await sharp(src).extract({ left: Math.round((w - size) / 2), top: 0, width: size, height: size }).png().toBuffer();
for (const [name, px] of [['favicon.png', 64], ['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]] as const) {
  await sharp({ create: { width: px, height: px, channels: 4, background: { r: 18, g: 14, b: 20, alpha: 1 } } })
    .composite([{ input: await sharp(helmet).resize(Math.round(px * 0.86), Math.round(px * 0.86)).toBuffer(), gravity: 'center' }])
    .png()
    .toFile(`public/${name}`);
}
console.log("icons written to public/");
}
main();
