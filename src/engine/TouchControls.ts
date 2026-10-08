/**
 * On-screen controls for phones and tablets. They appear on the first touch (or on coarse-pointer
 * devices) and feed the same actions as the keyboard, so every scene works unchanged.
 * Multi-touch: hold GAS with one thumb while steering / punching with the other.
 */
import { HEIGHT, WIDTH } from '../config';
import type { Action, Input } from './Input';

interface Button {
  id: string;
  x: number;
  y: number;
  r: number;
  label: string;
  menuLabel?: string;
  actions: Action[];
  /** shown in menus too (otherwise race only) */
  menu?: boolean;
}

const DPAD = { x: 150, y: 470, r: 115 };

const BUTTONS: Button[] = [
  // right thumb: everything you need while riding, around the throttle
  { id: 'gas', x: 1150, y: 560, r: 62, label: 'GAS', menuLabel: 'OK', actions: ['throttle', 'confirm'], menu: true },
  { id: 'brake', x: 1030, y: 615, r: 42, label: 'BRAKE', menuLabel: 'BACK', actions: ['brake', 'back'], menu: true },
  { id: 'pl', x: 1012, y: 488, r: 42, label: 'HIT L', actions: ['attackL'] },
  { id: 'pr', x: 1105, y: 428, r: 42, label: 'HIT R', actions: ['attackR'] },
  { id: 'kick', x: 1218, y: 428, r: 38, label: 'KICK', actions: ['kick'] },
  { id: 'nitro', x: 1242, y: 664, r: 32, label: 'NOS', actions: ['nitro'] },
  // left thumb: look behind sits just above the d-pad
  { id: 'look', x: 150, y: 300, r: 38, label: 'LOOK', actions: ['lookBack'] },
  // top corner: things you rarely press
  { id: 'cam', x: 1168, y: 42, r: 26, label: 'CAM', actions: ['camera'] },
  { id: 'pause', x: 1235, y: 42, r: 26, label: 'II', actions: ['pause'] },
];

export class TouchControls {
  enabled: boolean;
  private pointers = new Map<number, Set<Action>>();

  constructor(private canvas: HTMLCanvasElement, private input: Input) {
    this.enabled = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.enabled = true;
      canvas.setPointerCapture?.(e.pointerId);
      this.track(e);
    });
    canvas.addEventListener('pointermove', (e) => this.pointers.has(e.pointerId) && this.track(e));
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.sync();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  private toLogical(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * WIDTH, y: ((e.clientY - r.top) / r.height) * HEIGHT };
  }

  private track(e: PointerEvent) {
    const { x, y } = this.toLogical(e);
    const acts = new Set<Action>();
    const dx = x - DPAD.x, dy = y - DPAD.y;
    if (Math.hypot(dx, dy) < DPAD.r * 1.3) {
      if (dx < -28) acts.add('left');
      if (dx > 28) acts.add('right');
      if (dy < -28) acts.add('up');
      if (dy > 28) acts.add('down');
    } else {
      let best: Button | null = null, bestD = Infinity;
      for (const b of BUTTONS) {
        const d = Math.hypot(x - b.x, y - b.y);
        if (d < b.r * 1.35 && d < bestD) (best = b), (bestD = d);
      }
      best?.actions.forEach((a) => acts.add(a));
    }
    this.pointers.set(e.pointerId, acts);
    this.sync();
  }

  private sync() {
    this.input.virtual.clear();
    for (const s of this.pointers.values()) for (const a of s) this.input.virtual.add(a);
  }

  render(ctx: CanvasRenderingContext2D, scene: string) {
    if (!this.enabled) return;
    if (window.innerHeight > window.innerWidth) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.font = '28px "Press Start 2P", monospace';
      ctx.fillStyle = '#ffd23a';
      ctx.textAlign = 'center';
      ctx.fillText('TURN YOUR DEVICE SIDEWAYS', WIDTH / 2, HEIGHT / 2);
      return;
    }
    const racing = scene === 'race';
    const held = this.input.virtual;
    ctx.save();
    ctx.globalAlpha = 0.55;
    // d-pad
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(DPAD.x, DPAD.y, DPAD.r, 0, Math.PI * 2);
    ctx.fill();
    const arrows: [Action, number, number, string][] = [
      ['left', -70, 0, '◀'],
      ['right', 70, 0, '▶'],
      ['up', 0, -70, '▲'],
      ['down', 0, 70, '▼'],
    ];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [a, ox, oy, glyph] of arrows) {
      ctx.fillStyle = held.has(a) ? '#ffd23a' : '#f4f1e8';
      ctx.font = '34px sans-serif';
      ctx.fillText(glyph, DPAD.x + ox, DPAD.y + oy);
    }
    for (const b of BUTTONS) {
      if (!racing && !b.menu && b.id !== 'pause') continue;
      if (!racing && b.id === 'pause') continue;
      const on = b.actions.some((a) => held.has(a));
      ctx.fillStyle = on ? 'rgba(255,210,58,0.85)' : b.id === 'gas' ? 'rgba(78,224,106,0.55)' : b.id === 'nitro' ? 'rgba(58,140,255,0.6)' : 'rgba(224,48,42,0.55)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `${b.r > 50 ? 16 : b.r < 30 ? 9 : 11}px "Press Start 2P", monospace`;
      ctx.fillText(racing ? b.label : b.menuLabel ?? b.label, b.x, b.y + 1);
    }
    ctx.restore();
  }
}
