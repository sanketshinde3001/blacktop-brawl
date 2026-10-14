/**
 * Headless race simulator for balancing. By default the player's bike is ridden by a human-like
 * bot (same controls and physics as you, with reaction delays), so the results say roughly where
 * an average player would finish.
 *
 *   npm run sim -- [track|all] [level] [races] [--demo] [--difficulty easy|normal|hard]
 *   npm run sim -- all 1 3
 */
import { QUALIFY_PLACE } from '../src/config';
import { bikeById } from '../src/data/bikes';
import { levelDef, type Difficulty } from '../src/data/levels';
import { TRACKS, trackById } from '../src/data/tracks';
import { formatTime } from '../src/engine/math';
import { botControls } from '../src/race/Bot';
import { NO_CONTROLS, Race } from '../src/race/Race';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const diffIdx = argv.indexOf('--difficulty');
const difficulty = (diffIdx >= 0 ? argv[diffIdx + 1] : 'normal') as Difficulty;
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--difficulty');
const [trackArg = 'all', levelArg = '1', racesArg = '2'] = positional;
const tracks = trackArg === 'all' ? TRACKS.map((t) => t.id) : [trackArg];
const level = Number(levelArg);
const demo = flags.has('--demo');
/** the bike a player can typically afford at each level */
const bikeFor = ['straycat', 'jackal', 'raptor', 'inferno', 'tempest'][level - 1];

const totals: Record<string, number> = {};
const places: number[] = [];
for (const id of tracks) {
  for (let n = 0; n < Number(racesArg); n++) {
    const race = new Race({ track: trackById(id), level: levelDef(level), bike: bikeById(bikeFor), difficulty, playerName: 'SIM', demo, aspect: () => 0.6 });
    const crashes: Record<string, number> = {};
    let hits = 0, kos = 0, busts = 0, playerHits = 0, steps = 0;
    const dt = 1 / 60;
    while (race.phase !== 'over' && steps < 60 * 60 * 8) {
      race.update(dt, demo ? NO_CONTROLS : botControls(race));
      for (const e of race.events) {
        if (e.type === 'crash') {
          const key = `${e.cause}${e.racer.isPlayer ? '(P)' : ''}`;
          crashes[key] = (crashes[key] ?? 0) + 1;
          totals[key] = (totals[key] ?? 0) + 1;
        }
        if (e.type === 'hit') {
          hits++;
          if (e.hit.target.isPlayer) playerHits++;
          if (e.hit.knockedOff) kos++;
        }
        if (e.type === 'bust') busts++;
      }
      race.events.length = 0;
      steps++;
    }
    const res = race.finalResults();
    const place = res.findIndex((s) => s.racer.isPlayer) + 1;
    places.push(race.phase === 'busted' || race.player.finishTime === null ? 16 : place);
    const top = res.slice(0, 4).map((s) => `${s.racer.name}${s.finished ? '' : '*'} ${isFinite(s.time) ? formatTime(s.time) : 'DNF'}`);
    console.log(
      `${id.padEnd(8)} L${level} #${n + 1}  ${formatTime(race.time)}  player ${place} (${race.player.finishTime !== null ? 'finished' : race.phase})  hits ${hits} (on player ${playerHits}) KOs ${kos} busts ${busts}\n   crashes ${JSON.stringify(crashes)}\n   top4 ${top.join(' | ')}`,
    );
  }
}
const qualified = places.filter((p) => p <= QUALIFY_PLACE).length;
console.log(`\nPlayer (${demo ? 'demo AI' : 'bot'}, ${difficulty}) places: ${places.join(' ')}  -> qualified ${qualified}/${places.length}`);
console.log('Crashes by cause', totals);
