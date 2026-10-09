/**
 * Generates every image in scripts/assets/images.ts with Gemini.
 *
 *   npm run assets:images                       # generate anything missing
 *   npm run assets:images -- --only riders/punk # regenerate ids starting with a prefix (implies --force)
 *   npm run assets:images -- --force            # regenerate everything
 *   npm run assets:images -- --reprocess        # re-run chroma key / resize from cached raw images, no API calls
 *   npm run assets:images -- --list             # print ids
 *
 * Raw model output is cached in .asset-cache/raw so post-processing can be tuned without paying again.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { IMAGE_ASSETS, type ImageAsset } from './assets/images';
import { FatalError, generateImage, type InlineFile } from './lib/gemini';
import { processPicture, processSprite } from './lib/image';

const ROOT = process.cwd();
const RAW_DIR = resolve(ROOT, '.asset-cache/raw');
const OUT_DIR = resolve(ROOT, 'public/assets/images');

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const only = opt('only')?.split(',');
const force = flag('force') || !!only;
const reprocess = flag('reprocess');
const concurrency = Number(opt('concurrency') ?? 6);

const byId = new Map(IMAGE_ASSETS.map((a) => [a.id, a]));
const rawPath = (a: ImageAsset) => resolve(RAW_DIR, `${a.id}.bin`);
const outPath = (a: ImageAsset) => resolve(OUT_DIR, `${a.id}.${a.kind === 'sprite' ? 'webp' : 'jpg'}`);
const selected = (a: ImageAsset) => !only || only.some((p) => a.id === p || a.id.startsWith(p.endsWith('/') ? p : `${p}`));

function save(path: string, data: Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

async function postProcess(a: ImageAsset, raw: Buffer) {
  const out =
    a.kind === 'sprite'
      ? await processSprite(raw, { scale: a.scale, maxDim: a.maxDim })
      : await processPicture(raw, { maxWidth: a.maxWidth, tile: a.tile });
  save(outPath(a), out);
}

const inFlight = new Map<string, Promise<void>>();
let done = 0, failed = 0;
const failures: string[] = [];

function ensure(a: ImageAsset): Promise<void> {
  let p = inFlight.get(a.id);
  if (!p) {
    p = build(a);
    inFlight.set(a.id, p);
  }
  return p;
}

// Simple semaphore so dependent edits don't deadlock waiting on their base.
let active = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= concurrency) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

async function build(a: ImageAsset): Promise<void> {
  const raw = rawPath(a);
  if (reprocess) {
    if (existsSync(raw)) await postProcess(a, readFileSync(raw));
    return;
  }
  const wanted = selected(a);
  if (existsSync(raw) && (!force || !wanted)) {
    if (!existsSync(outPath(a))) await postProcess(a, readFileSync(raw));
    return;
  }
  if (!wanted && existsSync(raw)) return;

  const refs: InlineFile[] = [];
  if (a.base) {
    const base = byId.get(a.base);
    if (!base) throw new Error(`${a.id}: unknown base ${a.base}`);
    await ensure(base);
    if (!existsSync(rawPath(base))) throw new Error(`${a.id}: base ${a.base} failed`);
    refs.push({ mimeType: 'image/jpeg', data: readFileSync(rawPath(base)) });
  }
  const img = await slot(() =>
    generateImage({ model: a.model ?? 'flash', prompt: a.prompt, aspect: a.aspect, size: a.size, refs }, a.id),
  );
  save(raw, img.data);
  await postProcess(a, img.data);
  done++;
  console.log(`  ✓ ${a.id}  (${done} generated)`);
}

async function main() {
  if (flag('list')) {
    for (const a of IMAGE_ASSETS) console.log(`${a.id.padEnd(34)} ${a.kind.padEnd(8)} ${a.model ?? 'flash'}${a.base ? `  <- ${a.base}` : ''}`);
    return;
  }
  const targets = IMAGE_ASSETS.filter((a) => reprocess || selected(a));
  console.log(`${reprocess ? 'Reprocessing' : 'Generating'} ${targets.length} image assets (concurrency ${concurrency})…`);
  await Promise.all(
    targets.map((a) =>
      ensure(a).catch((e) => {
        if (e instanceof FatalError) {
          console.error(`\n${e.message}`);
          process.exit(2);
        }
        failed++;
        failures.push(`${a.id}: ${e?.message ?? e}`);
        console.error(`  ✗ ${a.id}: ${e?.message ?? e}`);
      }),
    ),
  );
  console.log(`Done. generated=${done} failed=${failed}`);
  if (failures.length) {
    console.log('Failures:\n  ' + failures.join('\n  '));
    process.exitCode = 1;
  }
}

main();
