import { describe, expect, it } from 'vitest';
import { QUALIFY_PLACE, SEGMENT_LENGTH } from '../src/config';
import { BIKES, repairCost, SHOP_BIKES, tradeInValue } from '../src/data/bikes';
import { LEVELS, levelDef, prizeFor } from '../src/data/levels';
import { RIDERS } from '../src/data/riders';
import { TRACKS } from '../src/data/tracks';
import { Career, newCareer } from '../src/game/Career';
import { decodePassword, encodePassword } from '../src/game/Password';
import { NO_CONTROLS, Race } from '../src/race/Race';
import { buildTrack, UNITS_PER_MILE } from '../src/race/Track';

describe('password', () => {
  it('round-trips every level, bike, qualification mask and difficulty', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      for (const bike of BIKES) {
        for (const difficulty of ['easy', 'normal', 'hard'] as const) {
          const s = newCareer('X', difficulty);
          s.level = level;
          s.bike = bike.id;
          s.money = 12340 * level;
          s.qualified = [true, false, level % 2 === 0, false, true];
          const back = decodePassword(encodePassword(s))!;
          expect(back).not.toBeNull();
          expect(back.level).toBe(level);
          expect(back.bike).toBe(bike.id);
          expect(back.money).toBe(s.money);
          expect(back.qualified).toEqual(s.qualified);
          expect(back.difficulty).toBe(difficulty);
        }
      }
    }
  });

  it('keeps shop upgrades', () => {
    const s = newCareer('X');
    s.upgrades = { engine: 3, tyres: 1, brakes: 2, armour: 0, nitro: 3 };
    s.money = 987650;
    const back = decodePassword(encodePassword(s))!;
    expect(back.upgrades).toEqual(s.upgrades);
    expect(back.money).toBe(s.money);
  });

  it('still accepts the old 9-character passwords', () => {
    // level 3, $5,000, Raptor 750, normal, Sierra + Redwood qualified (made with the old encoder)
    const legacy = (level: number, mask: number, money: number, bike: number, diff: number) => {
      const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', KEY = [19, 4, 27, 11, 30, 8, 15, 22, 2];
      let v = level - 1;
      v = v * 32 + mask;
      v = v * 2 ** 22 + money / 10;
      v = v * 16 + bike;
      v = v * 4 + diff;
      let h = 0x5a, x = v;
      for (let i = 0; i < 6; i++) (h = (h * 31 + (x % 64)) % 256), (x = Math.floor(x / 64));
      v = v * 256 + h;
      let out = '';
      for (let i = 0; i < 9; i++) (out += ALPHABET[((v % 32) + KEY[i] + i * 7) % 32]), (v = Math.floor(v / 32));
      return out;
    };
    const s = decodePassword(legacy(3, 0b00101, 5000, 4, 1))!;
    expect(s).not.toBeNull();
    expect(s.level).toBe(3);
    expect(s.money).toBe(5000);
    expect(s.bike).toBe('raptor');
    expect(s.qualified).toEqual([true, false, true, false, false]);
  });

  it('is formatted as XXXX-XXXX-XXX and accepts lowercase / missing dashes', () => {
    const pw = encodePassword(newCareer());
    expect(pw).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{3}$/);
    expect(decodePassword(pw.replace(/-/g, '').toLowerCase())).not.toBeNull();
  });

  it('rejects typos and garbage', () => {
    const pw = encodePassword(newCareer()).replace(/-/g, '');
    const typo = (pw[0] === 'A' ? 'B' : 'A') + pw.slice(1);
    expect(decodePassword(typo)).toBeNull();
    expect(decodePassword('HELLO')).toBeNull();
    expect(decodePassword('')).toBeNull();
  });
});

describe('economy', () => {
  it('pays more for better places and higher levels', () => {
    for (const lv of LEVELS) {
      for (let p = 1; p < 10; p++) expect(prizeFor(lv.level, p)).toBeGreaterThan(prizeFor(lv.level, p + 1));
      expect(prizeFor(lv.level, 11)).toBe(0);
    }
    expect(prizeFor(5, 1)).toBeGreaterThan(prizeFor(1, 1));
  });

  it('trade-in is half price and repairs are never free', () => {
    for (const b of BIKES) {
      expect(tradeInValue(b)).toBe(Math.round(b.price / 20) * 10);
      expect(repairCost(b, 1)).toBeGreaterThanOrEqual(300);
    }
  });

  it('career pays, fails when broke and resets tracks on level up', () => {
    const c = new Career(newCareer());
    expect(c.pay(400)).toBe(true);
    expect(c.s.money).toBe(600);
    expect(c.pay(10_000)).toBe(false);
    expect(c.s.money).toBe(0);
    c.s.qualified = [true, true, true, true, true];
    expect(c.levelComplete).toBe(true);
    c.advanceLevel();
    expect(c.s.level).toBe(2);
    expect(c.qualifiedCount()).toBe(0);
  });

  it('bikes get faster as they get pricier (the off-road and cruiser specials aside)', () => {
    const line = SHOP_BIKES.filter((b) => !['mudcat', 'vandal'].includes(b.id));
    for (let i = 1; i < line.length; i++) {
      expect(line[i].price).toBeGreaterThan(line[i - 1].price);
      expect(line[i].topSpeed).toBeGreaterThan(line[i - 1].topSpeed);
    }
    for (let i = 1; i < SHOP_BIKES.length; i++) expect(SHOP_BIKES[i].price).toBeGreaterThan(SHOP_BIKES[i - 1].price);
  });
});

describe('tracks', () => {
  const aspect = () => 0.6;

  it('are deterministic per track + level', () => {
    for (const def of TRACKS) {
      const a = buildTrack(def, levelDef(2), aspect);
      const b = buildTrack(def, levelDef(2), aspect);
      expect(a.segments.length).toBe(b.segments.length);
      expect(a.segments.map((s) => s.curve)).toEqual(b.segments.map((s) => s.curve));
      expect(a.copSpawns).toEqual(b.copSpawns);
    }
  });

  it('get longer each level and match the advertised distance', () => {
    for (const def of TRACKS) {
      let prev = 0;
      for (const lv of LEVELS) {
        const t = buildTrack(def, lv, aspect);
        const miles = t.raceLength / UNITS_PER_MILE;
        expect(miles).toBeCloseTo(lv.miles * def.lengthFactor, 1);
        expect(t.raceLength).toBeGreaterThan(prev);
        expect(t.length).toBeGreaterThan(t.finishZ + 300 * SEGMENT_LENGTH); // run-out past the flag
        prev = t.raceLength;
      }
    }
  });

  it('never gets impossibly steep', () => {
    for (const def of TRACKS) {
      const t = buildTrack(def, levelDef(5), aspect);
      for (const s of t.segments) expect(Math.abs(s.p2.world.y - s.p1.world.y) / SEGMENT_LENGTH).toBeLessThan(0.75);
    }
  });
});

describe('race simulation', () => {
  it('runs 40 seconds on every track and level without errors', () => {
    for (const def of TRACKS) {
      for (const lv of [1, 5]) {
        const race = new Race({ track: def, level: levelDef(lv), bike: BIKES[4], difficulty: 'normal', playerName: 'T', demo: true, aspect: () => 0.6 });
        for (let i = 0; i < 60 * 44; i++) race.update(1 / 60, NO_CONTROLS);
        expect(race.phase).not.toBe('countdown');
        expect(race.standings).toHaveLength(RIDERS.length + 1);
        for (const r of race.racers) {
          expect(Number.isFinite(r.z)).toBe(true);
          expect(Number.isFinite(r.x)).toBe(true);
        }
        expect(race.progress(race.standings[0])).toBeGreaterThan(0.05);
      }
    }
  });

  it('qualifying cut is inside the field', () => {
    expect(QUALIFY_PLACE).toBeGreaterThan(0);
    expect(QUALIFY_PLACE).toBeLessThan(RIDERS.length + 1);
  });
});

describe('split screen', () => {
  it('runs a two-player race; one rider out does not end it for the other', () => {
    const race = new Race({
      track: TRACKS[3], level: levelDef(2), bike: BIKES[4], difficulty: 'normal', playerName: 'P1',
      second: { name: 'P2', bike: BIKES[6] }, rivals: 6, weather: 'rain', aspect: () => 0.6,
    });
    expect(race.humans.length).toBe(2);
    expect(race.racers.length).toBe(8);
    const gas = { ...NO_CONTROLS, throttle: 1 };
    race.godMode = true; // no steering here: don't let traffic end it early
    for (let i = 0; i < 60 * 20; i++) race.update(1 / 60, gas, gas);
    for (const h of race.humans) if (!h.onBike) h.remount();
    // P2 gets wrecked: P1 keeps racing
    race.player2!.damage = 100;
    race.player2!.startCrash('car');
    for (let i = 0; i < 60 * 6; i++) race.update(1 / 60, gas, NO_CONTROLS);
    expect(race.player2!.out).toBe('wrecked');
    expect(race.phase).toBe('racing');
    if (!race.player.onBike) race.player.remount();
    race.player.z = race.track.finishZ - 200;
    for (let i = 0; i < 60 * 8 && race.phase !== 'over'; i++) race.update(1 / 60, gas, NO_CONTROLS);
    expect(race.phase).toBe('over');
    const res = race.finalResults();
    expect(res.find((s) => s.racer === race.player2)!.time).toBe(Infinity);
    expect(race.player.finishTime).not.toBeNull();
  });
});
