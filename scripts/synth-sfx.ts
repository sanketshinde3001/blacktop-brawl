/**
 * Renders the game's sound effects and jingles offline with plain DSP (noise, filters, oscillators,
 * envelopes) and writes them as WAV files. No API, no samples: everything here is original.
 * Existing files (e.g. AI-generated ones) are kept unless --force is passed.
 *
 *   npx tsx scripts/synth-sfx.ts [--force]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SR = 44100;
const OUT = 'public/assets/audio';
const force = process.argv.includes('--force');

// --- tiny DSP kit ---------------------------------------------------------------------------
type Buf = Float32Array;
const buf = (sec: number): Buf => new Float32Array(Math.round(sec * SR));
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function noise(sec: number): Buf {
  const b = buf(sec);
  for (let i = 0; i < b.length; i++) b[i] = rnd();
  return b;
}

/** Oscillator with a frequency function f(t). */
function osc(sec: number, f: (t: number) => number, shape: 'sine' | 'saw' | 'square' | 'tri' = 'sine'): Buf {
  const b = buf(sec);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    ph += f(i / SR) / SR;
    const p = ph - Math.floor(ph);
    b[i] = shape === 'sine' ? Math.sin(2 * Math.PI * p) : shape === 'saw' ? 2 * p - 1 : shape === 'square' ? (p < 0.5 ? 1 : -1) : 1 - 4 * Math.abs(p - 0.5);
  }
  return b;
}

/** Biquad filter (RBJ cookbook). f may vary with time. */
function biquad(x: Buf, type: 'lp' | 'hp' | 'bp', f: number | ((t: number) => number), q = 0.707): Buf {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const fc = Math.min(SR * 0.45, typeof f === 'number' ? f : f(i / SR));
    const w = (2 * Math.PI * fc) / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') (b0 = (1 - cs) / 2), (b1 = 1 - cs), (b2 = (1 - cs) / 2);
    else if (type === 'hp') (b0 = (1 + cs) / 2), (b1 = -(1 + cs)), (b2 = (1 + cs) / 2);
    else (b0 = al), (b1 = 0), (b2 = -al);
    const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1, x1 = x[i], y2 = y1, y1 = v;
    y[i] = v;
  }
  return y;
}

/** Multiply by an envelope function of time. */
function env(x: Buf, e: (t: number) => number): Buf {
  for (let i = 0; i < x.length; i++) x[i] *= e(i / SR);
  return x;
}
const decay = (rate: number, attack = 0.002) => (t: number) => (t < attack ? t / attack : Math.exp(-(t - attack) * rate));
const gain = (x: Buf, g: number) => env(x, () => g);
const drive = (x: Buf, k: number) => {
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * k);
  return x;
};

/** Mix sources into a buffer of `sec`, each at an offset in seconds. */
function mix(sec: number, ...parts: [Buf, number?, number?][]): Buf {
  const out = buf(sec);
  for (const [b, at = 0, g = 1] of parts) {
    const o = Math.round(at * SR);
    for (let i = 0; i < b.length && i + o < out.length; i++) if (i + o >= 0) out[i + o] += b[i] * g;
  }
  return out;
}

function normalize(x: Buf, peak = 0.89): Buf {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  return m ? gain(x, peak / m) : x;
}

function fadeEdges(x: Buf, inSec = 0.002, outSec = 0.05): Buf {
  const a = Math.round(inSec * SR), b = Math.round(outSec * SR);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b;
  return x;
}

/** Seamless loop: cross-fade the tail into the head. */
function loopify(x: Buf, xf = 0.3): Buf {
  const n = Math.round(xf * SR), len = x.length - n;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    if (i < n) {
      const t = i / n;
      out[i] = x[len + i] * Math.cos((t * Math.PI) / 2) + x[i] * Math.sin((t * Math.PI) / 2);
    } else out[i] = x[i];
  }
  return out;
}

function wav(x: Buf): Buffer {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  return b;
}

// --- the sounds ------------------------------------------------------------------------------
const thump = (f0: number, f1: number, sec: number, rate: number) => env(osc(sec, (t) => f1 + (f0 - f1) * Math.exp(-t * 30)), decay(rate));

const SOUNDS: Record<string, () => Buf> = {
  'sfx/punch': () =>
    mix(0.35, [thump(140, 55, 0.3, 18), 0, 1], [env(biquad(noise(0.08), 'lp', 2200), decay(45)), 0, 0.7], [env(biquad(noise(0.05), 'bp', 500, 2), decay(60)), 0.01, 0.4]),
  'sfx/kick': () =>
    mix(0.45, [thump(120, 45, 0.4, 12), 0, 1.1], [env(biquad(noise(0.12), 'lp', 1500), decay(30)), 0, 0.8], [env(biquad(noise(0.15), 'bp', 380, 3), decay(25)), 0.02, 0.5]),
  'sfx/club': () =>
    mix(
      0.4,
      [env(biquad(noise(0.03), 'bp', 2600, 1.2), decay(120)), 0, 1.2],
      [env(osc(0.3, () => 720), decay(28)), 0, 0.5],
      [env(osc(0.3, () => 1180), decay(35)), 0, 0.35],
      [thump(160, 70, 0.25, 22), 0, 0.7],
    ),
  'sfx/thud': () => mix(0.45, [thump(95, 38, 0.4, 10), 0, 1], [env(biquad(noise(0.3), 'lp', 420), decay(14)), 0, 0.9]),
  'sfx/crash': () => {
    const scrape = env(biquad(noise(2.2), 'bp', (t) => 2600 - t * 500 + 400 * Math.sin(t * 37), 1.5), (t) => Math.exp(-t * 1.3) * (0.6 + 0.4 * Math.sin(t * 61) ** 2));
    const clangs: [Buf, number, number][] = [0.0, 0.18, 0.42, 0.75, 1.1].map((at, i) => [
      env(mix(0.6, [osc(0.6, () => 420 + i * 97)], [osc(0.6, () => 690 + i * 61), 0, 0.7], [osc(0.6, () => 1130 + i * 43), 0, 0.5]), decay(9)),
      at,
      0.35 / (i + 1),
    ]);
    return mix(2.4, [drive(env(biquad(noise(0.25), 'lp', 3000), decay(14)), 2), 0, 1], [thump(110, 40, 0.5, 8), 0, 0.9], [scrape, 0.05, 0.6], ...clangs);
  },
  'sfx/carCrash': () => {
    const glass: [Buf, number, number][] = [];
    for (let i = 0; i < 40; i++) glass.push([env(biquad(noise(0.04), 'hp', 4000 + (rnd() + 1) * 2500), decay(90)), 0.05 + Math.abs(rnd()) * 0.7, 0.25 + Math.abs(rnd()) * 0.25]);
    return mix(
      2.4,
      [drive(env(biquad(noise(0.5), 'lp', 1800), decay(6)), 3), 0, 1],
      [thump(80, 30, 0.8, 5), 0, 1],
      [env(drive(biquad(noise(1.6), 'bp', 900, 0.8), 2), decay(2.5)), 0.08, 0.35],
      ...glass,
    );
  },
  'sfx/screech': () => {
    const tone = env(osc(1.5, (t) => 1150 + 60 * Math.sin(t * 40) + 30 * Math.sin(t * 13), 'saw'), (t) => Math.min(1, t * 12) * Math.min(1, (1.5 - t) * 4));
    const hiss = env(biquad(noise(1.5), 'bp', (t) => 2300 + 200 * Math.sin(t * 30), 6), (t) => Math.min(1, t * 10) * Math.min(1, (1.5 - t) * 3));
    return mix(1.5, [biquad(tone, 'bp', 1200, 3), 0, 0.6], [hiss, 0, 1]);
  },
  'sfx/horn': () => {
    const honk = (sec: number) => env(drive(mix(sec, [osc(sec, () => 415, 'square')], [osc(sec, () => 520, 'square'), 0, 0.8]), 1.4), (t) => Math.min(1, t * 60) * Math.min(1, (sec - t) * 40));
    return mix(0.95, [biquad(honk(0.22), 'lp', 2500), 0, 1], [biquad(honk(0.45), 'lp', 2500), 0.36, 1]);
  },
  'sfx/truckHorn': () => {
    const sec = 1.5;
    const chord = mix(sec, [osc(sec, () => 155, 'saw')], [osc(sec, () => 196, 'saw'), 0, 0.8], [osc(sec, () => 233, 'saw'), 0, 0.7]);
    return env(biquad(drive(chord, 1.6), 'lp', 1800), (t) => Math.min(1, t * 15) * Math.min(1, (sec - t) * 6));
  },
  'sfx/whoosh': () => env(biquad(noise(1.1), 'bp', (t) => 400 + 2400 * Math.sin((t / 1.1) * Math.PI), 1.5), (t) => Math.sin((t / 1.1) * Math.PI) ** 2),
  'sfx/grab': () => env(biquad(noise(0.28), 'bp', (t) => 1500 + t * 9000, 1.2), (t) => Math.sin((t / 0.28) * Math.PI) ** 2),
  'sfx/cash': () =>
    mix(
      1.1,
      [env(biquad(noise(0.03), 'bp', 3000, 2), decay(150)), 0, 0.8],
      [env(biquad(noise(0.05), 'bp', 1800, 2), decay(80)), 0.08, 0.6],
      [env(osc(0.9, () => 2093), decay(5)), 0.15, 0.5],
      [env(osc(0.9, () => 2637), decay(5.5)), 0.15, 0.4],
      [env(osc(0.9, () => 3136), decay(6)), 0.15, 0.3],
    ),
  'sfx/grunt': () => {
    const v = osc(0.32, (t) => 135 - t * 120, 'saw');
    return env(mix(0.32, [biquad(v, 'bp', 600, 4), 0, 1], [biquad(v, 'bp', 1000, 5), 0, 0.6], [biquad(noise(0.32), 'bp', 900, 2), 0, 0.12]), (t) => Math.min(1, t * 40) * Math.exp(-t * 7));
  },
  'sfx/yell': () => {
    const v = osc(0.9, (t) => 210 - t * 70 + 6 * Math.sin(t * 34), 'saw');
    return env(drive(mix(0.9, [biquad(v, 'bp', 800, 4), 0, 1], [biquad(v, 'bp', 1250, 5), 0, 0.7], [biquad(noise(0.9), 'bp', 1100, 2), 0, 0.15]), 1.5), (t) => Math.min(1, t * 20) * Math.min(1, (0.9 - t) * 4));
  },
  'sfx/crowd': () => {
    const sec = 3.4;
    const layers: [Buf, number, number][] = [];
    for (let i = 0; i < 14; i++) {
      const f = 350 + Math.abs(rnd()) * 1600;
      const ph = Math.abs(rnd()) * 6;
      const rate = 0.6 + Math.abs(rnd()) * 1.8;
      layers.push([env(biquad(noise(sec), 'bp', f, 3), (t) => 0.5 + 0.5 * Math.sin(ph + t * rate * 2 * Math.PI)), 0, 0.5]);
    }
    // a few whistles
    for (let i = 0; i < 3; i++) {
      const at = 0.3 + i * 1.0;
      layers.push([env(osc(0.5, (t) => 2200 + 400 * Math.sin(t * 9) + i * 150), (t) => Math.sin((t / 0.5) * Math.PI)), at, 0.12]);
    }
    return loopify(mix(sec, ...layers));
  },
  'sfx/gravel': () => {
    const sec = 3.3;
    const crunch = noise(sec);
    for (let i = 0; i < crunch.length; i++) crunch[i] *= rnd() > 0.93 ? 2.5 : 0.3; // grit
    return loopify(mix(sec, [biquad(crunch, 'bp', 1600, 1), 0, 0.8], [biquad(noise(sec), 'lp', 180), 0, 1.4]));
  },
  'sfx/siren': () => loopify(env(drive(osc(3.3, (t) => 900 + 400 * Math.sin(t * 2 * Math.PI * 0.9), 'tri'), 1.5), () => 0.8)),
};

// Little fanfares: [midi note or 0 for rest, beats]
type Note = [number, number];
function jingle(bpm: number, lead: Note[], bass: Note[], minor = false): Buf {
  const beat = 60 / bpm;
  const total = lead.reduce((s, [, b]) => s + b, 0) * beat + 0.8;
  const voice = (notes: Note[], shape: 'square' | 'saw', vol: number, cutoff: number) => {
    const parts: [Buf, number, number][] = [];
    let at = 0;
    for (const [n, b] of notes) {
      const sec = b * beat;
      if (n) {
        const f = 440 * 2 ** ((n - 69) / 12);
        const len = sec + 0.15;
        parts.push([env(biquad(osc(len, (t) => f * (1 + 0.004 * Math.sin(t * 30)), shape), 'lp', cutoff), (t) => Math.min(1, t * 80) * Math.exp(-t * (b > 1.5 ? 1.2 : 3))), at, vol]);
      }
      at += sec;
    }
    return parts;
  };
  const drums: [Buf, number, number][] = [];
  for (let t = 0; t < total - 0.8; t += beat) drums.push([thump(140, 45, 0.3, 14), t, 0.6]);
  for (let t = beat; t < total - 0.8; t += beat * 2) drums.push([env(biquad(noise(0.15), 'bp', 1800, 0.8), decay(30)), t, 0.4]);
  void minor;
  return mix(total, ...voice(lead, 'square', 0.35, 4000), ...voice(bass, 'saw', 0.45, 900), ...drums);
}

const JINGLES: Record<string, () => Buf> = {
  'music/win': () => jingle(150, [[64, 0.5], [67, 0.5], [71, 0.5], [76, 1], [74, 0.5], [76, 0.5], [79, 3]], [[40, 1], [43, 1], [47, 1], [52, 4]]),
  'music/levelup': () => jingle(160, [[67, 0.5], [71, 0.5], [74, 0.5], [79, 0.5], [78, 0.5], [79, 0.5], [83, 0.5], [86, 3]], [[43, 2], [47, 2], [50, 3]]),
  'music/lose': () => jingle(90, [[69, 1], [67, 1], [64, 1], [63, 1], [60, 3]], [[45, 2], [43, 2], [40, 3]], true),
  'music/busted': () => jingle(100, [[57, 0.75], [0, 0.25], [56, 0.75], [0, 0.25], [55, 3]], [[33, 1], [32, 1], [31, 3]], true),
  'music/gameover': () => jingle(70, [[64, 1], [63, 1], [62, 1], [61, 1], [60, 4]], [[40, 2], [38, 2], [36, 4]], true),
};

let made = 0, kept = 0;
for (const [id, make] of Object.entries({ ...SOUNDS, ...JINGLES })) {
  const isJingle = id.startsWith('music/');
  const path = join(OUT, `${id}.wav`);
  const generated = existsSync(join(OUT, `${id}.mp3`)) || existsSync(path);
  if (generated && !force) {
    kept++;
    continue;
  }
  seed = 12345 + id.length * 977;
  const loops = ['sfx/crowd', 'sfx/gravel', 'sfx/siren'].includes(id);
  const out = normalize(loops ? make() : fadeEdges(make()), loops ? 0.6 : isJingle ? 0.8 : 0.89);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, wav(out));
  made++;
}
console.log(`synthesised ${made} sounds (${kept} existing kept)`);
