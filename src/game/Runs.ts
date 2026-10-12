/**
 * Arcade runs outside the career.
 *  - Endless: stage after stage through all five roads with rotating conditions; rivals get
 *    faster every stage, bike damage carries over (with a quick patch-up), finish top 4 to go on.
 *  - Daily challenge: one race a day, the same road / conditions / bike for everyone.
 * Both use a fixed stock bike so scores are comparable.
 */
import { QUALIFY_PLACE } from '../config';
import { bikeById } from '../data/bikes';
import type { LevelDef } from '../data/levels';
import { TRACKS, type TrackDef } from '../data/tracks';
import type { Weather } from '../data/weather';
import { Rng } from '../engine/Rng';

export type RunMode = 'endless' | 'daily';

export interface RunState {
  mode: RunMode;
  stage: number;
  score: number;
  /** bike damage carried into the next stage */
  damage: number;
  knockouts: number;
  bike: string;
  name: string;
  /** daily: the date this challenge belongs to */
  date?: string;
  history: { track: string; place: number; points: number }[];
}

/** What RaceScene needs to start a run race. */
export interface RunRace {
  mode: RunMode;
  stage: number;
  level: LevelDef;
  bike: string;
  damage: number;
}

export const ENDLESS_BIKE = 'raptor';
export const RUN_QUALIFY = QUALIFY_PLACE;
const ENDLESS_WEATHER: Weather[] = ['day', 'dusk', 'night', 'rain', 'day', 'night', 'dusk', 'rain'];

export function newEndless(name: string): RunState {
  return { mode: 'endless', stage: 1, score: 0, damage: 0, knockouts: 0, bike: ENDLESS_BIKE, name, history: [] };
}

export function endlessStage(run: RunState): { track: TrackDef; weather: Weather; race: RunRace } {
  const n = run.stage;
  const track = TRACKS[(n - 1) % TRACKS.length];
  const weather = ENDLESS_WEATHER[(n - 1) % ENDLESS_WEATHER.length];
  const top = bikeById(run.bike).topSpeed;
  // rivals close in on your top speed stage by stage
  const f = Math.min(0.97, 0.62 + 0.035 * (n - 1));
  const level: LevelDef = {
    level: Math.min(5, n),
    miles: 2.2 + Math.min(1.3, n * 0.1),
    aiSpeed: [top * (f - 0.17), top * f],
    copSpeed: top * 1.04,
    cops: Math.min(4, 1 + Math.floor((n - 1) / 2)),
    traffic: Math.min(10, 3 + n),
    prizeScale: 1,
    fine: 0,
    trackSeed: `endless-${n}`,
  };
  return { track, weather, race: { mode: 'endless', stage: n, level, bike: run.bike, damage: run.damage } };
}

/** Points for a stage: placing, a winner's bonus and knockouts, all scaled by the stage. */
export function stagePoints(place: number, knockouts: number, stage: number, finished: boolean): number {
  if (!finished) return knockouts * 100;
  const placing = Math.max(0, 16 - place) * 50;
  const win = place === 1 ? 500 : 0;
  return Math.round((placing + win) * (1 + (stage - 1) * 0.25)) + knockouts * 100;
}

// --- daily challenge -----------------------------------------------------------------------------
export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DAILY_BIKES = ['jackal', 'kestrel', 'raptor', 'banshee', 'inferno', 'tempest'];
const DAILY_WEATHER: Weather[] = ['day', 'dusk', 'night', 'rain'];

/** Today's race: the same for everyone on the same date. */
export function dailySpec(date = todayKey()) {
  const rng = new Rng(`daily:${date}`);
  const track = TRACKS[rng.int(0, TRACKS.length - 1)];
  const weather = DAILY_WEATHER[rng.int(0, DAILY_WEATHER.length - 1)];
  const bike = DAILY_BIKES[rng.int(0, DAILY_BIKES.length - 1)];
  const top = bikeById(bike).topSpeed;
  const f = rng.range(0.78, 0.9);
  const level: LevelDef = {
    level: rng.int(2, 5),
    miles: Number(rng.range(3, 4.5).toFixed(1)),
    aiSpeed: [top * (f - 0.16), top * f],
    copSpeed: top * 1.05,
    cops: rng.int(1, 3),
    traffic: rng.int(4, 8),
    prizeScale: 1,
    fine: 0,
    trackSeed: `daily-${date}`,
  };
  return { date, track, weather, bike, level };
}

export function newDaily(name: string, date = todayKey()): RunState {
  return { mode: 'daily', stage: 1, score: 0, damage: 0, knockouts: 0, bike: dailySpec(date).bike, name, date, history: [] };
}

/**
 * Daily score: finishing time matters most (faster = more), plus place and knockouts.
 * Busted / wrecked / quit scores only the knockouts.
 */
export function dailyPoints(place: number, time: number, knockouts: number, finished: boolean): number {
  if (!finished) return knockouts * 100;
  return Math.max(0, Math.round(20000 - time * 60)) + Math.max(0, 16 - place) * 150 + knockouts * 100;
}
