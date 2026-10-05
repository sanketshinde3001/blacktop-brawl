/**
 * Road model for the pseudo-3D renderer: a list of short segments, each with a curve amount and
 * start/end heights. Built deterministically from a TrackDef + level.
 */
import { MPH, SEGMENT_LENGTH, RUMBLE_LENGTH, ROAD_WIDTH } from '../config';
import type { PropDef, TrackDef } from '../data/tracks';
import type { LevelDef } from '../data/levels';
import { easeIn, easeInOut } from '../engine/math';
import { Rng } from '../engine/Rng';

export interface ProjectedPoint {
  world: { x: number; y: number; z: number };
  camera: { x: number; y: number; z: number };
  screen: { x: number; y: number; w: number; scale: number };
}

export interface PropInstance {
  sprite: string;
  offset: number;
  /** world size */
  w: number;
  h: number;
  solid: number;
  flip: boolean;
  /** raise the sprite this far above the road (start/finish gantries), with poles drawn down to it */
  lift?: number;
}

export interface Segment {
  index: number;
  p1: ProjectedPoint;
  p2: ProjectedPoint;
  curve: number;
  props: PropInstance[];
  dark: boolean;
  /** start/finish line painted across the road */
  line?: 'start' | 'finish';
  /** computed by the renderer each frame */
  clip: number;
  fog: number;
  visible: boolean;
}

/** units per mile: 1 mph == MPH units/second */
export const UNITS_PER_MILE = MPH * 3600;

const point = (z: number, y: number): ProjectedPoint => ({
  world: { x: 0, y, z },
  camera: { x: 0, y: 0, z: 0 },
  screen: { x: 0, y: 0, w: 0, scale: 0 },
});

export class Track {
  segments: Segment[] = [];
  startZ = 0;
  finishZ = 0;
  copSpawns: { z: number; side: 1 | -1 }[] = [];
  /** lengths of the race proper, for the progress bar */
  get raceLength() {
    return this.finishZ - this.startZ;
  }
  get length() {
    return this.segments.length * SEGMENT_LENGTH;
  }

  constructor(public def: TrackDef, public level: LevelDef) {}

  findSegment(z: number): Segment {
    const i = Math.floor(z / SEGMENT_LENGTH);
    return this.segments[Math.max(0, Math.min(this.segments.length - 1, i))];
  }

  heightAt(z: number): number {
    const s = this.findSegment(z);
    const t = Math.max(0, Math.min(1, (z - s.p1.world.z) / SEGMENT_LENGTH));
    return s.p1.world.y + (s.p2.world.y - s.p1.world.y) * t;
  }

  curveAt(z: number): number {
    return this.findSegment(z).curve;
  }

  // --- building ------------------------------------------------------------------------
  private lastY(): number {
    return this.segments.length ? this.segments[this.segments.length - 1].p2.world.y : 0;
  }

  addSegment(curve: number, y: number) {
    const n = this.segments.length;
    this.segments.push({
      index: n,
      p1: point(n * SEGMENT_LENGTH, this.lastY()),
      p2: point((n + 1) * SEGMENT_LENGTH, y),
      curve,
      props: [],
      dark: Math.floor(n / RUMBLE_LENGTH) % 2 === 1,
      clip: 0,
      fog: 0,
      visible: false,
    });
  }

  /** Classic ease-in / hold / ease-out road section. `hill` is in segment lengths. */
  addRoad(enter: number, hold: number, leave: number, curve: number, hill: number) {
    const startY = this.lastY();
    const endY = startY + hill * SEGMENT_LENGTH;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) this.addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    for (let n = 0; n < hold; n++) this.addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    for (let n = 0; n < leave; n++) this.addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
  }
}

export type AspectLookup = (spriteId: string) => number;

const GRID_SEGMENTS = 40;
const RUNOUT_SEGMENTS = 420;

/**
 * Builds the road for a track at a level. `aspect` returns width/height of a sprite so props get
 * correct world widths for collisions.
 */
export function buildTrack(def: TrackDef, level: LevelDef, aspect: AspectLookup): Track {
  const t = new Track(def, level);
  const rng = new Rng(`${def.id}:${level.trackSeed ?? level.level}`);
  const st = def.style;
  const raceSegments = Math.round((level.miles * def.lengthFactor * UNITS_PER_MILE) / SEGMENT_LENGTH);

  // Grid + a gentle opening so the pack can spread out.
  t.addRoad(0, GRID_SEGMENTS, 0, 0, 0);
  const startIndex = GRID_SEGMENTS - 8;
  t.addRoad(20, 60, 20, rng.sign() * 1.5, 0);

  const finishIndex = startIndex + raceSegments;
  let lastCurveSign = 0;
  while (t.segments.length < finishIndex - 80) {
    const len = rng.int(st.sectionLength[0], st.sectionLength[1]);
    const enter = Math.max(4, Math.floor(len * 0.25));
    const hold = Math.max(4, Math.floor(len * 0.5));
    const leave = Math.max(4, len - enter - hold);
    let curve = 0;
    if (rng.chance(st.curviness)) {
      // S-bends: often flip direction after a curve
      const sign = lastCurveSign && rng.chance(0.6) ? -lastCurveSign : rng.sign();
      curve = sign * rng.range(1.5, st.maxCurve);
      lastCurveSign = sign;
    } else lastCurveSign = 0;
    let hill = 0;
    if (rng.chance(st.hilliness)) {
      const h = t.segments[t.segments.length - 1].p2.world.y / SEGMENT_LENGTH;
      // drift back toward sea level so the road doesn't climb forever
      const dir = Math.abs(h) > st.maxHill * 1.2 ? -Math.sign(h) : rng.sign();
      hill = dir * Math.min(rng.range(st.maxHill * 0.3, st.maxHill), len * 0.14);
    }
    t.addRoad(enter, hold, leave, curve, hill);
  }
  // Level off into a straight finish.
  const y = t.segments[t.segments.length - 1].p2.world.y / SEGMENT_LENGTH;
  t.addRoad(30, 40, 30, 0, -y * 0.5);
  while (t.segments.length < finishIndex + RUNOUT_SEGMENTS) t.addRoad(0, 50, 0, 0, 0);

  t.startZ = startIndex * SEGMENT_LENGTH;
  t.finishZ = finishIndex * SEGMENT_LENGTH;
  t.segments[startIndex].line = 'start';
  t.segments[finishIndex].line = 'finish';

  placeProps(t, rng, aspect, startIndex, finishIndex);

  // Cops wait at the roadside, spread through the middle of the race.
  for (let i = 0; i < level.cops; i++) {
    const frac = 0.15 + (0.7 * (i + rng.range(0.2, 0.8))) / level.cops;
    t.copSpawns.push({ z: t.startZ + frac * t.raceLength, side: def.oceanLeft ? 1 : rng.sign() });
  }
  return t;
}

function makeProp(def: PropDef, side: number, rng: Rng, aspect: AspectLookup, extra = 0): PropInstance {
  const w = def.height * aspect(def.sprite);
  const half = w / 2 / ROAD_WIDTH;
  const [a, b] = def.spread ?? [0.1, 1.5];
  return {
    sprite: def.sprite,
    offset: side * (1.12 + half * 0.8 + rng.range(a, b) + extra),
    w,
    h: def.height,
    solid: def.solid,
    flip: rng.chance(0.5) && !def.sprite.includes('billboard') && !def.sprite.includes('sign') && !def.sprite.includes('gas'),
  };
}

function placeProps(t: Track, rng: Rng, aspect: AspectLookup, startIndex: number, finishIndex: number) {
  const def = t.def;
  const regular = def.props.filter((p) => p.weight > 0).map((p) => ({ weight: p.weight, value: p }));
  const pole = def.props.find((p) => p.sprite === 'props/pole');
  const segs = t.segments;
  const at = (i: number) => segs[Math.max(0, Math.min(segs.length - 1, i))];
  const add = (i: number, p: PropInstance) => at(i).props.push(p);

  // Start: banner, flag man and crowds.
  const banner = (i: number, sprite: string) =>
    add(i, { sprite, offset: 0, w: ROAD_WIDTH * 2.9, h: (ROAD_WIDTH * 2.9) / aspect(sprite), solid: 0, flip: false, lift: 1100 });
  banner(startIndex, 'props/bannerStart');
  banner(finishIndex, 'props/bannerFinish');
  add(startIndex + 2, { sprite: 'props/flagmanUp', offset: def.oceanLeft ? 1.18 : -1.18, w: 900 * aspect('props/flagmanUp'), h: 900, solid: 0, flip: false });
  for (const [center, count] of [[startIndex, 5], [finishIndex, 7]] as const) {
    for (let k = 0; k < count; k++) {
      const i = center - 6 + k * 4;
      for (const side of [-1, 1]) {
        if (side === -1 && def.oceanLeft && k % 2) continue;
        const sprite = k % 2 ? 'props/crowd2' : 'props/crowd1';
        const h = 1100;
        const w = h * aspect(sprite);
        add(i, { sprite, offset: side * (1.25 + w / 2 / ROAD_WIDTH + rng.range(0, 0.3)), w, h, solid: 0.9, flip: side < 0 });
      }
    }
  }

  const quiet = (i: number) => Math.abs(i - startIndex) < 26 || Math.abs(i - finishIndex) < 30;

  // Curve warnings on the outside of sharp bends.
  for (let i = startIndex + 20; i < segs.length - 40; i++) {
    const c = segs[i].curve, prev = segs[i - 1].curve;
    if (Math.abs(c) >= 3 && Math.abs(prev) < 0.5 && !quiet(i)) {
      const side = c < 0 ? 1 : -1;
      if (side === -1 && def.oceanLeft) continue;
      for (const back of [28, 18]) {
        add(i - back, { sprite: 'props/signCurve', offset: side * 1.2, w: 1400 * aspect('props/signCurve'), h: 1400, solid: 0.15, flip: c > 0 });
      }
    }
  }

  for (let i = 4; i < segs.length; i++) {
    if (quiet(i)) continue;
    // Telephone poles march along one side through long stretches.
    if (pole && i % 26 === 0 && Math.floor(i / 900) % 2 === 0) {
      const side = def.oceanLeft ? 1 : Math.floor(i / 1800) % 2 ? -1 : 1;
      add(i, makeProp(pole, side, rng, aspect, -0.02));
    }
    for (const side of [-1, 1] as const) {
      if (side === -1 && def.oceanLeft) continue;
      if (!rng.chance(def.style.propDensity * 0.5)) continue;
      const p = rng.weighted(regular);
      if (p.side && p.side !== 'both' && (p.side === 'left') !== (side === -1)) continue;
      const isFence = p.sprite.includes('fence');
      if (isFence) {
        const run = rng.int(6, 14);
        const inst = makeProp(p, side, rng, aspect);
        for (let k = 0; k < run; k++) add(i + k * 2, { ...inst });
        i += run;
        continue;
      }
      add(i, makeProp(p, side, rng, aspect));
      for (let k = 1; k < (p.clump ?? 1); k++) add(i + rng.int(1, 4), makeProp(p, side, rng, aspect, rng.range(0.1, 0.9)));
    }
  }
}
