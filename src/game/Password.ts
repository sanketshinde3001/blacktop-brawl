/**
 * Classic console-style password. Level, qualified tracks, cash, bike, difficulty and the shop
 * upgrades are packed into one number with an 8-bit checksum and written as 11 characters from a
 * 32-letter alphabet. 9-character passwords from before upgrades existed still decode.
 */
import { BIKES, bikeIndex } from '../data/bikes';
import type { Difficulty } from '../data/levels';
import { NO_UPGRADES, type UpgradeId } from '../data/upgrades';
import { newCareer, type CareerState } from './Career';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KEY = [19, 4, 27, 11, 30, 8, 15, 22, 2, 25, 13];
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const UPGRADE_ORDER: UpgradeId[] = ['engine', 'tyres', 'brakes', 'armour', 'nitro'];
const MONEY_UNIT = 10;
const MONEY_BITS = 22n;

function checksum(v: bigint): bigint {
  let h = 0x5an;
  let x = v;
  for (let i = 0; i < 9; i++) {
    h = (h * 31n + (x % 64n)) % 256n;
    x /= 64n;
  }
  return h;
}

export function encodePassword(s: CareerState): string {
  const mask = s.qualified.reduce((m, q, i) => m | (q ? 1 << i : 0), 0);
  const money = BigInt(Math.min(2 ** 22 - 1, Math.round(s.money / MONEY_UNIT)));
  const up = { ...NO_UPGRADES, ...(s.upgrades ?? {}) };
  let v = BigInt(s.level - 1);
  v = v * 32n + BigInt(mask);
  v = (v << MONEY_BITS) + money;
  v = v * 16n + BigInt(bikeIndex(s.bike));
  v = v * 4n + BigInt(Math.max(0, DIFFS.indexOf(s.difficulty)));
  for (const id of UPGRADE_ORDER) v = v * 4n + BigInt(Math.max(0, Math.min(3, up[id])));
  v = v * 256n + checksum(v);
  const digits: number[] = [];
  for (let i = 0; i < 11; i++) {
    digits.push(Number(v % 32n));
    v /= 32n;
  }
  return digits
    .map((d, i) => ALPHABET[(d + KEY[i] + i * 7) % 32])
    .join('')
    .replace(/(....)(....)(...)/, '$1-$2-$3');
}

export function decodePassword(input: string, name = 'RIDER'): CareerState | null {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length === 9) return decodeLegacy(clean, name);
  if (clean.length !== 11) return null;
  let v = 0n;
  for (let i = 10; i >= 0; i--) {
    const c = ALPHABET.indexOf(clean[i]);
    if (c < 0) return null;
    const d = (((c - KEY[i] - i * 7) % 32) + 64) % 32;
    v = v * 32n + BigInt(d);
  }
  const sum = v % 256n;
  v /= 256n;
  if (checksum(v) !== sum) return null;
  const up = { ...NO_UPGRADES };
  for (const id of [...UPGRADE_ORDER].reverse()) {
    up[id] = Number(v % 4n);
    v /= 4n;
  }
  const diff = Number(v % 4n);
  v /= 4n;
  const bike = Number(v % 16n);
  v /= 16n;
  const money = Number(v % (1n << MONEY_BITS));
  v >>= MONEY_BITS;
  const mask = Number(v % 32n);
  const level = Number(v / 32n) + 1;
  if (level < 1 || level > 5 || bike >= BIKES.length || diff > 2) return null;
  const s = newCareer(name, DIFFS[diff]);
  s.level = level;
  s.money = money * MONEY_UNIT;
  s.bike = BIKES[bike].id;
  s.qualified = s.qualified.map((_, i) => !!(mask & (1 << i)));
  s.upgrades = up;
  return s;
}

/** The original 9-character format (no upgrades). */
const LEGACY_KEY = [19, 4, 27, 11, 30, 8, 15, 22, 2];
function legacyChecksum(v: number): number {
  let h = 0x5a;
  let x = v;
  for (let i = 0; i < 6; i++) {
    h = (h * 31 + (x % 64)) % 256;
    x = Math.floor(x / 64);
  }
  return h;
}

function decodeLegacy(clean: string, name: string): CareerState | null {
  let v = 0;
  for (let i = 8; i >= 0; i--) {
    const c = ALPHABET.indexOf(clean[i]);
    if (c < 0) return null;
    const d = (((c - LEGACY_KEY[i] - i * 7) % 32) + 64) % 32;
    v = v * 32 + d;
  }
  const sum = v % 256;
  v = Math.floor(v / 256);
  if (legacyChecksum(v) !== sum) return null;
  const diff = v % 4;
  v = Math.floor(v / 4);
  const bike = v % 16;
  v = Math.floor(v / 16);
  const money = v % 2 ** 22;
  v = Math.floor(v / 2 ** 22);
  const mask = v % 32;
  const level = Math.floor(v / 32) + 1;
  if (level < 1 || level > 5 || bike >= BIKES.length || diff > 2) return null;
  const s = newCareer(name, DIFFS[diff]);
  s.level = level;
  s.money = money * MONEY_UNIT;
  s.bike = BIKES[bike].id;
  s.qualified = s.qualified.map((_, i) => !!(mask & (1 << i)));
  return s;
}
