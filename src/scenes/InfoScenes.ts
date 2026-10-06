/** Options, controls and credits. */
import { CAMERA_MODES, CAMERA_ORDER, GAME_TITLE, HEIGHT, WIDTH } from '../config';
import { DIFFICULTY, type Difficulty } from '../data/levels';
import type { Game } from '../engine/Game';
import { Scene } from '../engine/Scene';
import { COLORS, cover, panel, text, vignette } from '../ui/draw';
import { Menu } from '../ui/Menu';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

export class OptionsScene extends Scene {
  private menu: Menu;
  constructor(game: Game, private params: { back?: string } = {}) {
    super(game);
    const o = game.options;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const step = (v: number, d: number) => Math.round(Math.min(1, Math.max(0, v + d * 0.1)) * 10) / 10;
    this.menu = new Menu(
      [
        { label: 'MUSIC', value: () => pct(o.musicVolume), onAdjust: (d) => ((o.musicVolume = step(o.musicVolume, d)), game.saveOptions()) },
        { label: 'SOUND FX', value: () => pct(o.sfxVolume), onAdjust: (d) => ((o.sfxVolume = step(o.sfxVolume, d)), game.saveOptions(), game.audio.play('sfx/punch')) },
        { label: 'VOICES', value: () => (o.voice ? 'ON' : 'OFF'), onAdjust: () => ((o.voice = !o.voice), game.saveOptions()), onSelect: () => ((o.voice = !o.voice), game.saveOptions()) },
        {
          label: 'DIFFICULTY',
          value: () => DIFFICULTY[o.difficulty].label,
          onAdjust: (d) => {
            o.difficulty = DIFFS[(DIFFS.indexOf(o.difficulty) + d + 3) % 3];
            if (game.career) game.career.s.difficulty = o.difficulty;
            game.saveOptions();
          },
        },
        {
          label: 'CAMERA',
          value: () => CAMERA_MODES[o.camera].label.replace(' CAM', ''),
          onAdjust: (d) => ((o.camera = CAMERA_ORDER[(CAMERA_ORDER.indexOf(o.camera) + d + CAMERA_ORDER.length) % CAMERA_ORDER.length]), game.saveOptions()),
          onSelect: () => ((o.camera = CAMERA_ORDER[(CAMERA_ORDER.indexOf(o.camera) + 1) % CAMERA_ORDER.length]), game.saveOptions()),
        },
        { label: 'SHOW FPS', value: () => (o.showFps ? 'ON' : 'OFF'), onAdjust: () => ((o.showFps = !o.showFps), game.saveOptions()), onSelect: () => ((o.showFps = !o.showFps), game.saveOptions()) },
        {
          label: 'FULLSCREEN',
          value: () => (document.fullscreenElement ? 'ON' : 'OFF'),
          onSelect: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}),
        },
        { label: 'BACK', onSelect: () => this.back() },
      ],
      game,
    );
  }
  private back() {
    this.game.go(this.params.back ?? 'menu');
  }
  update() {
    this.menu.update();
    if (this.game.input.pressed('back')) this.back();
  }
  render(ctx: CanvasRenderingContext2D) {
    cover(ctx, this.game.assets.get('ui/shop'), 0.45);
    vignette(ctx, 0.8);
    panel(ctx, WIDTH / 2 - 330, 110, 660, 520);
    text(ctx, 'OPTIONS', WIDTH / 2, 180, { size: 64, font: 'title', align: 'center', color: COLORS.yellow });
    this.menu.render(ctx, WIDTH / 2, 248, { time: this.time, spacing: 43, width: 480, size: 16 });
    text(ctx, 'LEFT / RIGHT TO CHANGE', WIDTH / 2, 610, { size: 9, align: 'center', color: '#888' });
  }
}

export const CONTROLS: [string, string, string][] = [
  ['ACCELERATE / BRAKE', 'UP / DOWN', 'A or RT / B or LT'],
  ['STEER', 'LEFT / RIGHT', 'D-PAD / STICK'],
  ['HIT LEFT (FIST/WEAPON)', 'A', 'X'],
  ['KICK', 'S', 'LB / RB'],
  ['HIT RIGHT (FIST/WEAPON)', 'D', 'Y'],
  ['NITRO BOOST', 'SPACE', 'LEFT STICK CLICK'],
  ['LOOK BEHIND (HOLD)', 'Q', 'RIGHT STICK CLICK'],
  ['CAMERA: CHASE/HIGH/1ST', 'E', 'SELECT / BACK'],
  ['PAUSE', 'ESC', 'START'],
  ['ON FOOT: RUN', 'ARROWS', 'D-PAD / STICK'],
  ['DEBUG OVERLAY', '` (BACKQUOTE) / F1', ''],
];

export class ControlsScene extends Scene {
  constructor(game: Game, private params: { back?: string } = {}) {
    super(game);
  }
  update() {
    const i = this.game.input;
    if (i.pressed('back') || i.pressed('confirm')) this.game.go(this.params.back ?? 'menu');
  }
  render(ctx: CanvasRenderingContext2D) {
    cover(ctx, this.game.assets.get('ui/lounge'), 0.45);
    vignette(ctx, 0.8);
    panel(ctx, 110, 70, WIDTH - 220, 590);
    text(ctx, 'CONTROLS', WIDTH / 2, 140, { size: 64, font: 'title', align: 'center', color: COLORS.yellow });
    text(ctx, 'KEYBOARD', 700, 190, { size: 12, color: COLORS.red });
    text(ctx, 'GAMEPAD', 1000, 190, { size: 12, color: COLORS.red });
    CONTROLS.forEach(([what, kb, pad], i) => {
      const y = 232 + i * 33;
      text(ctx, what, 160, y, { size: 12, color: COLORS.yellow });
      text(ctx, kb, 700, y, { size: 12 });
      text(ctx, pad, 1000, y, { size: 12 });
    });
    text(ctx, 'Knock rivals off their bikes. Hit an armed rider mid-swing to steal the club.', WIDTH / 2, 612, { size: 9, align: 'center', color: '#aaa' });
    text(ctx, 'Crash near a cop and you get BUSTED. Wreck your bike and you pay for repairs.', WIDTH / 2, 632, { size: 9, align: 'center', color: '#aaa' });
  }
}

const CREDITS = [
  [GAME_TITLE, 'title'],
  ['16-bit motorcycle combat racing', ''],
  ['', ''],
  ['GAME CODE', 'h'],
  ['TypeScript + Vite + Canvas2D + WebAudio', ''],
  ['', ''],
  ['ART', 'h'],
  ['Generated with Google Gemini and Qwen-Image', ''],
  ['', ''],
  ['MUSIC', 'h'],
  ['A procedural rock band, played live in WebAudio', ''],
  ['', ''],
  ['SOUND FX', 'h'],
  ['Synthesised in code - no samples', ''],
  ['', ''],
  ['VOICES', 'h'],
  ["Your device's own speech engine", ''],
  ['', ''],
  ['INSPIRED BY', 'h'],
  ['The 16-bit motorcycle brawlers of the early 90s', ''],
  ['', ''],
  ['Independent fan-made game. Not affiliated with or endorsed', ''],
  ['by Electronic Arts. Road Rash is a trademark of', ''],
  ['Electronic Arts Inc.', ''],
  ['', ''],
  ['THANKS FOR PLAYING', 'h'],
];

export class CreditsScene extends Scene {
  constructor(game: Game, private params: { back?: string; ending?: boolean } = {}) {
    super(game);
  }
  enter() {
    if (this.params.ending) this.game.audio.playMusic('music/ending');
  }
  update() {
    const i = this.game.input;
    const scrollDone = this.time > CREDITS.length * 1.6 + 8;
    if ((this.time > 1 && (i.pressed('back') || i.pressed('confirm'))) || (this.params.ending && scrollDone)) this.game.go(this.params.back ?? 'menu');
  }
  render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    cover(ctx, this.game.assets.get(this.params.ending ? 'ui/victory' : 'ui/title'), 0.35);
    vignette(ctx, 0.9);
    const scroll = HEIGHT + 20 - this.time * 55;
    CREDITS.forEach(([line, kind], i) => {
      const y = scroll + i * 56;
      if (y < -60 || y > HEIGHT + 60) return;
      if (kind === 'title') text(ctx, line, WIDTH / 2, y, { size: 90, font: 'title', align: 'center', color: COLORS.red, outline: 8 });
      else if (kind === 'h') text(ctx, line, WIDTH / 2, y, { size: 16, align: 'center', color: COLORS.yellow });
      else text(ctx, line, WIDTH / 2, y, { size: 12, align: 'center' });
    });
  }
}
