/** localStorage persistence for options and an autosave slot. Fails silently (private mode etc.). */
import type { CameraMode } from '../config';
import type { Difficulty } from '../data/levels';
import type { CareerState } from './Career';

export interface Options {
  musicVolume: number;
  sfxVolume: number;
  difficulty: Difficulty;
  showFps: boolean;
  voice: boolean;
  camera: CameraMode;
}

export const DEFAULT_OPTIONS: Options = { musicVolume: 0.6, sfxVolume: 0.9, difficulty: 'normal', showFps: false, voice: true, camera: 'chase' };

const OPT_KEY = 'blacktop.options.v1';
const SAVE_KEY = 'blacktop.save.v1';
/** keys used before the rename; read once so existing players keep their career */
const LEGACY: Record<string, string> = { [OPT_KEY]: 'roadrash.options.v1', [SAVE_KEY]: 'roadrash.save.v1' };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key) ?? (LEGACY[key] ? localStorage.getItem(LEGACY[key]) : null);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const Storage = {
  loadOptions: (): Options => ({ ...DEFAULT_OPTIONS, ...(read<Options>(OPT_KEY) ?? {}) }),
  saveOptions: (o: Options) => write(OPT_KEY, o),
  loadCareer: (): CareerState | null => read<CareerState>(SAVE_KEY),
  saveCareer: (c: CareerState | null) => write(SAVE_KEY, c),
};

/** Personal bests, achievements and lifetime stats (local; online boards are optional). */
export interface Records {
  endlessBest: number;
  endlessStage: number;
  /** daily challenge: best per date (YYYY-MM-DD) */
  daily: Record<string, number>;
  achievements: string[];
  stats: Record<string, number>;
  /** name used for runs and leaderboards */
  name: string;
  /** weapons the player has ever taken off a rival */
  weapons: string[];
  /** this device's own scoreboards (used when no online board is set up) */
  boards: { endless: BoardEntry[]; daily: Record<string, BoardEntry[]> };
}

export interface BoardEntry {
  name: string;
  score: number;
  /** endless: stage reached */
  stage?: number;
  date: string;
}

const RECORDS_KEY = 'blacktop.records.v1';
export const DEFAULT_RECORDS: Records = { endlessBest: 0, endlessStage: 0, daily: {}, achievements: [], stats: {}, name: '', weapons: [], boards: { endless: [], daily: {} } };

export const RecordStore = {
  load: (): Records => ({ ...DEFAULT_RECORDS, ...(read<Records>(RECORDS_KEY) ?? {}) }),
  save: (r: Records) => write(RECORDS_KEY, r),
};
