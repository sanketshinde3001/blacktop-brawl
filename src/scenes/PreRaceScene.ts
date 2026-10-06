/** Before each race: a rival trash-talks you in the bar. */
import { HEIGHT, WIDTH } from '../config';
import { levelDef } from '../data/levels';
import { RIDERS } from '../data/riders';
import { trackById, TRACKS } from '../data/tracks';
import { careerWeather, WEATHER } from '../data/weather';
import type { Game } from '../engine/Game';
import { randPick } from '../engine/Rng';
import { Scene } from '../engine/Scene';
import { blink, COLORS, cover, dialogue, panel, portrait, text, vignette } from '../ui/draw';

export class PreRaceScene extends Scene {
  private rider = randPick(RIDERS);
  private line = randPick(this.rider.talk);

  constructor(game: Game, private params: { track: string }) {
    super(game);
  }

  enter() {
    this.game.audio.playMusic('music/menu');
  }

  update() {
    const i = this.game.input;
    if (this.time > 0.4 && i.pressed('confirm')) this.game.go('race', { track: this.params.track });
    if (i.pressed('back')) this.game.go('levels');
  }

  render(ctx: CanvasRenderingContext2D) {
    const c = this.game.career!;
    const t = trackById(this.params.track);
    const lv = levelDef(c.s.level);
    cover(ctx, this.game.assets.get('ui/lounge'), 1, 1.05 + Math.sin(this.time * 0.3) * 0.02);
    vignette(ctx, 0.7);
    panel(ctx, WIDTH / 2 - 360, 30, 720, 120, COLORS.yellow);
    text(ctx, t.name.toUpperCase(), WIDTH / 2, 95, { size: 54, font: 'title', align: 'center', color: COLORS.yellow });
    const wx = careerWeather(c.s.level, TRACKS.indexOf(t));
    text(ctx, `LEVEL ${c.s.level}   ${(lv.miles * t.lengthFactor).toFixed(1)} MILES   ${WEATHER[wx].label}   ${c.bike.name.toUpperCase()}`, WIDTH / 2, 130, { size: 11, align: 'center' });
    portrait(ctx, this.game.assets.get(`portraits/${this.rider.id}`), 80, 250, 300);
    dialogue(ctx, 420, 330, 780, this.rider.name, this.line, Math.min(1, this.time * 1.2));
    if (this.time > 1 && blink(this.time)) text(ctx, 'PRESS ENTER TO RACE', WIDTH / 2, HEIGHT - 40, { size: 18, align: 'center', color: COLORS.white, outline: 5 });
  }
}
