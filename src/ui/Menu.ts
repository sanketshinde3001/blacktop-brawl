/** Vertical menu with keyboard / gamepad navigation. Items can be disabled or show a value. */
import type { Game } from '../engine/Game';
import { COLORS, text } from './draw';

export interface MenuItem {
  label: string;
  /** optional value shown on the right, e.g. "80%" */
  value?: () => string;
  disabled?: () => boolean;
  onSelect?: () => void;
  /** left/right adjust (for options) */
  onAdjust?: (dir: -1 | 1) => void;
}

export class Menu {
  index = 0;
  constructor(public items: MenuItem[], private game: Game) {
    this.skipDisabled(1);
  }

  private skipDisabled(dir: 1 | -1) {
    for (let i = 0; i < this.items.length && this.items[this.index]?.disabled?.(); i++) {
      this.index = (this.index + dir + this.items.length) % this.items.length;
    }
  }

  update() {
    const input = this.game.input;
    const move = (dir: 1 | -1) => {
      this.index = (this.index + dir + this.items.length) % this.items.length;
      this.skipDisabled(dir);
      this.game.audio.blip(520, 0.05);
    };
    if (input.pressed('up')) move(-1);
    if (input.pressed('down')) move(1);
    const item = this.items[this.index];
    if (item?.onAdjust) {
      if (input.pressed('left')) (item.onAdjust(-1), this.game.audio.blip(440, 0.04));
      if (input.pressed('right')) (item.onAdjust(1), this.game.audio.blip(660, 0.04));
    }
    if (input.pressed('confirm') && item && !item.disabled?.()) {
      this.game.audio.blip(880, 0.08);
      item.onSelect?.();
    }
  }

  render(ctx: CanvasRenderingContext2D, x: number, y: number, opts: { spacing?: number; size?: number; align?: CanvasTextAlign; width?: number; time?: number } = {}) {
    const spacing = opts.spacing ?? 44;
    const size = opts.size ?? 18;
    const align = opts.align ?? 'center';
    this.items.forEach((item, i) => {
      const sel = i === this.index;
      const disabled = item.disabled?.();
      const yy = y + i * spacing;
      const color = disabled ? '#666' : sel ? COLORS.yellow : COLORS.white;
      const label = item.value ? `${item.label}` : item.label;
      if (item.value && opts.width) {
        text(ctx, label, x - opts.width / 2, yy, { size, color, align: 'left' });
        text(ctx, item.value(), x + opts.width / 2, yy, { size, color, align: 'right' });
      } else {
        text(ctx, label, x, yy, { size, color, align });
      }
      if (sel && !disabled) {
        const w = opts.width ? opts.width / 2 + 34 : ctx.measureText(label).width / (align === 'center' ? 2 : 1) + 34;
        const bob = Math.sin((opts.time ?? 0) * 8) * 3;
        const lx = align === 'left' ? x - 34 : x - w;
        text(ctx, '▶', lx + bob, yy, { size, color: COLORS.red, align: 'left' });
      }
    });
  }
}
