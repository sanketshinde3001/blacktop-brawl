/**
 * Generates music, jingles, sound effects and voice lines listed in scripts/assets/audio.ts.
 * Requires ffmpeg on PATH.
 *
 *   npm run assets:audio                      # generate anything missing
 *   npm run assets:audio -- --only sfx/punch  # regenerate one (prefix match, implies --force)
 *   npm run assets:audio -- --reprocess       # re-run processing from cached raw files (no API calls)
 *   npm run assets:audio -- --no-qa           # skip the Gemini listening check
 *
 * Sound effects and voice lines are checked by a Gemini model that listens to the result; a clip
 * that does not match its description is regenerated (up to 3 tries).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AUDIO_ASSETS, type AudioAsset } from './assets/audio';
import { askAboutAudio, FatalError, generateMusic, generateSfxClip, generateSpeech } from './lib/gemini';

const ROOT = process.cwd();
const RAW = resolve(ROOT, '.asset-cache/raw-audio');
const OUT = resolve(ROOT, 'public/assets/audio');
const RATE = 44100;

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : undefined);
const only = opt('only')?.split(',');
const force = flag('force') || !!only;
const reprocess = flag('reprocess');
const qa = !flag('no-qa');
const concurrency = Number(opt('concurrency') ?? 4);

const MODELS = { music: 'lyria-3.5', jingle: 'lyria-3-clip-preview', sfx: 'gemini-omni-flash-preview', voice: 'gemini-3.8-flash-tts' };

const rawExt = (a: AudioAsset) => ({ music: 'mp3', jingle: 'mp3', sfx: 'mp4', voice: 'wav' })[a.type];
const rawPath = (a: AudioAsset) => resolve(RAW, `${a.id}.${rawExt(a)}`);
const outPath = (a: AudioAsset) => resolve(OUT, `${a.id}.${a.type === 'sfx' ? 'wav' : 'mp3'}`);

function ff(argv: string[], input?: Buffer): Buffer {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { input, maxBuffer: 1 << 30 });
}

/** Decode any audio/video file to mono float samples. */
function decode(file: string): Float32Array {
  const pcm = ff(['-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']);
  return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4).slice();
}

function envelopeDb(s: Float32Array, win: number): number[] {
  const env: number[] = [];
  for (let i = 0; i < s.length; i += win) {
    let sum = 0;
    const end = Math.min(s.length, i + win);
    for (let j = i; j < end; j++) sum += s[j] * s[j];
    env.push(10 * Math.log10(sum / Math.max(1, end - i) + 1e-12));
  }
  return env;
}

/** One-shot: find the main hit, start just before its onset, stop when it decays or at maxSec. */
function extractOneShot(s: Float32Array, maxSec: number): Float32Array {
  const win = Math.round(RATE * 0.01);
  const env = envelopeDb(s, win);
  const peak = Math.max(...env);
  let onset = env.findIndex((e) => e >= peak - 8);
  let start = onset;
  while (start > 0 && onset - start < 6 && env[start - 1] > peak - 30) start--;
  let end = Math.min(env.length, start + Math.round(maxSec / 0.01));
  for (let i = onset + 5, quiet = 0; i < end; i++) {
    quiet = env[i] < peak - 38 ? quiet + 1 : 0;
    if (quiet >= 10) { end = i; break; }
  }
  const out = s.slice(start * win, end * win);
  const fadeIn = Math.round(RATE * 0.004), fadeOut = Math.min(out.length >> 1, Math.round(RATE * 0.08));
  for (let i = 0; i < fadeIn && i < out.length; i++) out[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= i / fadeOut;
  return out;
}

/** Loop: take the loudest steady window and cross-fade its tail into its head so it repeats seamlessly. */
function extractLoop(s: Float32Array, sec: number): Float32Array {
  const len = Math.round(sec * RATE), xf = Math.round(0.25 * RATE);
  const need = len + xf;
  if (s.length <= need) return s;
  const win = Math.round(RATE * 0.05);
  const env = envelopeDb(s, win).map((d) => 10 ** (d / 10));
  const wins = Math.ceil(need / win);
  let best = 0, bestE = -1;
  for (let i = 0; i + wins <= env.length; i++) {
    let e = 0;
    for (let j = i; j < i + wins; j++) e += env[j];
    if (e > bestE) { bestE = e; best = i; }
  }
  const src = s.subarray(best * win, best * win + need);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    if (i < xf) {
      const t = i / xf;
      out[i] = src[len + i] * Math.cos((t * Math.PI) / 2) + src[i] * Math.sin((t * Math.PI) / 2);
    } else out[i] = src[i];
  }
  return out;
}

function normalize(s: Float32Array, peakDb: number) {
  let peak = 0;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? Math.min(16, 10 ** (peakDb / 20) / peak) : 1;
  for (let i = 0; i < s.length; i++) s[i] *= g;
}

function encode(samples: Float32Array, out: string, args: string[]) {
  mkdirSync(dirname(out), { recursive: true });
  const buf = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  ff(['-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', '-', ...args, out], buf);
}

function processAudio(a: AudioAsset, raw: string) {
  const out = outPath(a);
  mkdirSync(dirname(out), { recursive: true });
  if (a.type === 'music') {
    ff(['-i', raw, '-vn', '-af', 'loudnorm=I=-15:TP=-1.5:LRA=11', '-ar', String(RATE), '-b:a', '128k', out]);
  } else if (a.type === 'jingle') {
    const fade = Math.min(2, a.seconds * 0.3);
    ff(['-i', raw, '-vn', '-af', `silenceremove=start_periods=1:start_threshold=-40dB,atrim=0:${a.seconds},afade=t=out:st=${a.seconds - fade}:d=${fade},loudnorm=I=-14:TP=-1.5`, '-ar', String(RATE), '-b:a', '128k', out]);
  } else if (a.type === 'sfx') {
    const s = a.loop ? extractLoop(decode(raw), a.seconds) : extractOneShot(decode(raw), a.seconds);
    normalize(s, a.loop ? -4 : -1);
    encode(s, out, ['-ar', '32000', '-c:a', 'pcm_s16le']);
  } else {
    const s = extractOneShot(decode(raw), 8);
    normalize(s, -1);
    encode(s, out, ['-b:a', '128k']);
  }
}

async function fetchRaw(a: AudioAsset): Promise<Buffer> {
  switch (a.type) {
    case 'music': return (await generateMusic(MODELS.music, a.prompt, a.id)).data;
    case 'jingle': return (await generateMusic(MODELS.jingle, a.prompt, a.id)).data;
    case 'sfx': return (await generateSfxClip(MODELS.sfx, a.prompt, a.id)).data;
    case 'voice': return (await generateSpeech(MODELS.voice, a.text, a.voice, a.id)).data;
  }
}

/** Ask Gemini to listen to the processed clip. Returns null when it passes. */
async function check(a: AudioAsset): Promise<string | null> {
  if (!qa || (a.type !== 'sfx' && a.type !== 'voice')) return null;
  const file = outPath(a);
  const mime = file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
  const question =
    a.type === 'voice'
      ? `Transcribe the spoken words exactly. Then decide if they match this line (ignoring punctuation/case): "${a.text}". Reply as JSON {"match": boolean, "heard": string}.`
      : `Listen to this clip. Is it clearly this sound effect: "${a.what}"? It must not contain music or speech. Reply as JSON {"match": boolean, "heard": string} where heard is a short description.`;
  const res = await askAboutAudio(readFileSync(file), mime, question, a.id);
  return res.match ? null : res.heard;
}

async function build(a: AudioAsset) {
  const raw = rawPath(a);
  const wanted = !only || only.some((p) => a.id.startsWith(p));
  if (reprocess) {
    if (existsSync(raw)) processAudio(a, raw);
    return;
  }
  if (!wanted) return;
  if (existsSync(raw) && !force) {
    if (!existsSync(outPath(a))) processAudio(a, raw);
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const data = await fetchRaw(a);
    mkdirSync(dirname(raw), { recursive: true });
    writeFileSync(raw, data);
    processAudio(a, raw);
    const problem = await check(a).catch((e) => (console.warn(`  ? ${a.id} QA error: ${e.message}`), null));
    if (!problem) {
      console.log(`  ✓ ${a.id}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      return;
    }
    console.log(`  ↻ ${a.id} rejected by QA (heard: ${problem})`);
    if (attempt === 3) {
      console.log(`  ! ${a.id} kept last attempt after 3 tries`);
      return;
    }
    rmSync(outPath(a), { force: true });
  }
}

async function main() {
  const list = [...AUDIO_ASSETS];
  let failed = 0;
  console.log(`${reprocess ? 'Reprocessing' : 'Generating'} ${list.length} audio assets…`);
  const workers = Array.from({ length: concurrency }, async () => {
    while (list.length) {
      const a = list.shift()!;
      try {
        await build(a);
      } catch (e: any) {
        if (e instanceof FatalError) {
          console.error(`\n${e.message}`);
          process.exit(2);
        }
        failed++;
        console.error(`  ✗ ${a.id}: ${e?.message ?? e}`);
      }
    }
  });
  await Promise.all(workers);
  console.log(`Done. failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main();
