/** Shared 2D drawing helpers for menus and the HUD. All coordinates are in the 1280x720 logical space. */
import { GAME_TITLE, HEIGHT, LOGO_ART_TITLE, WIDTH } from '../config';
import type { Assets, Sprite } from '../engine/Assets';

export const FONT_BODY = '"Press Start 2P", monospace';
export const FONT_TITLE = 'Bangers, Impact, sans-serif';

export const COLORS = {
  red: '#e0302a',
  darkRed: '#7a1210',
  yellow: '#ffd23a',
  orange: '#ff8a1f',
  white: '#f4f1e8',
  grey: '#9a9a9a',
  green: '#4ee06a',
  blue: '#3aa0ff',
  panel: 'rgba(10,8,12,0.78)',
  ink: '#0b0a0c',
};

export interface TextOpts {
  size?: number;
  font?: 'body' | 'title';
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  outline?: number;
  outlineColor?: string;
  shadow?: boolean;
  maxWidth?: number;
}

export function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, o: TextOpts = {}) {
  const size = o.size ?? 16;
  ctx.font = `${size}px ${o.font === 'title' ? FONT_TITLE : FONT_BODY}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  if (o.shadow !== false) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(str, x + Math.max(2, size / 10), y + Math.max(2, size / 10), o.maxWidth);
  }
  if (o.outline) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.outline;
    ctx.strokeStyle = o.outlineColor ?? COLORS.ink;
    ctx.strokeText(str, x, y, o.maxWidth);
  }
  ctx.fillStyle = o.color ?? COLORS.white;
  ctx.fillText(str, x, y, o.maxWidth);
}

/** Word-wraps text into lines that fit maxWidth. */
export function wrap(ctx: CanvasRenderingContext2D, str: string, maxWidth: number, size: number, font: 'body' | 'title' = 'body'): string[] {
  ctx.font = `${size}px ${font === 'title' ? FONT_TITLE : FONT_BODY}`;
  const lines: string[] = [];
  for (const para of str.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, border = COLORS.red, fill = COLORS.panel) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 3;
  ctx.strokeStyle = border;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.strokeRect(x + 6.5, y + 6.5, w - 13, h - 13);
}

export function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string, back = '#221c1c') {
  ctx.fillStyle = back;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y + 2, Math.max(0, (w - 4) * Math.min(1, Math.max(0, frac))), h - 4);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

/** Draws an image scaled to cover the whole screen (cropping as needed). */
export function cover(ctx: CanvasRenderingContext2D, s: Sprite, alpha = 1, zoom = 1, panX = 0, panY = 0) {
  const scale = Math.max(WIDTH / s.w, HEIGHT / s.h) * zoom;
  const w = s.w * scale, h = s.h * scale;
  ctx.globalAlpha = alpha;
  ctx.drawImage(s.img, (WIDTH - w) / 2 + panX, (HEIGHT - h) / 2 + panY, w, h);
  ctx.globalAlpha = 1;
}

export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, w: number, h?: number) {
  const hh = h ?? (w * s.h) / s.w;
  ctx.drawImage(s.img, x, y, w, hh);
}

export function vignette(ctx: CanvasRenderingContext2D, strength = 0.6) {
  const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.3, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.9);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

/** Portrait inside a chunky frame. */
export function portrait(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, size: number, border = COLORS.yellow) {
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 6, y - 6, size + 12, size + 12);
  ctx.drawImage(s.img, x, y, size, size);
  ctx.lineWidth = 4;
  ctx.strokeStyle = border;
  ctx.strokeRect(x - 4, y - 4, size + 8, size + 8);
}

/** Speech-bubble style dialogue box with a speaker name tab. */
export function dialogue(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, speaker: string, body: string, reveal = 1) {
  const size = 16;
  const lines = wrap(ctx, body, w - 48, size);
  const h = 58 + lines.length * (size + 12);
  panel(ctx, x, y, w, h, COLORS.yellow, 'rgba(12,10,8,0.9)');
  ctx.fillStyle = COLORS.yellow;
  ctx.fillRect(x + 16, y - 16, Math.min(w - 32, speaker.length * 16 + 28), 30);
  text(ctx, speaker.toUpperCase(), x + 30, y + 6, { size: 14, color: COLORS.ink, shadow: false });
  let chars = Math.floor(body.length * reveal);
  lines.forEach((line, i) => {
    const shown = line.slice(0, Math.max(0, chars));
    chars -= line.length + 1;
    text(ctx, shown, x + 24, y + 48 + i * (size + 12), { size });
  });
  return h;
}

export function blink(time: number, rate = 2): boolean {
  return Math.floor(time * rate * 2) % 2 === 0;
}

let drawnLogo: Sprite | null = null;

/**
 * The title logo: the painted art when it matches GAME_TITLE, otherwise a chrome logo drawn from
 * the title text (so renaming the game is a one-line change).
 */
export function titleLogo(assets: Assets): Sprite {
  if (GAME_TITLE === LOGO_ART_TITLE && assets.has('ui/logo')) return assets.get('ui/logo');
  if (drawnLogo) return drawnLogo;
  const words = GAME_TITLE.toUpperCase();
  const size = 200;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = `${size}px ${FONT_TITLE}`;
  const w = Math.ceil(g.measureText(words).width) + 140;
  c.width = w;
  c.height = size + 90;
  g.font = `${size}px ${FONT_TITLE}`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  const x = w / 2, y = size + 30;
  g.setTransform(1, 0, -0.18, 1, 50, 0); // italic slant
  // red extrusion
  for (let i = 14; i > 0; i--) {
    g.fillStyle = i > 10 ? '#3a0606' : '#9c1410';
    g.fillText(words, x + i * 0.6, y + i);
  }
  g.lineWidth = 16;
  g.strokeStyle = '#0b0a0c';
  g.strokeText(words, x, y);
  const chrome = g.createLinearGradient(0, y - size * 0.85, 0, y);
  chrome.addColorStop(0, '#ffffff');
  chrome.addColorStop(0.42, '#c9ccd2');
  chrome.addColorStop(0.5, '#5d636d');
  chrome.addColorStop(0.62, '#e6e8ec');
  chrome.addColorStop(1, '#8a8f99');
  g.fillStyle = chrome;
  g.fillText(words, x, y);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(224,48,42,0.9)';
  g.strokeText(words, x, y);
  g.setTransform(1, 0, 0, 1, 0, 0);
  drawnLogo = { id: 'ui/logo-drawn', img: c, w: c.width, h: c.height, ax: c.width / 2, ay: c.height };
  return drawnLogo;
}
