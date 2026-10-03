/**
 * Level progression. Qualify (finish in the top QUALIFY_PLACE) on all five tracks to move up.
 * Each level: longer races, faster rivals, more cops, more traffic, bigger purses.
 */

export interface LevelDef {
  level: number;
  miles: number;
  /** rival cruising speed band in mph (skill 0 -> 1) */
  aiSpeed: [number, number];
  copSpeed: number;
  cops: number;
  /** cars per mile */
  traffic: number;
  prizeScale: number;
  fine: number;
  /** road layout seed (defaults to the level number); endless stages use their own */
  trackSeed?: string;
}

export const LEVELS: LevelDef[] = [
  // Rival speeds sit clearly under the bike you can afford by then (112 / 130 / 151 / 170 / 192 mph),
  // so clean riding wins; fights, traffic and cops are what make it tricky.
  { level: 1, miles: 3.0, aiSpeed: [80, 100], copSpeed: 118, cops: 1, traffic: 3, prizeScale: 1, fine: 300 },
  { level: 2, miles: 3.5, aiSpeed: [92, 115], copSpeed: 132, cops: 1, traffic: 4, prizeScale: 1.6, fine: 500 },
  { level: 3, miles: 4.0, aiSpeed: [104, 130], copSpeed: 150, cops: 2, traffic: 5, prizeScale: 2.4, fine: 800 },
  { level: 4, miles: 4.5, aiSpeed: [116, 145], copSpeed: 168, cops: 2, traffic: 6, prizeScale: 3.4, fine: 1200 },
  { level: 5, miles: 5.0, aiSpeed: [128, 160], copSpeed: 186, cops: 3, traffic: 7, prizeScale: 4.6, fine: 1600 },
];

/** Purse for places 1..10; 11th and worse get nothing. */
const BASE_PRIZES = [1250, 950, 700, 520, 380, 280, 200, 140, 90, 50];

export function levelDef(level: number): LevelDef {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level - 1))];
}

export function prizeFor(level: number, place: number): number {
  const base = BASE_PRIZES[place - 1] ?? 0;
  return Math.round((base * levelDef(level).prizeScale) / 10) * 10;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/** Multiplier on rival speed and aggression. */
export const DIFFICULTY: Record<Difficulty, { speed: number; aggression: number; label: string }> = {
  easy: { speed: 0.92, aggression: 0.55, label: 'EASY' },
  normal: { speed: 1.0, aggression: 0.85, label: 'NORMAL' },
  hard: { speed: 1.16, aggression: 1.3, label: 'HARD' },
};
