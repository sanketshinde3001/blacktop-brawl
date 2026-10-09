/**
 * Redraws derived (grafted) frames with a local Qwen-Image 2.1 Studio (http://127.0.0.1:7860),
 * using the same prompts and source images as the Gemini pipeline. Nothing leaves the machine.
 *
 *   npx tsx scripts/qwen-frames.ts [--only riders/punk] [--size 768] [--seed 42]
 *       -> renders into .asset-cache/qwen-review/<id>.webp (the game is untouched)
 *   npx tsx scripts/qwen-frames.ts --reject riders/racer/punchR
 *       -> discards a bad render; the next run redraws it with a different seed
 *   npx tsx scripts/qwen-frames.ts --apply riders/punk/punchL,riders/punk/punchR
 *       -> copies approved frames into public/assets/images and drops them from derived.json
 *
 * Jobs go through the Studio's own queue, so its cool-down and one-engine-at-a-time rules apply.
 * On top of that, before each job this script waits for the Studio to finish cooling and then
 * rests `--rest` more seconds (default 90), and it stops starting new jobs after `--minutes`.
 *   npx tsx scripts/qwen-frames.ts --minutes 60 --rest 90
 *   npx tsx scripts/qwen-frames.ts --ids riders/punk/front,riders/cop/front   (new frames)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IMAGE_ASSETS } from './assets/images';
import { processSprite } from './lib/image';

const STUDIO = process.env.QWEN_STUDIO ?? 'http://127.0.0.1:7860';
const RAW = '.asset-cache/raw';
const REVIEW = '.asset-cache/qwen-review';
const QWEN_RAW = '.asset-cache/qwen-raw';
const IMAGES = 'public/assets/images';
const DERIVED = join(IMAGES, 'derived.json');
/** Frames rejected in review: id -> times rejected. They re-render with a new seed and never apply as-is. */
const REJECTED = '.asset-cache/qwen-rejected.json';
const rejected: Record<string, number> = existsSync(REJECTED) ? JSON.parse(readFileSync(REJECTED, 'utf8')) : {};

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const size = Number(opt('size') ?? 768);
const seed = Number(opt('seed') ?? 42);
const restSec = Number(opt('rest') ?? 90);
const budgetMin = opt('minutes') ? Number(opt('minutes')) : Infinity;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Let the Mac cool: wait out the Studio's own cool-down, then rest a little longer. */
async function coolDown() {
  for (;;) {
    const st = await api('/api/state');
    if (!(st.cooling > 0)) break;
    await sleep(Math.min(30, st.cooling + 1) * 1000);
  }
  await sleep(restSec * 1000);
}

async function api(path: string, body?: unknown): Promise<any> {
  const res = await fetch(STUDIO + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json;
}

const uploaded = new Map<string, string>();
async function upload(id: string): Promise<string> {
  let name = uploaded.get(id);
  if (!name) {
    const data = readFileSync(join(RAW, `${id}.bin`)).toString('base64');
    name = (await api('/api/upload', { data: `data:image/jpeg;base64,${data}`, filename: `rr_${id.replace(/\//g, '_')}.jpg`, kind: 'image' })).name as string;
    uploaded.set(id, name);
  }
  return name;
}

async function render(id: string): Promise<string> {
  const a = IMAGE_ASSETS.find((x) => x.id === id);
  if (!a?.base) throw new Error(`${id}: no base image / prompt in the manifest`);
  const ref = await upload(a.base);
  const jobSeed = seed + 1000 * (rejected[id] ?? 0);
  const { ids } = await api('/api/jobs', { mode: 'edit', prompt: a.prompt, refs: [ref], width: size, height: size, turbo: true, seed: jobSeed });
  const job = ids[0];
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const j = (await api('/api/state')).jobs.find((x: any) => x.id === job);
    if (!j) throw new Error(`${id}: job vanished`);
    if (j.state === 'done') {
      const out = Buffer.from(await (await fetch(`${STUDIO}/outputs/${encodeURIComponent(j.output)}`)).arrayBuffer());
      mkdirSync(dirname(join(QWEN_RAW, id)), { recursive: true });
      writeFileSync(join(QWEN_RAW, `${id}.png`), out);
      // same keying / trimming as the Gemini frames; scale matched to a 1024 px source
      const scale = a.scale ? (a.scale * 1024) / size : undefined;
      const sprite = await processSprite(out, { scale, maxDim: a.maxDim, despill: true });
      mkdirSync(dirname(join(REVIEW, id)), { recursive: true });
      writeFileSync(join(REVIEW, `${id}.webp`), sprite);
      return `${Math.round((Date.now() - t0) / 1000)}s`;
    }
    if (['error', 'failed', 'cancelled'].includes(j.state)) throw new Error(`${id}: ${j.error ?? j.state}`);
  }
}

function apply(ids: string[]) {
  const derived: string[] = existsSync(DERIVED) ? JSON.parse(readFileSync(DERIVED, 'utf8')) : [];
  for (const id of ids) {
    const src = join(REVIEW, `${id}.webp`);
    if (!existsSync(src)) {
      console.log(`  skip ${id}: not rendered`);
      continue;
    }
    // Qwen keeps the framing of the 1024 px source, so frames already line up with the riding
    // frame (checked by overlaying them); copy as rendered.
    copyFileSync(src, join(IMAGES, `${id}.webp`));
    const i = derived.indexOf(id);
    if (i >= 0) derived.splice(i, 1);
    console.log(`  applied ${id}`);
  }
  writeFileSync(DERIVED, JSON.stringify(derived, null, 1));
  console.log('Run `npm run assets:manifest` to refresh anchors.');
}

/** Re-key everything already rendered (after changing the post-processing), no new jobs. */
async function reprocess() {
  for (const a of IMAGE_ASSETS) {
    const raw = join(QWEN_RAW, `${a.id}.png`);
    if (!existsSync(raw)) continue;
    const scale = a.scale ? (a.scale * 1024) / size : undefined;
    writeFileSync(join(REVIEW, `${a.id}.webp`), await processSprite(readFileSync(raw), { scale, maxDim: a.maxDim, despill: true }));
    console.log(`  re-keyed ${a.id}`);
  }
}

/** Marks frames as rejected: their review render is discarded and the next run uses a new seed. */
function reject(ids: string[]) {
  for (const id of ids) {
    rejected[id] = (rejected[id] ?? 0) + 1;
    const f = join(REVIEW, `${id}.webp`);
    if (existsSync(f)) writeFileSync(join(REVIEW, `${id}.rejected-${rejected[id]}.webp.bak`), readFileSync(f));
    if (existsSync(f)) unlinkSync(f);
    console.log(`  rejected ${id} (next seed ${seed + 1000 * rejected[id]})`);
  }
  writeFileSync(REJECTED, JSON.stringify(rejected, null, 1));
}

async function main() {
  if (args.includes('--reprocess')) return reprocess();
  if (opt('reject')) return reject(opt('reject')!.split(','));
  if (opt('keep-current')) {
    for (const id of opt('keep-current')!.split(',')) rejected[id] = 99;
    writeFileSync(REJECTED, JSON.stringify(rejected, null, 1));
    return console.log('kept current frames for', opt('keep-current'));
  }
  if (opt('apply')) return apply(opt('apply')!.split(','));
  // --ids renders new frames that aren't in derived.json yet (e.g. riders/punk/front)
  const derived: string[] = opt('ids') ? opt('ids')!.split(',') : JSON.parse(readFileSync(DERIVED, 'utf8'));
  const only = opt('only')?.split(',');
  // rejected twice (or marked --keep-current) = the model doesn't manage it: keep the current frame
  const todo = derived.filter((id) => (rejected[id] ?? 0) < 2 && (!only || only.some((p) => id.startsWith(p))) && IMAGE_ASSETS.some((a) => a.id === id && a.base));
  // most visible first: attack poses, then crash frames, then the rest
  const rank = (id: string) => (/(punch|kick|club)[LR]$/.test(id) ? 0 : /(tumble|bikeDown)$/.test(id) ? 1 : 2);
  todo.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const left = todo.filter((id) => !existsSync(join(REVIEW, `${id}.webp`)) || args.includes('--force'));
  console.log(`${left.length} of ${todo.length} frames left to render at ${size}px via ${STUDIO} (budget ${budgetMin} min, extra rest ${restSec}s)`);
  const t0 = Date.now();
  let first = true;
  for (const id of left) {
    if ((Date.now() - t0) / 60000 >= budgetMin) {
      console.log(`Time budget used: stopping. Re-run the same command to continue.`);
      break;
    }
    if (!first) await coolDown();
    first = false;
    try {
      console.log(`  ✓ ${id} (${await render(id)})`);
    } catch (e: any) {
      console.log(`  ✗ ${e.message}`);
    }
  }
}

main();
