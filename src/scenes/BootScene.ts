/** Loads fonts, the asset manifest, images and sounds, then waits for a key (browsers need a gesture for audio). */
import { GAME_TITLE, HEIGHT, WIDTH } from '../config';
import { Scene } from '../engine/Scene';
import { bar, blink, COLORS, text } from '../ui/draw';

export class BootScene extends Scene {
  private progress = 0;
  private status = 'LOADING';
  private ready = false;

  enter() {
    this.load();
  }

  private async load() {
    const g = this.game;
    try {
      await Promise.all([document.fonts.load('16px "Press Start 2P"'), document.fonts.load('40px Bangers')]).catch(() => {});
      this.status = 'READING MANIFEST';
      await g.assets.loadManifest();
      this.status = 'LOADING ART';
      await g.assets.loadImages((p) => (this.progress = p * 0.8));
      const derived = g.assets.deriveMissing();
      if (derived.length) console.info(`[assets] derived ${derived.length} missing frames`, derived);
      this.status = 'LOADING SOUND';
      await g.audio.loadBuffers((p) => (this.progress = 0.8 + p * 0.2));
    } catch (e) {
      console.error(e);
    }
    this.progress = 1;
    this.ready = true;
    this.status = 'READY';
  }

  update() {
    // If the player already clicked/pressed during loading, audio is unlocked: carry straight on.
    const unlocked = this.game.audio.ctx.state === 'running';
    if (this.ready && (this.game.input.anyKeyPressed || (unlocked && this.time > 0.5))) {
      this.game.audio.unlock();
      const next = (this.game as any).bootTarget as (() => void) | undefined;
      if (next) next();
      else this.game.go('title');
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#07060a';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    text(ctx, GAME_TITLE, WIDTH / 2, 300, { size: 96, font: 'title', align: 'center', color: COLORS.red, outline: 10 });
    bar(ctx, WIDTH / 2 - 250, 380, 500, 22, this.progress, COLORS.yellow);
    if (!this.ready) text(ctx, this.status, WIDTH / 2, 450, { size: 14, align: 'center', color: '#888' });
    else if (blink(this.time)) text(ctx, 'PRESS ANY KEY', WIDTH / 2, 460, { size: 20, align: 'center', color: COLORS.white });
    text(ctx, 'Best with sound on. Keyboard or gamepad.', WIDTH / 2, HEIGHT - 40, { size: 10, align: 'center', color: '#555' });
  }
}
