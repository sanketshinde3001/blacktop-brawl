/**
 * End-to-end career: a human-like bot plays the whole game from $1,000 on the starter bike to
 * champion, settling every race with the same rules as the results screen and buying bikes
 * between levels. Proves the game can be finished and the economy never dead-ends.
 */
import { describe, expect, it } from 'vitest';
import { LEVEL_COUNT } from '../src/config';
import { SHOP_BIKES, tradeInValue } from '../src/data/bikes';
import { levelDef } from '../src/data/levels';
import { TRACKS } from '../src/data/tracks';
import { Career, newCareer, type RaceEnd } from '../src/game/Career';
import { decodePassword, encodePassword } from '../src/game/Password';
import { botControls } from '../src/race/Bot';
import { Race } from '../src/race/Race';
import { careerWeather } from '../src/data/weather';

function runRace(c: Career, trackIndex: number): { kind: RaceEnd; place: number } {
  const race = new Race({
    track: TRACKS[trackIndex],
    level: levelDef(c.s.level),
    bike: c.bike,
    difficulty: c.s.difficulty,
    playerName: c.s.name,
    aspect: () => 0.6,
    weather: careerWeather(c.s.level, trackIndex),
    upgrades: c.upgrades,
  });
  for (let i = 0; i < 60 * 60 * 6 && race.phase !== 'over'; i++) {
    race.update(1 / 60, botControls(race));
    race.events.length = 0;
  }
  const place = race.finalResults().findIndex((s) => s.racer.isPlayer) + 1;
  const kind: RaceEnd = race.player.finishTime !== null ? 'finished' : race.phase === 'busted' ? 'busted' : race.phase === 'wrecked' ? 'wrecked' : 'quit';
  return { kind, place };
}

/** Spend on the best bike we can afford while keeping a cushion for fines and repairs. */
function shop(c: Career) {
  const reserve = levelDef(c.s.level).fine * 2;
  const line = SHOP_BIKES.filter((b) => !['mudcat', 'vandal'].includes(b.id));
  const mine = line.findIndex((b) => b.id === c.s.bike);
  for (let i = line.length - 1; i > mine; i--) {
    const cost = line[i].price - tradeInValue(c.bike);
    if (c.s.money - cost >= reserve) {
      c.pay(cost);
      c.changeBike(line[i].id);
      return;
    }
  }
}

describe('full career', () => {
  it('a decent player can go from level 1 to champion without going broke', () => {
    const c = new Career(newCareer('BOT', 'normal'));
    const log: string[] = [];
    let races = 0, champion = false;
    while (races < 90) {
      shop(c);
      for (let t = 0; t < TRACKS.length; t++) {
        if (c.s.qualified[t]) continue;
        const { kind, place } = runRace(c, t);
        const r = c.settle(kind, place, t);
        races++;
        log.push(`L${c.s.level} ${TRACKS[t].id} ${kind} ${place} $${c.s.money} ${c.bike.id}`);
        expect(r.solvent, log.join('\n')).toBe(true);
        // the password always round-trips the career mid-game
        expect(decodePassword(encodePassword(c.s))?.money).toBe(Math.round(c.s.money / 10) * 10);
      }
      if (c.levelComplete) {
        if (c.s.level === LEVEL_COUNT) {
          champion = true;
          break;
        }
        c.advanceLevel();
      }
    }
    console.log(`champion after ${races} races, ${c.s.wins} wins, $${c.s.money}, riding ${c.bike.name}`);
    expect(champion, log.join('\n')).toBe(true);
    expect(races).toBeLessThan(60);
  }, 120_000);
});
