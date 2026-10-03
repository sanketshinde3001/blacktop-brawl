/**
 * Owns the canvas, main loop, scene switching (with fades) and the shared services every scene
 * uses: input, assets, audio, options and the career.
 */
import { HEIGHT, WIDTH } from '../config';
import { Career } from '../game/Career';
import { RecordStore, Storage, type Options, type Records } from '../game/Storage';
import type { RunState } from '../game/Runs';
import { EventBus } from '../game/Events';
import { Assets } from './Assets';
import { AudioManager } from './Audio';
import { Input } from './Input';
import { TouchControls } from './TouchControls';
import type { Scene } from './Scene';

export type SceneFactory = (game: Game, params: any) => Scene;

export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly input: Input;
  readonly touch: TouchControls;
  readonly assets: Assets;
  readonly audio: AudioManager;
  options: Options;
  career: Career | null = null;
  /** the endless / daily run in progress, if any */
  run: RunState | null = null;
  /** personal bests, achievements, stats */
  records: Records = RecordStore.load();
  /** game-wide events (achievements and stats listen here) */
  readonly events = new EventBus();
  /** drawn over every scene (achievement toasts) */
  readonly overlays: ((ctx: CanvasRenderingContext2D, dt: number) => void)[] = [];
  debug = false;
  /** dev server build: debug overlay, cheat keys and URL scene jumps are only allowed here */
  readonly dev = import.meta.env.DEV;
  fps = 60;
  private crashes = 0;
  private crashNote = '';
  private crashNoteT = 0;

  private scene: Scene | null = null;
  private registry = new Map<string, SceneFactory>();
  private pending: { name: string; params: any } | null = null;
  private fade = 0; // 0 = clear, 1 = black
  private fadeDir = 0;
  private last = 0;
  private scale = 1;
  sceneName = '';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.input = new Input();
    this.touch = new TouchControls(canvas, this.input);
    this.assets = new Assets();
    this.audio = new AudioManager(this.assets);
    this.options = Storage.loadOptions();
    this.audio.setVolumes(this.options.musicVolume, this.options.sfxVolume);
    this.input.onFirstGesture = () => this.audio.unlock();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    // Pause races and silence everything when the tab is hidden; resume audio on return.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.scene?.onHide();
        this.audio.ctx.suspend().catch(() => {});
      } else this.audio.unlock();
    });
    window.addEventListener('blur', () => this.scene?.onHide());
    (window as any).__game = this; // handy for poking at state from the dev console
  }

  register(name: string, factory: SceneFactory) {
    this.registry.set(name, factory);
  }

  /** Switch scenes with a quick fade through black. */
  go(name: string, params: any = {}, instant = false) {
    if (!this.registry.has(name)) throw new Error(`Unknown scene ${name}`);
    if (instant || !this.scene) {
      this.swap(name, params);
      return;
    }
    this.pending = { name, params };
    this.fadeDir = 1;
  }

  private swap(name: string, params: any) {
    this.scene?.exit();
    this.scene = this.registry.get(name)!(this, params);
    this.sceneName = name;
    this.scene.enter();
  }

  saveOptions() {
    Storage.saveOptions(this.options);
    this.audio.setVolumes(this.options.musicVolume, this.options.sfxVolume);
  }

  saveRecords() {
    RecordStore.save(this.records);
  }

  saveCareer() {
    Storage.saveCareer(this.career?.s ?? null);
  }

  /**
   * Main loop. Frame times are smoothed: browsers deliver rAF callbacks with a few ms of jitter,
   * and feeding that raw into the simulation makes motion look uneven even at a steady 60 fps.
   */
  start() {
    let smoothDt = 1 / 60;
    const frame = (t: number) => {
      const raw = Math.min(1 / 20, Math.max(0, (t - (this.last || t)) / 1000));
      this.last = t;
      // snap on real rate changes (tab switch, 120 Hz screens), otherwise ease toward the new value
      smoothDt = Math.abs(raw - smoothDt) > smoothDt * 0.5 ? raw : smoothDt + (raw - smoothDt) * 0.1;
      const dt = Math.min(1 / 30, smoothDt);
      if (raw > 0) this.fps = this.fps * 0.95 + (1 / raw) * 0.05;
      if (dt > 0) this.tick(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private tick(dt: number) {
    try {
      this.step(dt);
    } catch (e) {
      this.recover(e);
    }
  }

  /**
   * Last line of defence: if a scene throws, log it, tell the player, and fall back to the title
   * screen (or reload if even that keeps failing) instead of freezing on a dead frame.
   */
  private recover(e: unknown) {
    console.error('[game] scene crashed', e);
    this.crashes++;
    if (this.crashes > 3) {
      location.reload();
      return;
    }
    this.crashNote = 'SOMETHING WENT WRONG - BACK TO THE TITLE SCREEN';
    this.crashNoteT = 3;
    this.pending = null;
    this.fade = 0;
    this.fadeDir = 0;
    try {
      this.swap('title', {});
    } catch {
      location.reload();
    }
  }

  private step(dt: number) {
    this.input.poll();
    if (this.dev && this.input.pressed('debug')) this.debug = !this.debug;

    if (this.fadeDir !== 0) {
      this.fade += this.fadeDir * dt * 4;
      if (this.fade >= 1 && this.fadeDir > 0) {
        this.fade = 1;
        if (this.pending) this.swap(this.pending.name, this.pending.params);
        this.pending = null;
        this.fadeDir = -1;
      } else if (this.fade <= 0 && this.fadeDir < 0) {
        this.fade = 0;
        this.fadeDir = 0;
      }
    }
    if (this.scene && !this.pending) {
      this.scene.time += dt;
      this.scene.update(dt);
    }
    this.input.endFrame();

    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    this.scene?.render(ctx);
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.fade})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    this.touch.render(ctx, this.sceneName);
    for (const o of this.overlays) o(ctx, dt);
    if (this.crashNoteT > 0) {
      this.crashNoteT -= dt;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, HEIGHT / 2 - 30, WIDTH, 60);
      ctx.font = '16px "Press Start 2P", monospace';
      ctx.fillStyle = '#ffd23a';
      ctx.textAlign = 'center';
      ctx.fillText(this.crashNote, WIDTH / 2, HEIGHT / 2 + 8);
    }
    if (this.options.showFps || this.debug) {
      ctx.font = '12px monospace';
      ctx.fillStyle = '#0f0';
      ctx.textAlign = 'right';
      ctx.fillText(`${this.fps.toFixed(0)} fps  ${this.sceneName}`, WIDTH - 8, 14);
    }
  }

  /** Letterboxed 16:9 canvas, rendered at device resolution for crisp text. */
  private resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const cssScale = Math.min(vw / WIDTH, vh / HEIGHT);
    const cssW = Math.floor(WIDTH * cssScale), cssH = Math.floor(HEIGHT * cssScale);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    // Cap the backing store: past ~1920 wide the extra pixels cost frame rate, not sharpness.
    const backingW = Math.min(Math.round(cssW * dpr), 1920);
    this.canvas.width = backingW;
    this.canvas.height = Math.round((backingW * HEIGHT) / WIDTH);
    this.scale = this.canvas.width / WIDTH;
  }
}
