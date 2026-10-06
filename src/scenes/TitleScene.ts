/** Title screen: key art, logo slam, "press start". Idle for a while and it plays a demo race. */
import { GAME_SUBTITLE, GAME_TITLE, HEIGHT, WIDTH } from '../config';
import { TRACKS } from '../data/tracks';
import { randPick } from '../engine/Rng';
import { Scene } from '../engine/Scene';
import { blink, COLORS, cover, text, titleLogo, vignette } from '../ui/draw';

export class TitleScene extends Scene {
  private slammed = false;

  enter() {
    this.game.audio.playMusic('music/title');
  }

  update() {
    const t = this.time;
    if (!this.slammed && t > 0.9) {
      this.slammed = true;
      this.game.audio.play('sfx/crash', { volume: 0.5, rate: 1.4 });
      if (this.game.options.voice) this.game.audio.voice('voice/title');
    }
    if (t > 0.5 && (this.game.input.pressed('confirm') || this.game.input.anyKeyPressed)) {
      this.game.audio.blip(880, 0.1);
      this.game.go('menu');
    }
    if (t > 28) this.game.go('race', { track: randPick(TRACKS).id, demo: true });
  }

  render(ctx: CanvasRenderingContext2D) {
    const t = this.time;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // zoomed + nudged down so the bottom strip of the key art is cropped off
    cover(ctx, this.game.assets.get('ui/title'), Math.min(1, t * 1.5), 1.26 - Math.min(0.03, t * 0.002), Math.sin(t * 0.15) * 20, 40);
    vignette(ctx, 0.7);

    // logo drops in and slams
    const logo = titleLogo(this.game.assets);
    const k = Math.min(1, Math.max(0, (t - 0.4) / 0.5));
    const ease = 1 - Math.pow(1 - k, 3);
    const shake = t > 0.9 && t < 1.2 ? Math.sin(t * 90) * 6 : 0;
    let logoBottom = 210;
    if (!logo.placeholder) {
      const w = 820, h = (w * logo.h) / logo.w;
      logoBottom = 40 + h;
      const scale = 1.8 - 0.8 * ease;
      ctx.globalAlpha = ease;
      ctx.drawImage(logo.img, WIDTH / 2 - (w * scale) / 2 + shake, 40 + shake + (1 - ease) * -80, w * scale, h * scale);
      ctx.globalAlpha = 1;
    } else {
      text(ctx, GAME_TITLE, WIDTH / 2, 190, { size: 140, font: 'title', align: 'center', color: COLORS.red, outline: 12 });
    }
    if (t > 1.2) {
      text(ctx, GAME_SUBTITLE, WIDTH / 2, logoBottom + 34, { size: 16, align: 'center', color: COLORS.yellow, outline: 6 });
      if (blink(t, 1.2)) text(ctx, 'PRESS START', WIDTH / 2, 640, { size: 28, align: 'center', color: COLORS.white, outline: 6 });
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, HEIGHT - 34, WIDTH, 34);
      text(ctx, 'INDEPENDENT FAN-MADE GAME  -  ART BY GEMINI + QWEN  -  SOUND MADE IN CODE', WIDTH / 2, HEIGHT - 12, { size: 9, align: 'center', color: '#bbb' });
    }
  }
}
