/**
 * Race conditions. The career mixes them in from level 2 on; endless runs rotate through them.
 * Visual changes are palette swaps + a lighting pass in the renderer + screen effects (rain);
 * gameplay changes are grip, braking and how hard the rivals push.
 */
import type { TrackColors } from './tracks';
import { mixColor } from '../engine/math';

export type Weather = 'day' | 'dusk' | 'night' | 'rain';

export interface WeatherInfo {
  label: string;
  /** 1 = dry; lower = less steering bite, more slide in bends, weaker brakes */
  grip: number;
  /** rivals ease off a little when it's dark or wet */
  rivalPace: number;
  /** strength of the darkness overlay (0 = none); lights cut through it */
  darkness: number;
  /** colour the darkness is tinted with (r,g,b) */
  tint: string;
  /** headlights / taillights drawn */
  lights: boolean;
}

export const WEATHER: Record<Weather, WeatherInfo> = {
  day: { label: 'DAY', grip: 1, rivalPace: 1, darkness: 0, tint: '0,0,0', lights: false },
  dusk: { label: 'DUSK', grip: 1, rivalPace: 0.99, darkness: 0.3, tint: '58,26,36', lights: true },
  night: { label: 'NIGHT', grip: 1, rivalPace: 0.97, darkness: 0.64, tint: '4,8,26', lights: true },
  rain: { label: 'RAIN', grip: 0.8, rivalPace: 0.95, darkness: 0.2, tint: '24,30,40', lights: true },
};

/** Career conditions per level (rows) and road (columns, in TRACKS order). */
const CAREER: Weather[][] = [
  ['day', 'day', 'day', 'day', 'day'],
  ['day', 'dusk', 'day', 'dusk', 'day'],
  ['dusk', 'day', 'rain', 'night', 'day'],
  ['rain', 'night', 'rain', 'dusk', 'night'],
  ['night', 'rain', 'night', 'night', 'rain'],
];

export function careerWeather(level: number, trackIndex: number): Weather {
  const row = CAREER[Math.max(0, Math.min(CAREER.length - 1, level - 1))];
  return row[Math.max(0, trackIndex) % row.length] ?? 'day';
}

/** The track palette under these conditions. */
export function weatherColors(c: TrackColors, w: Weather): TrackColors {
  if (w === 'day') return c;
  const m = (col: string, to: string, k: number) => mixColor(col, to, k);
  const pair = (p: [string, string], to: string, k: number): [string, string] => [m(p[0], to, k), m(p[1], to, k)];
  if (w === 'night') {
    return {
      sky: '#03050f',
      fog: '#0b1024',
      road: pair(c.road, '#1a1e2a', 0.25),
      rumble: pair(c.rumble, '#1a1e2a', 0.25),
      lane: m(c.lane, '#10131c', 0.2),
      groundL: pair(c.groundL, '#0b1024', 0.55),
      groundR: pair(c.groundR, '#0b1024', 0.55),
    };
  }
  if (w === 'dusk') {
    return {
      sky: '#2b1d52',
      fog: '#e48a58',
      road: pair(c.road, '#3e3030', 0.2),
      rumble: c.rumble,
      lane: c.lane,
      groundL: pair(c.groundL, '#5a3a2a', 0.22),
      groundR: pair(c.groundR, '#5a3a2a', 0.22),
    };
  }
  // rain: grey sky, darker wet road with a cool sheen, washed-out ground
  return {
    sky: '#4c5763',
    fog: '#97a2ad',
    road: pair(c.road, '#262c36', 0.42),
    rumble: pair(c.rumble, '#6a7480', 0.3),
    lane: m(c.lane, '#c9d2dc', 0.2),
    groundL: pair(c.groundL, '#5d6a72', 0.38),
    groundR: pair(c.groundR, '#5d6a72', 0.38),
  };
}
