/**
 * First-person (rider's-eye) cockpit, drawn in code with shaded materials instead of flat cartoon
 * shapes. Two styles, picked from the bike:
 *  - naked rat bikes: twin round gauges on the handlebar clamp, the tank below, bar-end mirrors
 *  - faired sport / super bikes: painted fairing, smoked windscreen and an instrument cluster
 * Both carry the race info, so the dashboard strip under the view is hidden in this mode.
 *
 * Everything that never changes (bodywork, gauge faces, ticks) is painted once into a cached layer;
 * needles, lamps, LCD text, bars, mirrors and the attacking arm are drawn every frame.
 */
import { HEIGHT, MPH, QUALIFY_PLACE, WIDTH } from '../config';
import type { BikeDef } from '../data/bikes';
import type { Assets } from '../engine/Assets';
import { clamp, formatTime, ordinal } from '../engine/math';
import { FONT_BODY } from '../ui/draw';
import type { Race } from './Race';
import type { Racer } from './Racer';

const CX = WIDTH / 2;
const B = HEIGHT;
const A0 = Math.PI * 0.75;
const A1 = Math.PI * 2.25;

interface Dial {
  x: number;
  y: number;
  r: number;
}

interface Layout {
  naked: boolean;
  speedo: Dial;
  tacho: Dial;
  lcd: { x: number; y: number; w: number; h: number };
  mirrors: { x: number; y: number; w: number; h: number; side: -1 | 1 }[];
  /** name + health plates */
  plates: { x: number; y: number; side: -1 | 1 }[];
}

const FAIRED: Layout = {
  naked: false,
  speedo: { x: 494, y: 616, r: 86 },
  tacho: { x: 786, y: 616, r: 86 },
  lcd: { x: CX, y: 604, w: 98, h: 66 },
  mirrors: [
    { x: 186, y: 452, w: 200, h: 96, side: -1 },
    { x: WIDTH - 186, y: 452, w: 200, h: 96, side: 1 },
  ],
  plates: [
    { x: 180, y: 640, side: -1 },
    { x: WIDTH - 180, y: 640, side: 1 },
  ],
};

const NAKED: Layout = {
  naked: true,
  speedo: { x: 548, y: 560, r: 74 },
  tacho: { x: 732, y: 560, r: 74 },
  lcd: { x: CX, y: 640, w: 116, h: 44 },
  mirrors: [
    { x: 150, y: 430, w: 170, h: 92, side: -1 },
    { x: WIDTH - 150, y: 430, w: 170, h: 92, side: 1 },
  ],
  plates: [
    { x: 175, y: 676, side: -1 },
    { x: WIDTH - 175, y: 676, side: 1 },
  ],
};

export interface CockpitState {
  race: Race;
  bike: BikeDef;
  time: number;
  /** horizontally flipped rear view (already a mirror image) */
  mirror: CanvasImageSource | null;
  night?: boolean;
}

// --- small colour helpers ---------------------------------------------------------------------
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(clamp(k < 0 ? c * (1 + k) : c + (255 - c) * k, 0, 255));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function chromeRing(g: CanvasRenderingContext2D, d: Dial, width: number) {
  const ring = g.createLinearGradient(d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r);
  ring.addColorStop(0, '#f4f6f9');
  ring.addColorStop(0.35, '#8a919d');
  ring.addColorStop(0.5, '#3d434d');
  ring.addColorStop(0.7, '#b9bfc8');
  ring.addColorStop(1, '#5a616c');
  g.fillStyle = ring;
  g.beginPath();
  g.arc(d.x, d.y, d.r + width, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#08090b';
  g.beginPath();
  g.arc(d.x, d.y, d.r + 1.5, 0, Math.PI * 2);
  g.fill();
}

/** White gauge face with ticks and numbers (static part). */
function gaugeFace(g: CanvasRenderingContext2D, d: Dial, max: number, step: number, red: number, label: string, unit: string) {
  chromeRing(g, d, 9);
  const face = g.createRadialGradient(d.x - d.r * 0.25, d.y - d.r * 0.35, d.r * 0.1, d.x, d.y, d.r);
  face.addColorStop(0, '#ffffff');
  face.addColorStop(0.7, '#ecebe4');
  face.addColorStop(1, '#bdbcb4');
  g.fillStyle = face;
  g.beginPath();
  g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
  g.fill();
  // red zone band
  if (red < max) {
    g.strokeStyle = '#d4231d';
    g.lineWidth = d.r * 0.09;
    g.beginPath();
    g.arc(d.x, d.y, d.r * 0.86, A0 + (A1 - A0) * (red / max), A1);
    g.stroke();
  }
  const minor = step / 2;
  for (let v = 0; v <= max + 0.001; v += minor) {
    const t = v / max, a = A0 + (A1 - A0) * t;
    const major = Math.abs(v / step - Math.round(v / step)) < 0.01;
    g.strokeStyle = v >= red ? '#b3120e' : '#17181b';
    g.lineWidth = major ? 3 : 1.4;
    const r0 = d.r * 0.92, r1 = d.r * (major ? 0.76 : 0.83);
    g.beginPath();
    g.moveTo(d.x + Math.cos(a) * r0, d.y + Math.sin(a) * r0);
    g.lineTo(d.x + Math.cos(a) * r1, d.y + Math.sin(a) * r1);
    g.stroke();
    if (major) {
      g.font = `bold ${Math.round(d.r * 0.17)}px Arial, Helvetica, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = v >= red ? '#b3120e' : '#17181b';
      g.fillText(String(Math.round(v)), d.x + Math.cos(a) * d.r * 0.6, d.y + Math.sin(a) * d.r * 0.6);
    }
  }
  g.font = `bold ${Math.round(d.r * 0.13)}px Arial, Helvetica, sans-serif`;
  g.fillStyle = '#2b2c30';
  g.textAlign = 'center';
  g.fillText(label, d.x, d.y + d.r * 0.36);
  g.font = `${Math.round(d.r * 0.1)}px Arial, Helvetica, sans-serif`;
  g.fillStyle = '#55565c';
  g.fillText(unit, d.x, d.y + d.r * 0.52);
}

// --- static layers ------------------------------------------------------------------------------
function paintFaired(g: CanvasRenderingContext2D, bike: BikeDef, L: Layout) {
  const [main, accent] = bike.paint;
  // smoked windscreen (the road shows through it)
  g.save();
  g.beginPath();
  g.moveTo(318, 560);
  g.lineTo(404, 404);
  g.quadraticCurveTo(CX, 362, WIDTH - 404, 404);
  g.lineTo(WIDTH - 318, 560);
  g.closePath();
  const ws = g.createLinearGradient(0, 370, 0, 560);
  ws.addColorStop(0, 'rgba(40,50,64,0.08)');
  ws.addColorStop(0.55, 'rgba(18,24,34,0.28)');
  ws.addColorStop(1, 'rgba(8,10,16,0.62)');
  g.fillStyle = ws;
  g.fill();
  g.clip();
  // long soft reflection
  const refl = g.createLinearGradient(380, 0, 560, 0);
  refl.addColorStop(0, 'rgba(255,255,255,0)');
  refl.addColorStop(0.5, 'rgba(255,255,255,0.10)');
  refl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = refl;
  g.beginPath();
  g.moveTo(430, 380);
  g.lineTo(520, 380);
  g.lineTo(420, 560);
  g.lineTo(330, 560);
  g.fill();
  g.restore();
  // screen edge: a dark rubber trim with a faint highlight
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(10,11,14,0.9)';
  g.beginPath();
  g.moveTo(318, 560);
  g.lineTo(404, 404);
  g.quadraticCurveTo(CX, 362, WIDTH - 404, 404);
  g.lineTo(WIDTH - 318, 560);
  g.stroke();
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.stroke();

  // painted fairing, wrapping round both sides of the cluster
  const outline = (inset: number) => {
    g.beginPath();
    g.moveTo(-10, B + 10);
    g.lineTo(-10, 586 + inset);
    g.bezierCurveTo(120, 548 + inset, 250, 528 + inset, 330, 540 + inset);
    g.lineTo(WIDTH - 330, 540 + inset);
    g.bezierCurveTo(WIDTH - 250, 528 + inset, WIDTH - 120, 548 + inset, WIDTH + 10, 586 + inset);
    g.lineTo(WIDTH + 10, B + 10);
    g.closePath();
  };
  outline(0);
  const body = g.createLinearGradient(0, 520, 0, B);
  body.addColorStop(0, shade(main, 0.35));
  body.addColorStop(0.18, main);
  body.addColorStop(0.6, shade(main, -0.45));
  body.addColorStop(1, shade(main, -0.85));
  g.fillStyle = body;
  g.fill();
  // accent stripe following the top edge
  g.save();
  outline(16);
  g.clip();
  outline(30);
  g.fillStyle = shade(main, -0.6);
  g.fill();
  g.restore();
  g.save();
  outline(16);
  g.lineWidth = 9;
  g.strokeStyle = accent;
  g.globalAlpha = 0.9;
  g.stroke();
  g.restore();
  // gloss highlight on the edge
  outline(2);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.stroke();
  // side shading so the panels look curved
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? 0 : WIDTH;
    const sg = g.createLinearGradient(x0, 0, x0 - side * 330, 0);
    sg.addColorStop(0, 'rgba(0,0,0,0.55)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg;
    outline(0);
    g.fill();
  }

  // matte instrument housing (arched like the reference)
  g.beginPath();
  g.moveTo(352, B + 10);
  g.lineTo(358, 600);
  g.bezierCurveTo(364, 524, 460, 500, CX, 498);
  g.bezierCurveTo(WIDTH - 460, 500, WIDTH - 364, 524, WIDTH - 358, 600);
  g.lineTo(WIDTH - 352, B + 10);
  g.closePath();
  const hs = g.createLinearGradient(0, 490, 0, B);
  hs.addColorStop(0, '#34363c');
  hs.addColorStop(0.12, '#1d1f23');
  hs.addColorStop(1, '#060708');
  g.fillStyle = hs;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.stroke();
  // fine texture on the plastic
  g.save();
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.018)';
  for (let y = 500; y < B; y += 3) g.fillRect(350, y, 580, 1);
  g.restore();

  gaugeFace(g, L.speedo, speedoMax(bike), 20, 999, 'MPH', '');
  gaugeFace(g, L.tacho, 12, 1, 10, 'RPM', 'x1000 r/min');
  plateBacks(g, L);
}

function paintNaked(g: CanvasRenderingContext2D, bike: BikeDef, L: Layout) {
  const [main, accent] = bike.paint;
  // tank: a big glossy dome rising from the bottom
  g.save();
  g.beginPath();
  g.ellipse(CX, B + 170, 360, 290, 0, Math.PI, 0);
  g.closePath();
  const tank = g.createRadialGradient(CX - 90, B - 60, 20, CX, B + 120, 380);
  tank.addColorStop(0, shade(main, 0.55));
  tank.addColorStop(0.25, main);
  tank.addColorStop(0.75, shade(main, -0.55));
  tank.addColorStop(1, shade(main, -0.9));
  g.fillStyle = tank;
  g.fill();
  g.clip();
  // twin pinstripes
  g.strokeStyle = accent;
  g.globalAlpha = 0.85;
  for (const dx of [-22, 22]) {
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(CX + dx, B - 118);
    g.quadraticCurveTo(CX + dx * 1.4, B - 30, CX + dx * 2.2, B + 20);
    g.stroke();
  }
  g.globalAlpha = 1;
  // specular streak
  const spec = g.createLinearGradient(CX - 260, 0, CX - 80, 0);
  spec.addColorStop(0, 'rgba(255,255,255,0)');
  spec.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec;
  g.beginPath();
  g.ellipse(CX - 170, B - 70, 90, 26, -0.25, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // chrome filler cap
  const capG = g.createRadialGradient(CX - 8, B - 40, 2, CX, B - 34, 34);
  capG.addColorStop(0, '#ffffff');
  capG.addColorStop(0.5, '#9aa1ac');
  capG.addColorStop(1, '#2c3036');
  g.fillStyle = capG;
  g.beginPath();
  g.ellipse(CX, B - 34, 38, 16, 0, 0, Math.PI * 2);
  g.fill();
  plateBacks(g, L);
}

/** The bar, clamp and the round gauge pods of a naked bike (rotate with the steering). */
function paintNakedBars(g: CanvasRenderingContext2D, bike: BikeDef, L: Layout) {
  // handlebar: the clamp is far away (high, thin); the ends come toward you (low, thick)
  const barPath = (dy: number) => {
    g.beginPath();
    g.moveTo(-60, 790 + dy);
    g.bezierCurveTo(180, 700 + dy, 430, 632 + dy, CX, 622 + dy);
    g.bezierCurveTo(WIDTH - 430, 632 + dy, WIDTH - 180, 700 + dy, WIDTH + 60, 790 + dy);
  };
  g.lineCap = 'butt';
  for (const [lw, color, dy] of [[30, '#0b0c0e', 0], [24, '#2c2f35', 0], [6, 'rgba(255,255,255,0.32)', -8]] as const) {
    // taper: draw thicker copies toward the ends by stacking a wide stroke clipped to the sides
    g.strokeStyle = color;
    g.lineWidth = lw;
    barPath(dy);
    g.stroke();
    g.save();
    g.beginPath();
    g.rect(0, 0, 330, B);
    g.rect(WIDTH - 330, 0, 330, B);
    g.clip();
    g.lineWidth = lw * 1.7;
    barPath(dy * 1.4);
    g.stroke();
    g.restore();
  }
  // ribbed rubber grips + chrome levers in the bottom corners
  for (const side of [-1, 1]) {
    g.save();
    g.translate(side < 0 ? 90 : WIDTH - 90, 742);
    g.rotate(side * -0.42);
    const grip = g.createLinearGradient(0, -40, 0, 40);
    grip.addColorStop(0, '#3b3d42');
    grip.addColorStop(0.45, '#151619');
    grip.addColorStop(1, '#050506');
    g.fillStyle = grip;
    g.beginPath();
    g.roundRect(-150, -40, 300, 80, 34);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.6)';
    for (let i = -130; i < 140; i += 14) g.fillRect(i, -38, 5, 76);
    // brake / clutch lever sweeping in front of the grip
    const lev = g.createLinearGradient(0, -70, 0, -50);
    lev.addColorStop(0, '#f1f3f6');
    lev.addColorStop(1, '#5d636d');
    g.fillStyle = lev;
    g.beginPath();
    g.moveTo(side * 150, -40);
    g.quadraticCurveTo(0, -84, -side * 140, -62);
    g.lineTo(-side * 138, -50);
    g.quadraticCurveTo(0, -68, side * 150, -24);
    g.closePath();
    g.fill();
    g.restore();
  }
  // top clamp
  const clampG = g.createLinearGradient(0, 594, 0, 640);
  clampG.addColorStop(0, '#c8cdd5');
  clampG.addColorStop(0.5, '#5d636d');
  clampG.addColorStop(1, '#2a2e34');
  g.fillStyle = clampG;
  g.beginPath();
  g.roundRect(CX - 70, 596, 140, 40, 10);
  g.fill();
  // gauge cups
  for (const d of [L.speedo, L.tacho]) {
    const cup = g.createRadialGradient(d.x, d.y - 10, d.r * 0.4, d.x, d.y + 10, d.r + 22);
    cup.addColorStop(0, '#2a2c31');
    cup.addColorStop(1, '#050506');
    g.fillStyle = cup;
    g.beginPath();
    g.arc(d.x, d.y + 6, d.r + 20, 0, Math.PI * 2);
    g.fill();
  }
  gaugeFace(g, L.speedo, speedoMax(bike), 20, 999, 'MPH', '');
  gaugeFace(g, L.tacho, 12, 1, 9.5, 'RPM', 'x1000 r/min');
}

function plateBacks(g: CanvasRenderingContext2D, L: Layout) {
  for (const p of L.plates) {
    g.fillStyle = 'rgba(4,5,7,0.72)';
    g.beginPath();
    g.roundRect(p.x - 128, p.y - 30, 256, 54, 10);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.lineWidth = 1.5;
    g.stroke();
  }
}

const speedoMax = (bike: BikeDef) => Math.ceil((bike.topSpeed + 20) / 20) * 20;

// --- the cockpit ------------------------------------------------------------------------------
export class Cockpit {
  private body: HTMLCanvasElement | null = null;
  private bars: HTMLCanvasElement | null = null;
  private key = '';

  constructor(private assets: Assets) {}

  private layout(bike: BikeDef): Layout {
    return bike.cls === 'RAT' ? NAKED : FAIRED;
  }

  private ensure(bike: BikeDef) {
    if (this.key === bike.id && this.body) return;
    this.key = bike.id;
    const L = this.layout(bike);
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = WIDTH;
      c.height = HEIGHT;
      return c;
    };
    this.body = mk();
    if (L.naked) {
      paintNaked(this.body.getContext('2d')!, bike, L);
      this.bars = mk();
      paintNakedBars(this.bars.getContext('2d')!, bike, L);
    } else {
      paintFaired(this.body.getContext('2d')!, bike, L);
      this.bars = null;
    }
  }

  draw(ctx: CanvasRenderingContext2D, st: CockpitState) {
    const { race, bike, time } = st;
    const p = race.player;
    this.ensure(bike);
    const L = this.layout(bike);
    const sp = clamp(p.speed / p.topSpeed, 0, 1);
    // engine buzz + road texture coming up through the frame
    const shake = (Math.sin(time * 61) * 0.9 + Math.sin(time * 23.7) * 0.6) * sp * 1.4 + (p.offroad ? Math.sin(time * 97) * 3 : 0);

    ctx.save();
    ctx.translate(0, shake);
    this.drawMirrors(ctx, st, L);
    ctx.drawImage(this.body!, 0, 0);
    if (L.naked && this.bars) {
      // a naked bike's gauges sit on the bars and turn with them
      ctx.save();
      ctx.translate(CX, 700);
      ctx.rotate(p.steer * 0.05);
      ctx.translate(-CX, -700);
      ctx.drawImage(this.bars, 0, 0);
      this.drawNeedles(ctx, L, p, bike, time);
      ctx.restore();
    } else this.drawNeedles(ctx, L, p, bike, time);
    if (st.night) this.nightShade(ctx, L);
    this.drawLcd(ctx, L, race, time);
    this.drawPlates(ctx, L, race, time);
    this.drawArm(ctx, p);
    ctx.restore();
    this.copWash(ctx, race, time);
  }

  // --- moving parts -------------------------------------------------------------------------
  private drawNeedles(ctx: CanvasRenderingContext2D, L: Layout, p: Racer, bike: BikeDef, time: number) {
    const { rpm } = p.gearRpm();
    const mph = p.onBike ? p.mph : 0;
    const needle = (d: Dial, frac: number) => {
      const a = A0 + (A1 - A0) * clamp(frac, 0, 1.01);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#d3150f';
      ctx.beginPath();
      const c = Math.cos(a), s = Math.sin(a);
      ctx.moveTo(d.x - c * d.r * 0.18 - s * 4, d.y - s * d.r * 0.18 + c * 4);
      ctx.lineTo(d.x + c * d.r * 0.88, d.y + s * d.r * 0.88);
      ctx.lineTo(d.x - c * d.r * 0.18 + s * 4, d.y - s * d.r * 0.18 - c * 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const hub = ctx.createRadialGradient(d.x - 3, d.y - 3, 1, d.x, d.y, d.r * 0.13);
      hub.addColorStop(0, '#7b808a');
      hub.addColorStop(1, '#0c0d10');
      ctx.fillStyle = hub;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      // glass glare over everything
      const gl = ctx.createLinearGradient(d.x - d.r, d.y - d.r, d.x + d.r * 0.2, d.y);
      gl.addColorStop(0, 'rgba(255,255,255,0.32)');
      gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, Math.PI * 0.95, Math.PI * 1.75);
      ctx.quadraticCurveTo(d.x - d.r * 0.15, d.y - d.r * 0.2, d.x - d.r * 0.98, d.y + d.r * 0.1);
      ctx.fill();
    };
    needle(L.speedo, mph / speedoMax(bike));
    const redline = rpm > 10000 ? Math.sin(time * 80) * 0.006 : 0;
    needle(L.tacho, rpm / 12000 + redline);
  }

  /** Small green LCD: gear, place, clock; a 3-colour bike-damage bar on top; warning lamps. */
  private drawLcd(ctx: CanvasRenderingContext2D, L: Layout, race: Race, time: number) {
    const p = race.player;
    const { x, y, w, h } = L.lcd;
    const { gear } = p.gearRpm();
    // bike condition bar (like the reference's little tri-colour strip)
    const bw = w - 10, bx = x - bw / 2, by = y - h / 2 - 16;
    ctx.fillStyle = '#050506';
    ctx.fillRect(bx - 3, by - 3, bw + 6, 12);
    const health = 1 - p.damage / 100;
    const segs = 15;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const lit = t < health;
      const col = t < 0.2 ? '#ff3b30' : t < 0.45 ? '#ffc23a' : '#36d96a';
      ctx.fillStyle = lit ? col : '#1a1c20';
      ctx.fillRect(bx + (i * bw) / segs + 1, by, bw / segs - 2, 6);
    }
    // the panel
    ctx.fillStyle = '#0a120d';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = '#3d424a';
    ctx.lineWidth = 2;
    ctx.stroke();
    const lcd = '#9dffb0';
    ctx.save();
    ctx.shadowColor = '#3dff7a';
    ctx.shadowBlur = 6;
    ctx.fillStyle = lcd;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = `22px ${FONT_BODY}`;
    ctx.fillText(p.onBike ? String(gear) : 'N', x - w / 2 + 8, y + (L.naked ? 10 : 0));
    const over = race.phase === 'busted' || race.phase === 'wrecked';
    const place = race.playerPlace;
    ctx.textAlign = 'right';
    ctx.font = `12px ${FONT_BODY}`;
    ctx.fillStyle = over ? '#ff6b5e' : place <= QUALIFY_PLACE ? '#ffe26a' : lcd;
    ctx.fillText(over ? '--' : ordinal(place), x + w / 2 - 7, y - (L.naked ? 4 : 12));
    ctx.font = `7px ${FONT_BODY}`;
    ctx.fillStyle = lcd;
    ctx.fillText(`/${race.racers.length}`, x + w / 2 - 7, y + (L.naked ? 8 : 0));
    if (!L.naked) {
      ctx.textAlign = 'center';
      ctx.font = `8px ${FONT_BODY}`;
      ctx.fillText(formatTime(race.time), x, y + h / 2 - 9);
    }
    ctx.restore();

    // warning lamps: club in hand, police on your tail, rider hurt
    const chased = race.cops.some((c) => (c.copState === 'chase' || c.copState === 'arrest') && Math.abs(c.z - p.z) < 9000);
    const nos = p.nitroCharges + (p.nitroTime > 0 ? 1 : 0);
    const lamps: [string, string, boolean][] = [
      [p.nitroTime > 0 ? 'NOS!' : `NOS${nos}`, p.nitroTime > 0 && Math.floor(time * 10) % 2 ? '#bfe2ff' : '#3a8cff', nos > 0],
      [p.weapon ? p.weapon.slice(0, 4).toUpperCase() : 'ARM', '#ff9a1f', !!p.weapon],
      ['COPS', Math.floor(time * 7) % 2 ? '#2f7bff' : '#ff3030', chased],
    ];
    const ly = L.naked ? y + h / 2 + 16 : y + h / 2 + 22;
    const gap = L.naked ? 44 : 33;
    lamps.forEach(([label, color, on], i) => {
      const lx = x + (i - 1) * gap;
      ctx.fillStyle = '#0b0c0e';
      ctx.beginPath();
      ctx.roundRect(lx - gap / 2 + 2, ly - 9, gap - 4, 16, 4);
      ctx.fill();
      ctx.save();
      if (on) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
      }
      ctx.fillStyle = on ? color : '#2a2c31';
      ctx.font = `${L.naked ? 7 : 5}px ${FONT_BODY}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, lx, ly + 3);
      ctx.restore();
    });

    // odometer: miles to go
    const miles = (race.track.raceLength * (1 - race.progress(p))) / (MPH * 3600);
    const oy = L.naked ? 704 : 706;
    ctx.fillStyle = '#060607';
    ctx.beginPath();
    ctx.roundRect(x - 52, oy - 15, 104, 20, 4);
    ctx.fill();
    ctx.fillStyle = '#f2f2f2';
    ctx.font = `10px ${FONT_BODY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${miles.toFixed(1)} MI`, x, oy);
  }

  /** You on the left, the nearest rival on the right, like the 3DO / PC cockpit. */
  private drawPlates(ctx: CanvasRenderingContext2D, L: Layout, race: Race, time: number) {
    const p = race.player;
    let foe: Racer | null = null, best = 2600;
    for (const r of race.riders) {
      if (r === p || !r.onBike || (r.isCop && r.copState === 'parked')) continue;
      const d = Math.abs(r.z - p.z) + Math.abs(r.x - p.x) * 300;
      if (d < best) (best = d), (foe = r);
    }
    const bar = (x: number, y: number, w: number, frac: number, color: (t: number) => string) => {
      const segs = 16, sw = w / segs;
      ctx.fillStyle = '#050506';
      ctx.fillRect(x - 2, y - 2, w + 4, 14);
      for (let i = 0; i < segs; i++) {
        const t = i / segs;
        ctx.fillStyle = t < frac ? color(t) : '#1c1e22';
        ctx.fillRect(x + i * sw + 1, y, sw - 2, 10);
      }
    };
    const hp = p.health / p.maxHealth;
    const me = L.plates[0], them = L.plates[1];
    ctx.textBaseline = 'alphabetic';
    ctx.font = `10px ${FONT_BODY}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd23a';
    ctx.fillText((p.name || 'YOU').slice(0, 10), me.x - 114, me.y - 9);
    bar(me.x - 114, me.y + 2, 228, hp, (t) => (hp < 0.3 && Math.floor(time * 6) % 2 ? '#ff3b30' : t < 0.25 ? '#ff5a3a' : t < 0.55 ? '#ffc23a' : '#3ee06a'));
    if (foe) {
      const id = foe.isCop ? 'cop' : foe.def?.id;
      const portrait = id && this.assets.has(`portraits/${id}`) ? this.assets.get(`portraits/${id}`) : null;
      if (portrait) {
        ctx.drawImage(portrait.img, them.x + 88, them.y - 26, 24, 24);
        ctx.strokeStyle = foe.isCop ? '#3aa0ff' : '#ff3b30';
        ctx.lineWidth = 2;
        ctx.strokeRect(them.x + 88, them.y - 26, 24, 24);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = foe.isCop ? '#6cb8ff' : '#ff7a6a';
      ctx.fillText(foe.name.toUpperCase().slice(0, 9) + (foe.weapon ? (foe.isCop ? ' +STICK' : ` +${foe.weapon.toUpperCase()}`) : ''), them.x - 114, them.y - 9);
      bar(them.x - 114, them.y + 2, 228, foe.health / foe.maxHealth, () => (foe!.isCop ? '#3aa0ff' : '#ff8a1f'));
    } else {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#5c626d';
      ctx.font = `8px ${FONT_BODY}`;
      ctx.fillText('NO ONE IN REACH', them.x, them.y);
    }
  }

  private drawMirrors(ctx: CanvasRenderingContext2D, st: CockpitState, L: Layout) {
    const img = st.mirror as HTMLCanvasElement | null;
    for (const m of L.mirrors) {
      const { x, y, w, h, side } = m;
      // stalk
      ctx.strokeStyle = '#121316';
      ctx.lineWidth = L.naked ? 9 : 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (L.naked) {
        ctx.moveTo(x + side * 40, y + h / 2 - 4);
        ctx.lineTo(x + side * 120, 676);
      } else {
        ctx.moveTo(x + side * 30, y + h / 2 - 6);
        ctx.lineTo(x + side * 80, y + h / 2 + 70);
      }
      ctx.stroke();
      // housing
      const hg = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
      hg.addColorStop(0, '#3a3d44');
      hg.addColorStop(0.5, '#16181b');
      hg.addColorStop(1, '#0a0b0d');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.roundRect(x - w / 2 - 8, y - h / 2 - 8, w + 16, h + 16, h * 0.42);
      ctx.fill();
      // glass
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - h / 2, w, h, h * 0.36);
      ctx.clip();
      if (img) {
        const sw = img.width * 0.62, sx = side < 0 ? 0 : img.width - sw;
        ctx.drawImage(img, sx, 0, sw, img.height, x - w / 2 - 4, y - h / 2 - 4, w + 8, h + 8);
      } else {
        ctx.fillStyle = '#444';
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
      }
      const glare = ctx.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
      glare.addColorStop(0, 'rgba(255,255,255,0.22)');
      glare.addColorStop(0.4, 'rgba(255,255,255,0)');
      glare.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = glare;
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x - w / 2 - 8, y - h / 2 - 8, w + 16, h + 16, h * 0.42);
      ctx.stroke();
    }
  }

  /** At night the bodywork falls into shadow; the gauges stay backlit. */
  private nightShade(ctx: CanvasRenderingContext2D, L: Layout) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 380, WIDTH, B - 380);
    for (const d of [L.speedo, L.tacho]) {
      ctx.moveTo(d.x + d.r, d.y);
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2, true);
    }
    ctx.fillStyle = 'rgba(2,4,12,0.55)';
    ctx.fill('evenodd');
    ctx.globalCompositeOperation = 'lighter';
    for (const d of [L.speedo, L.tacho]) {
      const glow = ctx.createRadialGradient(d.x, d.y, d.r * 0.2, d.x, d.y, d.r * 1.25);
      glow.addColorStop(0, 'rgba(255,170,60,0.10)');
      glow.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 1.25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Flashing red / blue along the top of the view while a cop is on your tail. */
  private copWash(ctx: CanvasRenderingContext2D, race: Race, time: number) {
    const p = race.player;
    const cop = race.cops.find((c) => (c.copState === 'chase' || c.copState === 'arrest') && p.z - c.z > -800 && p.z - c.z < 7000);
    if (!cop) return;
    const on = Math.floor(time * 7) % 2;
    for (let i = 0; i < 2; i++) {
      const left = (i === 0) === !!on;
      const g = ctx.createLinearGradient(0, 0, 0, 60);
      const c = left ? '255,40,40' : '40,110,255';
      g.addColorStop(0, `rgba(${c},0.55)`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(i === 0 ? 0 : WIDTH / 2, 0, WIDTH / 2, 60);
    }
  }

  // --- your arm / leg when you attack ----------------------------------------------------------
  private drawArm(ctx: CanvasRenderingContext2D, p: Racer) {
    const a = p.attack;
    if (!a) return;
    const k = Math.sin(Math.PI * clamp(a.t / a.duration, 0, 1));
    const side = a.side;
    if (a.kind === 'kick') {
      this.drawLeg(ctx, side, k);
      return;
    }
    // shoulder below the screen edge; the fist swings out and up toward the target beside you
    const sx = CX + side * 660, sy = B + 150;
    const fx = CX + side * (500 - 90 * k), fy = 660 - 270 * k;
    const scale = 1.45 - 0.4 * k;
    // elbow: bent outward, straightening as the punch lands
    const ex = sx + (fx - sx) * 0.48 + side * (120 - 70 * k), ey = sy + (fy - sy) * 0.5 + 40;
    const limb = (ax: number, ay: number, bx: number, by: number, wa: number, wb: number) => {
      const ang = Math.atan2(by - ay, bx - ax);
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      ctx.beginPath();
      ctx.moveTo(ax + nx * wa, ay + ny * wa);
      ctx.lineTo(bx + nx * wb, by + ny * wb);
      ctx.arc(bx, by, wb, ang + Math.PI / 2, ang - Math.PI / 2, true);
      ctx.lineTo(ax - nx * wa, ay - ny * wa);
      ctx.closePath();
      const sl = ctx.createLinearGradient(ax + nx * wa, ay + ny * wa, ax - nx * wa, ay - ny * wa);
      sl.addColorStop(0, '#060607');
      sl.addColorStop(0.3, '#242327');
      sl.addColorStop(0.48, '#57545c');
      sl.addColorStop(0.62, '#262529');
      sl.addColorStop(1, '#050506');
      ctx.fillStyle = sl;
      ctx.fill();
      return ang;
    };
    limb(sx, sy, ex, ey, 100, 64);
    const ang = limb(ex, ey, fx, fy, 62, 34 * scale);
    // creases where the leather bunches at the elbow
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2.5;
    for (const o of [-22, 0, 22]) {
      ctx.beginPath();
      ctx.moveTo(ex - side * 50, ey + o);
      ctx.quadraticCurveTo(ex, ey + o - 12, ex + side * 46, ey + o + 4);
      ctx.stroke();
    }
    if (a.kind === 'club' || a.kind === 'crowbar') this.drawClub(ctx, fx, fy, side, k, scale, a.kind === 'crowbar');
    if (a.kind === 'chain') this.drawChain(ctx, fx, fy, side, k, scale);
    this.drawFist(ctx, fx, fy, side, scale, ang);
  }

  private drawFist(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, s: number, ang: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang + Math.PI / 2);
    ctx.scale(s * side, s);
    // glove body
    const g = ctx.createRadialGradient(-10, -20, 4, 0, 0, 70);
    g.addColorStop(0, '#5a5860');
    g.addColorStop(0.45, '#26252a');
    g.addColorStop(1, '#09090b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-46, -50, 92, 86, [34, 34, 24, 24]);
    ctx.fill();
    // knuckles: four rounded bumps with a soft highlight
    for (let i = 0; i < 4; i++) {
      const kx = -33 + i * 22;
      const kg = ctx.createRadialGradient(kx - 3, -46, 1, kx, -40, 14);
      kg.addColorStop(0, '#77757d');
      kg.addColorStop(1, 'rgba(30,30,34,0)');
      ctx.fillStyle = kg;
      ctx.beginPath();
      ctx.arc(kx, -40, 13, 0, Math.PI * 2);
      ctx.fill();
    }
    // finger seams
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-44 + i * 22, -48);
      ctx.lineTo(-42 + i * 22, -8);
      ctx.stroke();
    }
    // thumb across the front
    const tg = ctx.createLinearGradient(0, -6, 0, 18);
    tg.addColorStop(0, '#4a4950');
    tg.addColorStop(1, '#141417');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.ellipse(-6, 4, 34, 13, -0.12, 0, Math.PI * 2);
    ctx.fill();
    // cuff with a red stripe
    ctx.fillStyle = '#121214';
    ctx.fillRect(-44, 30, 88, 22);
    ctx.fillStyle = '#a3161a';
    ctx.fillRect(-44, 36, 88, 5);
    ctx.restore();
  }

  /** A chain whipping out from the fist: a curve of alternating silver links. */
  private drawChain(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, k: number, s: number) {
    const len = 260 * s;
    const a = side * (-1.3 + k * 1.9) - Math.PI / 2;
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    // sag / whip: the middle trails behind the swing
    const mx = (x + ex) / 2 - side * 60 * (1 - k), my = (y + ey) / 2 + 50 * (1 - k);
    const links = 18;
    for (let i = 0; i < links; i++) {
      const t = i / (links - 1);
      const px = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * mx + t * t * ex;
      const py = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * my + t * t * ey;
      const g = ctx.createLinearGradient(px - 8, py - 8, px + 8, py + 8);
      g.addColorStop(0, '#f2f4f8');
      g.addColorStop(0.5, '#8a919d');
      g.addColorStop(1, '#3a3f48');
      ctx.strokeStyle = g;
      ctx.lineWidth = 5 * s;
      ctx.beginPath();
      ctx.ellipse(px, py, 11 * s, 6 * s, a + (i % 2 ? Math.PI / 2 : 0), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawClub(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, k: number, s: number, steel = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(side * (-1.1 + k * 1.5));
    ctx.scale(s, s);
    if (steel) {
      // crowbar: a hex steel bar with the curved claw at the top
      const bar = ctx.createLinearGradient(-9, 0, 9, 0);
      bar.addColorStop(0, '#2c3038');
      bar.addColorStop(0.45, '#c9ced8');
      bar.addColorStop(1, '#3a3f48');
      ctx.fillStyle = bar;
      ctx.fillRect(-8, -220, 16, 232);
      ctx.strokeStyle = bar;
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(-26, -220, 26, 0, -Math.PI * 0.9, true);
      ctx.stroke();
      ctx.fillStyle = '#b3161a';
      ctx.fillRect(-9, -40, 18, 46);
      ctx.restore();
      return;
    }
    const wood = ctx.createLinearGradient(-16, 0, 16, 0);
    wood.addColorStop(0, '#3e2410');
    wood.addColorStop(0.35, '#a0662c');
    wood.addColorStop(0.55, '#c7894a');
    wood.addColorStop(1, '#4a2b12');
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.moveTo(-10, 10);
    ctx.lineTo(-17, -230);
    ctx.quadraticCurveTo(0, -252, 17, -230);
    ctx.lineTo(10, 10);
    ctx.closePath();
    ctx.fill();
    // grip tape
    ctx.fillStyle = '#1a1a1c';
    ctx.fillRect(-11, -30, 22, 40);
    ctx.restore();
  }

  private drawLeg(ctx: CanvasRenderingContext2D, side: number, k: number) {
    const hx = CX + side * 700, hy = B + 200; // hip, off screen
    const fx = CX + side * (560 - 60 * k), fy = B - 30 - 210 * k;
    const ang = Math.atan2(fy - hy, fx - hx);
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    ctx.beginPath();
    ctx.moveTo(hx + nx * 95, hy + ny * 95);
    ctx.lineTo(fx + nx * 58, fy + ny * 58);
    ctx.lineTo(fx - nx * 58, fy - ny * 58);
    ctx.lineTo(hx - nx * 95, hy - ny * 95);
    ctx.closePath();
    const jeans = ctx.createLinearGradient(hx + nx * 95, hy + ny * 95, hx - nx * 95, hy - ny * 95);
    jeans.addColorStop(0, '#152640');
    jeans.addColorStop(0.5, '#3d5f93');
    jeans.addColorStop(1, '#10203a');
    ctx.fillStyle = jeans;
    ctx.fill();
    // boot
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(ang);
    const boot = ctx.createLinearGradient(0, -60, 0, 60);
    boot.addColorStop(0, '#3a2414');
    boot.addColorStop(0.5, '#6e4423');
    boot.addColorStop(1, '#1d1108');
    ctx.fillStyle = boot;
    ctx.beginPath();
    ctx.roundRect(-30, -62, 150, 124, [20, 60, 60, 20]);
    ctx.fill();
    ctx.fillStyle = '#120a04';
    ctx.fillRect(100, -62, 22, 124); // sole
    ctx.restore();
  }
}
