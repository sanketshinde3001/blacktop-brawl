/**
 * The five roads. Geometry is generated from `style` with a seeded RNG (see race/TrackBuilder.ts),
 * so a track is identical every time for a given level but gets longer as levels go up.
 */

export interface PropDef {
  sprite: string;
  /** world height in units (rider ~820) */
  height: number;
  weight: number;
  side?: 'left' | 'right' | 'both';
  /** extra distance beyond the road edge, normalised (1 = half road width) */
  spread?: [number, number];
  /** fraction of drawn width that is solid; 0 = you can ride through it */
  solid: number;
  /** place in clumps of this many (trees) */
  clump?: number;
  flip?: boolean;
}

export interface TrackStyle {
  /** chance per section of a curve vs. straight */
  curviness: number;
  maxCurve: number;
  /** chance per section of a hill */
  hilliness: number;
  maxHill: number;
  sectionLength: [number, number];
  /** probability of a prop on each side of each segment */
  propDensity: number;
}

export interface TrackColors {
  sky: string;
  fog: string;
  road: [string, string];
  rumble: [string, string];
  lane: string;
  groundL: [string, string];
  groundR: [string, string];
}

export interface TrackDef {
  id: string;
  name: string;
  blurb: string;
  bg: string;
  music: string;
  lengthFactor: number;
  colors: TrackColors;
  style: TrackStyle;
  props: PropDef[];
  /** continuous guard rail on the left (Pacific Coast cliff side) */
  railLeft?: boolean;
  /** props only on the right (left is ocean) */
  oceanLeft?: boolean;
  /** marker position on the map art (fraction of the image) */
  map: { x: number; y: number };
}

const common: PropDef[] = [
  { sprite: 'props/pole', height: 4200, weight: 0, solid: 0.12 },
  { sprite: 'props/billboard1', height: 2600, weight: 0.5, solid: 0.9, spread: [0.6, 1.4] },
  { sprite: 'props/billboard2', height: 2600, weight: 0.5, solid: 0.9, spread: [0.6, 1.4] },
  { sprite: 'props/billboard3', height: 2600, weight: 0.5, solid: 0.9, spread: [0.6, 1.4] },
  { sprite: 'props/billboard4', height: 2600, weight: 0.5, solid: 0.9, spread: [0.6, 1.4] },
  { sprite: 'props/signSpeed', height: 1300, weight: 0.4, solid: 0.15, spread: [0.05, 0.2] },
  { sprite: 'props/mailbox', height: 700, weight: 0.3, solid: 0.4, spread: [0.05, 0.3] },
];

export const TRACKS: TrackDef[] = [
  {
    id: 'sierra',
    name: 'Sierra Nevada',
    blurb: 'Hairpins, steep grades and sheer drops. Watch the trees.',
    bg: 'bg/sierra',
    music: 'music/race_sierra',
    lengthFactor: 1.0,
    colors: {
      sky: '#1d7ee0', fog: '#a9c9e6',
      road: ['#6c6c70', '#636367'], rumble: ['#d8d8d8', '#c0282a'], lane: '#f2f2f2',
      groundL: ['#2f6a2c', '#2a6127'], groundR: ['#2f6a2c', '#2a6127'],
    },
    style: { curviness: 0.7, maxCurve: 5, hilliness: 0.65, maxHill: 40, sectionLength: [25, 60], propDensity: 0.3 },
    props: [
      ...common,
      { sprite: 'props/pine', height: 5200, weight: 6, solid: 0.22, clump: 3, spread: [0.2, 2.2] },
      { sprite: 'props/pineTall', height: 7200, weight: 4, solid: 0.15, clump: 2, spread: [0.3, 2.5] },
      { sprite: 'props/boulderSnow', height: 1500, weight: 2, solid: 0.8, spread: [0.1, 1.2] },
      { sprite: 'props/cabin', height: 2600, weight: 0.8, solid: 0.9, spread: [0.8, 2] },
      { sprite: 'props/fenceWood', height: 700, weight: 1.2, solid: 1, spread: [0.05, 0.2] },
      { sprite: 'props/log', height: 600, weight: 0.8, solid: 0.9, spread: [0.1, 0.8] },
      { sprite: 'props/signSierra', height: 1500, weight: 0.3, solid: 0.9, spread: [0.2, 0.6] },
      { sprite: 'props/rock', height: 1100, weight: 1.5, solid: 0.8, spread: [0.1, 1.5] },
    ],
    map: { x: 0.75, y: 0.3 },
  },
  {
    id: 'pacific',
    name: 'Pacific Coast',
    blurb: 'Cliffside highway. One side is rock, the other is a long swim.',
    bg: 'bg/pacific',
    music: 'music/race_pacific',
    lengthFactor: 1.1,
    colors: {
      sky: '#2b8fe8', fog: '#c0dcf2',
      road: ['#727276', '#6a6a6e'], rumble: ['#ececec', '#b8b8b8'], lane: '#ffd23a',
      groundL: ['#1f63b0', '#1c5ba3'], groundR: ['#d8c08a', '#cfb77f'],
    },
    style: { curviness: 0.6, maxCurve: 4, hilliness: 0.5, maxHill: 30, sectionLength: [40, 90], propDensity: 0.26 },
    railLeft: true,
    oceanLeft: true,
    props: [
      ...common,
      { sprite: 'props/palm', height: 5600, weight: 5, solid: 0.15, clump: 2, spread: [0.2, 1.8] },
      { sprite: 'props/cypress', height: 3600, weight: 2, solid: 0.25, spread: [0.3, 1.8] },
      { sprite: 'props/beachHouse', height: 3000, weight: 1.5, solid: 0.9, spread: [0.8, 2] },
      { sprite: 'props/lighthouse', height: 6500, weight: 0.3, solid: 0.5, spread: [1.2, 2.5] },
      { sprite: 'props/coastalRock', height: 1600, weight: 1.5, solid: 0.8, spread: [0.1, 1.5] },
      { sprite: 'props/surfShack', height: 2000, weight: 1, solid: 0.9, spread: [0.5, 1.5] },
      { sprite: 'props/bush', height: 700, weight: 1.5, solid: 0, spread: [0.05, 1] },
    ],
    map: { x: 0.3, y: 0.56 },
  },
  {
    id: 'redwood',
    name: 'Redwood Forest',
    blurb: 'Tight and twisty under trees older than dirt. Dark, fast, deadly.',
    bg: 'bg/redwood',
    music: 'music/race_redwood',
    lengthFactor: 0.95,
    colors: {
      sky: '#5fa2d8', fog: '#7f9a7a',
      road: ['#5d5d61', '#57575b'], rumble: ['#d0d0d0', '#8a3a22'], lane: '#e8e8e8',
      groundL: ['#2c4a1e', '#27431a'], groundR: ['#2c4a1e', '#27431a'],
    },
    style: { curviness: 0.8, maxCurve: 4.5, hilliness: 0.4, maxHill: 20, sectionLength: [20, 50], propDensity: 0.45 },
    props: [
      ...common,
      { sprite: 'props/redwood', height: 11000, weight: 6, solid: 0.2, clump: 2, spread: [0.2, 2.2] },
      { sprite: 'props/redwood2', height: 9000, weight: 4, solid: 0.2, clump: 2, spread: [0.3, 2.4] },
      { sprite: 'props/fern', height: 800, weight: 4, solid: 0, spread: [0.02, 1] },
      { sprite: 'props/stump', height: 900, weight: 1.2, solid: 0.8, spread: [0.1, 1] },
      { sprite: 'props/rangerStation', height: 2400, weight: 0.4, solid: 0.9, spread: [0.8, 1.6] },
      { sprite: 'props/mossyRock', height: 1200, weight: 1.5, solid: 0.8, spread: [0.1, 1.2] },
      { sprite: 'props/log', height: 600, weight: 1, solid: 0.9, spread: [0.1, 0.8] },
    ],
    map: { x: 0.33, y: 0.24 },
  },
  {
    id: 'desert',
    name: 'Palm Desert',
    blurb: 'Long straights, blind crests and big air. Cops love this stretch.',
    bg: 'bg/desert',
    music: 'music/race_desert',
    lengthFactor: 1.15,
    colors: {
      sky: '#4aa3e8', fog: '#ead6ae',
      road: ['#76706c', '#6e6864'], rumble: ['#f0f0f0', '#c83a2a'], lane: '#ffd23a',
      groundL: ['#d9a560', '#cf9b56'], groundR: ['#d9a560', '#cf9b56'],
    },
    style: { curviness: 0.35, maxCurve: 4, hilliness: 0.75, maxHill: 45, sectionLength: [40, 100], propDensity: 0.2 },
    props: [
      ...common,
      { sprite: 'props/saguaro', height: 3600, weight: 5, solid: 0.25, spread: [0.1, 2] },
      { sprite: 'props/joshua', height: 3000, weight: 3, solid: 0.25, spread: [0.2, 2] },
      { sprite: 'props/desertRock', height: 2200, weight: 2, solid: 0.8, spread: [0.3, 2] },
      { sprite: 'props/gasStation', height: 2600, weight: 0.4, solid: 0.9, spread: [0.6, 1.4] },
      { sprite: 'props/skull', height: 500, weight: 0.8, solid: 0, spread: [0.05, 0.8] },
      { sprite: 'props/tumbleweed', height: 600, weight: 1.5, solid: 0, spread: [0.02, 1] },
      { sprite: 'props/barrelCactus', height: 700, weight: 2, solid: 0.6, spread: [0.05, 1.2] },
    ],
    map: { x: 0.76, y: 0.73 },
  },
  {
    id: 'grass',
    name: 'Grass Valley',
    blurb: 'Rolling farm roads. Beware of cows, tractors and angry farmers.',
    bg: 'bg/grass',
    music: 'music/race_grass',
    lengthFactor: 1.0,
    colors: {
      sky: '#3d95e6', fog: '#bcd8ee',
      road: ['#6f6f73', '#68686c'], rumble: ['#e6e6e6', '#bcbcbc'], lane: '#f2f2f2',
      groundL: ['#4ea539', '#479a33'], groundR: ['#4ea539', '#479a33'],
    },
    style: { curviness: 0.55, maxCurve: 4, hilliness: 0.7, maxHill: 35, sectionLength: [30, 70], propDensity: 0.28 },
    props: [
      ...common,
      { sprite: 'props/oak', height: 4200, weight: 4, solid: 0.25, clump: 2, spread: [0.2, 2] },
      { sprite: 'props/barn', height: 3200, weight: 1, solid: 0.9, spread: [0.8, 2] },
      { sprite: 'props/farmhouse', height: 3000, weight: 0.8, solid: 0.9, spread: [0.8, 2] },
      { sprite: 'props/cow', height: 1000, weight: 1.5, solid: 0.7, spread: [0.2, 1.4] },
      { sprite: 'props/haybale', height: 800, weight: 1.5, solid: 0.8, spread: [0.1, 1.2] },
      { sprite: 'props/windmill', height: 5000, weight: 0.6, solid: 0.3, spread: [0.6, 2] },
      { sprite: 'props/silo', height: 5200, weight: 0.6, solid: 0.6, spread: [1, 2.2] },
      { sprite: 'props/fenceWhite', height: 600, weight: 1.5, solid: 1, spread: [0.05, 0.2] },
      { sprite: 'props/bush', height: 700, weight: 1.5, solid: 0, spread: [0.05, 1] },
    ],
    map: { x: 0.54, y: 0.46 },
  },
];

export function trackById(id: string): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
