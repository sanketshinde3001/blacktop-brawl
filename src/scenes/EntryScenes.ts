/** Text-entry screens: new-game name entry and password entry. */
import { HEIGHT, WIDTH } from '../config';
import { Career, newCareer } from '../game/Career';
import { decodePassword } from '../game/Password';
import type { Game } from '../engine/Game';
import { Scene } from '../engine/Scene';
import type { Difficulty } from '../data/levels';
import { blink, COLORS, cover, panel, text, vignette } from '../ui/draw';
import { Menu } from '../ui/Menu';
import { startRun } from './RunScenes';

abstract class TextEntryScene extends Scene {
  value = '';
  error = '';
  errorT = 0;
  abstract maxLen: number;
  abstract allowed: RegExp;
  abstract title: string;
  abstract hint: string;
  abstract submit(): void;

  update(dt: number) {
    const input = this.game.input;
    for (const ch of input.typed) {
      if (ch === '\b') this.value = this.value.slice(0, -1);
      else if (this.allowed.test(ch) && this.value.length < this.maxLen) {
        this.value += ch.toUpperCase();
        this.game.audio.blip(600 + this.value.length * 40, 0.03);
      }
    }
    this.errorT = Math.max(0, this.errorT - dt);
    // Touch devices have no keyboard on the canvas: ask with the native text box instead.
    if (this.game.touch.enabled && input.pressed('confirm') && !this.value) {
      const v = window.prompt(this.title, '') ?? '';
      this.value = v.toUpperCase().split('').filter((c) => this.allowed.test(c)).join('').slice(0, this.maxLen);
      if (this.value) this.submit();
      return;
    }
    // Space also maps to "confirm"; only Enter (no space typed) submits.
    if (input.pressed('confirm') && !input.typed.includes(' ')) this.submit();
    if (input.keyPressed('Escape') || (this.game.touch.enabled && input.pressed('back'))) this.game.go('menu');
  }

  render(ctx: CanvasRenderingContext2D) {
    cover(ctx, this.game.assets.get('ui/lounge'), 0.5);
    vignette(ctx, 0.8);
    panel(ctx, WIDTH / 2 - 380, 180, 760, 340);
    text(ctx, this.title, WIDTH / 2, 260, { size: 60, font: 'title', align: 'center', color: COLORS.yellow });
    const shown = this.value + (blink(this.time, 2) && this.value.length < this.maxLen ? '_' : ' ');
    ctx.fillStyle = '#000';
    ctx.fillRect(WIDTH / 2 - 300, 310, 600, 70);
    text(ctx, shown, WIDTH / 2, 360, { size: 30, align: 'center', color: COLORS.white });
    text(ctx, this.hint, WIDTH / 2, 430, { size: 11, align: 'center', color: '#aaa' });
    text(ctx, this.game.touch.enabled ? 'TAP OK TO TYPE' : 'ENTER = OK      ESC = BACK', WIDTH / 2, 480, { size: 10, align: 'center', color: '#777' });
    if (this.errorT > 0) text(ctx, this.error, WIDTH / 2, HEIGHT - 120, { size: 16, align: 'center', color: COLORS.red, outline: 4 });
  }
}

export class NameScene extends TextEntryScene {
  maxLen = 8;
  allowed = /^[a-zA-Z0-9 ]$/;
  title = 'WHAT DO THEY CALL YOU?';
  hint = 'TYPE YOUR NAME (UP TO 8 LETTERS)';
  constructor(game: Game) {
    super(game);
    this.value = '';
  }
  submit() {
    this.game.go('difficulty', { name: this.value.trim() || 'RIDER' });
  }
}

export class PasswordScene extends TextEntryScene {
  maxLen = 11;
  allowed = /^[a-zA-Z0-9]$/;
  title = 'ENTER PASSWORD';
  hint = '11 CHARACTERS (OLD 9-CHARACTER ONES WORK TOO)';
  submit() {
    const s = decodePassword(this.value, this.game.career?.s.name ?? 'RIDER');
    if (!s) {
      this.error = 'INVALID PASSWORD';
      this.errorT = 2;
      this.game.audio.blip(160, 0.3, 'sawtooth');
      return;
    }
    this.game.career = new Career(s);
    this.game.saveCareer();
    this.game.audio.play('sfx/cash');
    this.game.go('levels');
  }
}

/** New game, step 2: pick how rough the other rashers are. */
export class DifficultyScene extends Scene {
  private menu: Menu;
  private static readonly INFO: Record<Difficulty, string> = {
    easy: 'Slower rivals who rarely pick fights. Just enjoy the ride.',
    normal: 'The classic experience. Ride clean and you will win.',
    hard: 'Rivals as fast as your bike and itching for a brawl.',
  };
  constructor(game: Game, private params: { name: string }) {
    super(game);
    const pick = (d: Difficulty) => () => {
      this.game.options.difficulty = d;
      this.game.saveOptions();
      this.game.career = new Career(newCareer(this.params.name, d));
      this.game.saveCareer();
      this.game.go('levels');
    };
    this.menu = new Menu(
      [
        { label: 'EASY', onSelect: pick('easy') },
        { label: 'NORMAL', onSelect: pick('normal') },
        { label: 'HARD', onSelect: pick('hard') },
      ],
      game,
    );
    this.menu.index = ['easy', 'normal', 'hard'].indexOf(game.options.difficulty);
  }
  update() {
    this.menu.update();
    if (this.game.input.keyPressed('Escape')) this.game.go('name');
  }
  render(ctx: CanvasRenderingContext2D) {
    cover(ctx, this.game.assets.get('ui/lounge'), 0.5);
    vignette(ctx, 0.8);
    panel(ctx, WIDTH / 2 - 380, 150, 760, 400);
    text(ctx, 'HOW TOUGH ARE YOU?', WIDTH / 2, 230, { size: 60, font: 'title', align: 'center', color: COLORS.yellow });
    this.menu.render(ctx, WIDTH / 2, 310, { time: this.time, spacing: 56, size: 22 });
    const d = (['easy', 'normal', 'hard'] as Difficulty[])[this.menu.index];
    text(ctx, DifficultyScene.INFO[d], WIDTH / 2, 500, { size: 11, align: 'center', color: '#ccc' });
  }
}

/** Name for endless / daily runs and the leaderboards (asked once, then remembered). */
export class RunNameScene extends TextEntryScene {
  maxLen = 8;
  allowed = /^[a-zA-Z0-9 ]$/;
  title = 'NAME FOR THE BOARDS';
  hint = 'UP TO 8 LETTERS - SHOWN ON THE SCOREBOARDS';
  constructor(game: Game, private params: { mode: 'endless' | 'daily' }) {
    super(game);
    this.value = game.records.name || game.career?.s.name || '';
  }
  submit() {
    const name = this.value.trim() || 'RIDER';
    this.game.records.name = name;
    this.game.saveRecords();
    startRun(this.game, this.params.mode);
  }
}
