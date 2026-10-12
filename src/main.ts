/**
 * Boot. Registers every scene with the Game and starts the loop.
 *
 * URL parameters for quick debugging:
 *   ?debug=1                         debug overlay + race cheat keys (1-7)
 *   ?scene=race&track=desert&level=3 jump straight into a race after loading
 *   ?scene=shop | levels | result …  jump to any registered scene (a fresh career is created)
 */
import '@fontsource/press-start-2p';
import '@fontsource/bangers';
import { TRACKS } from './data/tracks';
import { Game } from './engine/Game';
import { Achievements } from './game/Achievements';
import { Career, newCareer } from './game/Career';
import { BootScene } from './scenes/BootScene';
import { DifficultyScene, NameScene, PasswordScene, RunNameScene } from './scenes/EntryScenes';
import { RunIntroScene, RunResultScene } from './scenes/RunScenes';
import { RecordsScene } from './scenes/RecordsScene';
import { VersusRaceScene, VersusResultScene, VersusSetupScene } from './scenes/VersusScenes';
import { ControlsScene, CreditsScene, OptionsScene } from './scenes/InfoScenes';
import { LevelSelectScene } from './scenes/LevelSelectScene';
import { MenuScene } from './scenes/MenuScene';
import { PreRaceScene } from './scenes/PreRaceScene';
import { RaceScene } from './scenes/RaceScene';
import { GameOverScene, LevelCompleteScene, ResultScene, StandingsScene, VictoryScene } from './scenes/ResultScenes';
import { ShopScene } from './scenes/ShopScene';
import { TitleScene } from './scenes/TitleScene';

const game = new Game(document.getElementById('game') as HTMLCanvasElement);
new Achievements(game);

game.register('boot', (g) => new BootScene(g));
game.register('title', (g) => new TitleScene(g));
game.register('menu', (g) => new MenuScene(g));
game.register('name', (g) => new NameScene(g));
game.register('password', (g) => new PasswordScene(g));
game.register('difficulty', (g, p) => new DifficultyScene(g, p));
game.register('options', (g, p) => new OptionsScene(g, p));
game.register('controls', (g, p) => new ControlsScene(g, p));
game.register('credits', (g, p) => new CreditsScene(g, p));
game.register('levels', (g) => new LevelSelectScene(g));
game.register('shop', (g) => new ShopScene(g));
game.register('prerace', (g, p) => new PreRaceScene(g, p));
game.register('race', (g, p) => new RaceScene(g, p));
game.register('result', (g, p) => new ResultScene(g, p));
game.register('standings', (g, p) => new StandingsScene(g, p));
game.register('levelcomplete', (g) => new LevelCompleteScene(g));
game.register('gameover', (g, p) => new GameOverScene(g, p));
game.register('victory', (g) => new VictoryScene(g));
game.register('runname', (g, p) => new RunNameScene(g, p));
game.register('runintro', (g) => new RunIntroScene(g));
game.register('runresult', (g, p) => new RunResultScene(g, p));
game.register('records', (g) => new RecordsScene(g));
game.register('versus', (g) => new VersusSetupScene(g));
game.register('versusrace', (g, p) => new VersusRaceScene(g, p));
game.register('versusresult', (g, p) => new VersusResultScene(g, p));

// Debug helpers only exist in the dev server build, never in the release.
const params = new URLSearchParams(location.search);
if (game.dev && params.has('debug')) game.debug = true;
const target = game.dev ? params.get('scene') : null;
if (!game.dev) delete (window as any).__game;
if (target) {
  (game as any).bootTarget = () => {
    const level = Number(params.get('level') ?? 1);
    if (!game.career) {
      const s = newCareer('TESTER');
      s.level = level;
      s.money = Number(params.get('money') ?? 5000);
      if (params.get('bike')) s.bike = params.get('bike')!;
      game.career = new Career(s);
    }
    const track = params.get('track') ?? TRACKS[0].id;
    game.go(target, { track, level, demo: params.has('demo') });
  };
}

game.go('boot', {}, true);
game.start();
document.getElementById('game')!.focus();
