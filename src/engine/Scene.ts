import type { Game } from './Game';

/** Base class for every screen. Scenes are created fresh each time they're entered. */
export abstract class Scene {
  /** seconds since the scene was entered */
  time = 0;
  constructor(protected game: Game) {}
  enter(): void {}
  exit(): void {}
  /** The tab was hidden or the window lost focus (races pause themselves). */
  onHide(): void {}
  abstract update(dt: number): void;
  abstract render(ctx: CanvasRenderingContext2D): void;
}
