/** Main menu: new game, continue (autosave), password, options, controls, credits. */
import { GAME_TITLE, HEIGHT, WIDTH } from '../config';
import { Career } from '../game/Career';
import { Storage } from '../game/Storage';
import type { Game } from '../engine/Game';
import { Scene } from '../engine/Scene';
import { COLORS, cover, panel, text, titleLogo, vignette } from '../ui/draw';
import { Menu } from '../ui/Menu';
import { startRun } from './RunScenes';

export class MenuScene extends Scene {
  private menu: Menu;
  private saved = Storage.loadCareer();

  constructor(game: Game) {
    super(game);
    this.menu = new Menu(
      [
        { label: 'NEW GAME', onSelect: () => this.game.go('name') },
        {
          label: 'CONTINUE',
          disabled: () => !this.saved,
          onSelect: () => {
            this.game.career = new Career(this.saved!);
            this.game.go('levels');
          },
        },
        { label: 'ENDLESS RUN', onSelect: () => startRun(this.game, 'endless') },
        { label: 'DAILY CHALLENGE', onSelect: () => startRun(this.game, 'daily') },
        { label: '2 PLAYERS', onSelect: () => this.game.go('versus') },
        { label: 'RECORDS', onSelect: () => this.game.go('records') },
        { label: 'ENTER PASSWORD', onSelect: () => this.game.go('password') },
        { label: 'OPTIONS', onSelect: () => this.game.go('options', { back: 'menu' }) },
        { label: 'CONTROLS', onSelect: () => this.game.go('controls', { back: 'menu' }) },
        { label: 'CREDITS', onSelect: () => this.game.go('credits', { back: 'menu' }) },
      ],
      game,
    );
    if (this.saved) this.menu.index = 1;
  }

  enter() {
    this.game.audio.playMusic('music/title');
  }

  update() {
    this.menu.update();
    if (this.game.input.pressed('back')) this.game.go('title');
  }

  render(ctx: CanvasRenderingContext2D) {
    cover(ctx, this.game.assets.get('ui/title'), 0.55, 1.26, 0, 40);
    vignette(ctx, 0.8);
    const logo = titleLogo(this.game.assets);
    if (!logo.placeholder) {
      const w = 560, h = (w * logo.h) / logo.w;
      ctx.drawImage(logo.img, WIDTH / 2 - w / 2, 20, w, h);
    } else text(ctx, GAME_TITLE, WIDTH / 2, 150, { size: 100, font: 'title', align: 'center', color: COLORS.red, outline: 10 });
    const n = this.menu.items.length;
    const spacing = n > 7 ? 36 : 44;
    const h = n * spacing + 50;
    const top = Math.min(290, HEIGHT - 70 - h);
    panel(ctx, WIDTH / 2 - 250, top, 500, h);
    this.menu.render(ctx, WIDTH / 2, top + 50, { time: this.time, spacing, size: n > 7 ? 16 : 18 });
    if (this.saved) {
      const s = this.saved;
      text(ctx, `SAVE: ${s.name}  LEVEL ${s.level}  $${s.money.toLocaleString()}`, WIDTH / 2, HEIGHT - 40, { size: 10, align: 'center', color: '#aaa' });
    }
  }
}
