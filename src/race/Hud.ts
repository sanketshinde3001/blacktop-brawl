/**
 * The dashboard under the road view: chrome gauges, place badge, a real rear-view mirror,
 * segmented health / bike bars, the nearest rival (with portrait) and a road-style progress strip.
 */
import { HEIGHT, MPH, QUALIFY_PLACE, VIEW_HEIGHT, WIDTH } from '../config';
import type { Assets } from '../engine/Assets';
import { clamp, formatTime, ordinal } from '../engine/math';
import { COLORS, FONT_BODY, text } from '../ui/draw';
import type { Race } from './Race';
import type { Racer } from './Racer';

const TOP = VIEW_HEIGHT;
const H = HEIGHT - VIEW_HEIGHT;
const SPEEDO = { x: 96, y: 76, r: 62 };
const TACHO = { x: 258, y: 76, r: 62 };
const MIRROR = { x: 640, y: 74, rx: 182, ry: 54 };
const RIGHT = 852;

/** Jacket colour per design for the progress dots. */
const DESIGN_COLORS: Record<string, string> = {
  player: '#ffd23a', brawler: '#5a78a8', racer: '#1fb3a8', punk: '#e07020', yellow: '#f0c020', bomber: '#a86a35', rebel: '#e03a3a', cop: '#f0f0f0',
};

export class Hud {
  private panel: HTMLCanvasElement;

  constructor(private assets: Assets) {
    this.panel = document.createElement('canvas');
    this.panel.width = WIDTH;
    this.panel.height = H;
    this.paintPanel(this.panel.getContext('2d')!);
  }

  /** Static dashboard: carbon panel, chrome trim, gauge bezels, section bevels. Drawn once. */
  private paintPanel(g: CanvasRenderingContext2D) {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#22252e');
    bg.addColorStop(0.12, '#14161c');
    bg.addColorStop(1, '#07080b');
    g.fillStyle = bg;
    g.fillRect(0, 0, WIDTH, H);
    // carbon-fibre weave
    for (let y = 8; y < H; y += 6)
      for (let x = (y / 6) % 2 ? 0 : 6; x < WIDTH; x += 12) {
        g.fillStyle = 'rgba(255,255,255,0.025)';
        g.fillRect(x, y, 6, 3);
      }
    // chrome top trim + neon line
    const chrome = g.createLinearGradient(0, 0, 0, 7);
    chrome.addColorStop(0, '#e9edf3');
    chrome.addColorStop(0.5, '#7c8494');
    chrome.addColorStop(1, '#3a404c');
    g.fillStyle = chrome;
    g.fillRect(0, 0, WIDTH, 7);
    const neon = g.createLinearGradient(0, 0, WIDTH, 0);
    neon.addColorStop(0, '#ff3b30');
    neon.addColorStop(0.5, '#ff9f1c');
    neon.addColorStop(1, '#ff3b30');
    g.fillStyle = neon;
    g.fillRect(0, 7, WIDTH, 3);
    g.shadowColor = '#ff5a1f';
    g.shadowBlur = 12;
    g.fillRect(0, 7, WIDTH, 1);
    g.shadowBlur = 0;
    // section bevels
    const bevel = (x: number, w: number) => {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.roundRect(x, 16, w, H - 26, 14);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 2;
      g.stroke();
    };
    bevel(10, 335);
    bevel(352, 96);
    bevel(RIGHT - 8, WIDTH - RIGHT - 2);
    // gauge bezels
    for (const gge of [SPEEDO, TACHO]) {
      const ring = g.createLinearGradient(gge.x - gge.r, gge.y - gge.r, gge.x + gge.r, gge.y + gge.r);
      ring.addColorStop(0, '#f2f4f8');
      ring.addColorStop(0.45, '#6f7787');
      ring.addColorStop(0.55, '#4a5160');
      ring.addColorStop(1, '#dfe3ea');
      g.fillStyle = ring;
      g.beginPath();
      g.arc(gge.x, gge.y, gge.r + 6, 0, Math.PI * 2);
      g.fill();
      const face = g.createRadialGradient(gge.x, gge.y - 20, 4, gge.x, gge.y, gge.r);
      face.addColorStop(0, '#2a2f3c');
      face.addColorStop(1, '#06070a');
      g.fillStyle = face;
      g.beginPath();
      g.arc(gge.x, gge.y, gge.r, 0, Math.PI * 2);
      g.fill();
    }
    // mirror stalk
    g.fillStyle = '#2a2d36';
    g.fillRect(MIRROR.x - 10, MIRROR.y + MIRROR.ry, 20, H - MIRROR.y - MIRROR.ry);
    // rivets
    for (const x of [18, 337, 360, 440, RIGHT, WIDTH - 18]) for (const y of [24, H - 18]) {
      const rv = g.createRadialGradient(x - 1, y - 1, 0, x, y, 4);
      rv.addColorStop(0, '#c9ced8');
      rv.addColorStop(1, '#3b404b');
      g.fillStyle = rv;
      g.beginPath();
      g.arc(x, y, 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  render(ctx: CanvasRenderingContext2D, race: Race, time: number, mirror?: CanvasImageSource) {
    ctx.save();
    ctx.translate(0, TOP);
    ctx.drawImage(this.panel, 0, 0);
    const p = race.player;
    const { gear, rpm } = p.gearRpm();
    const maxMph = Math.ceil(p.topSpeed / MPH / 20) * 20 + 20;
    const mph = p.onBike ? p.mph : 0;
    this.gauge(ctx, SPEEDO, mph / maxMph, maxMph, ['#1d8bff', '#38e1ff', '#38e1ff'], 'MPH', String(Math.round(mph)), 1, time);
    this.gauge(ctx, TACHO, rpm / 12000, 12, ['#2bd96b', '#ffd23a', '#ff3b30'], 'RPM x1000', p.onBike ? String(gear) : 'N', 0.8, time);
    this.placeBadge(ctx, race);
    this.mirror(ctx, race, time, mirror);
    this.status(ctx, race, time);
    this.copLights(ctx, race, time);
    ctx.restore();
  }

  private gauge(ctx: CanvasRenderingContext2D, g: { x: number; y: number; r: number }, frac: number, max: number, arc: string[], label: string, readout: string, redline: number, time: number) {
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    // coloured arc band
    const band = ctx.createConicGradient(a0, g.x, g.y);
    band.addColorStop(0, arc[0]);
    band.addColorStop(0.5, arc[1]);
    band.addColorStop(0.75, arc[2]);
    band.addColorStop(1, arc[2]);
    ctx.lineWidth = 6;
    ctx.strokeStyle = band;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r - 6, a0, a1);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // ticks + numbers
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, a = a0 + (a1 - a0) * t;
      ctx.strokeStyle = t >= redline ? '#ff3b30' : '#e9edf3';
      ctx.lineWidth = i % 2 ? 1.5 : 3;
      ctx.beginPath();
      ctx.moveTo(g.x + Math.cos(a) * (g.r - 13), g.y + Math.sin(a) * (g.r - 13));
      ctx.lineTo(g.x + Math.cos(a) * (g.r - (i % 2 ? 18 : 22)), g.y + Math.sin(a) * (g.r - (i % 2 ? 18 : 22)));
      ctx.stroke();
      if (i % 4 === 0 && i > 0 && i < 12) text(ctx, String(Math.round(max * t)), g.x + Math.cos(a) * (g.r - 32), g.y + Math.sin(a) * (g.r - 32) + 3, { size: 7, align: 'center', shadow: false, color: '#b9c0cc' });
    }
    // needle with glow
    const a = a0 + (a1 - a0) * clamp(frac, 0, 1.02) + (frac > redline ? Math.sin(time * 70) * 0.02 : 0);
    ctx.save();
    ctx.shadowColor = '#ff6a00';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = '#ff7a1a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(g.x - Math.cos(a) * 8, g.y - Math.sin(a) * 8);
    ctx.lineTo(g.x + Math.cos(a) * (g.r - 10), g.y + Math.sin(a) * (g.r - 10));
    ctx.stroke();
    ctx.restore();
    const cap = ctx.createRadialGradient(g.x - 2, g.y - 2, 0, g.x, g.y, 8);
    cap.addColorStop(0, '#f2f4f8');
    cap.addColorStop(1, '#4a5160');
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(g.x, g.y, 7, 0, Math.PI * 2);
    ctx.fill();
    // digital readout
    ctx.fillStyle = '#050507';
    ctx.strokeStyle = 'rgba(255,210,58,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(g.x - 30, g.y + 20, 60, 24, 5);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.shadowColor = '#ffb020';
    ctx.shadowBlur = 8;
    text(ctx, readout, g.x, g.y + 40, { size: 15, align: 'center', color: '#ffc23a', shadow: false });
    ctx.restore();
    text(ctx, label, g.x, g.y + 58, { size: 6, align: 'center', color: '#8d95a3', shadow: false });
  }

  private placeBadge(ctx: CanvasRenderingContext2D, race: Race) {
    const over = race.phase === 'busted' || race.phase === 'wrecked';
    const place = race.playerPlace;
    const good = place <= QUALIFY_PLACE && !over;
    const x = 360, y = 24, w = 80, h = 74;
    const grd = ctx.createLinearGradient(0, y, 0, y + h);
    if (good) (grd.addColorStop(0, '#ffe680'), grd.addColorStop(0.5, '#f0b400'), grd.addColorStop(1, '#a86f00'));
    else (grd.addColorStop(0, '#ff7a6e'), grd.addColorStop(0.5, '#d7261e'), grd.addColorStop(1, '#7a0f0b'));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0b0a0c';
    ctx.stroke();
    text(ctx, 'PLACE', x + w / 2, y + 15, { size: 7, align: 'center', color: '#1a1006', shadow: false });
    const label = over ? '--' : ordinal(place);
    ctx.font = `20px ${FONT_BODY}`;
    const size = ctx.measureText(label).width > w - 10 ? 15 : 20;
    text(ctx, label, x + w / 2, y + 45, { size, align: 'center', color: '#fff', outline: 4 });
    text(ctx, `OF ${race.racers.length}`, x + w / 2, y + 63, { size: 7, align: 'center', color: '#1a1006', shadow: false });
    // race clock
    ctx.fillStyle = '#050507';
    ctx.beginPath();
    ctx.roundRect(x, y + h + 8, w, 22, 5);
    ctx.fill();
    text(ctx, formatTime(race.time), x + w / 2, y + h + 24, { size: 9, align: 'center', color: '#7dffb0', shadow: false });
  }

  /** A real rear-view mirror: the renderer's rear view, already flipped like a mirror. */
  private mirror(ctx: CanvasRenderingContext2D, race: Race, time: number, view?: CanvasImageSource) {
    const { x: cx, y: cy, rx, ry } = MIRROR;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    if (view) ctx.drawImage(view, cx - rx, cy - ry, rx * 2, ry * 2);
    else {
      ctx.fillStyle = race.track.def.colors.sky;
      ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    }
    // a chasing cop's lights wash over the mirror
    const cop = race.cops.find((c) => (c.copState === 'chase' || c.copState === 'arrest') && race.player.z - c.z > 0 && race.player.z - c.z < 6000);
    if (cop) {
      ctx.fillStyle = Math.floor(time * 8) % 2 ? 'rgba(255,40,40,0.18)' : 'rgba(40,90,255,0.18)';
      ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    }
    const glare = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
    glare.addColorStop(0, 'rgba(255,255,255,0.28)');
    glare.addColorStop(0.35, 'rgba(255,255,255,0)');
    ctx.fillStyle = glare;
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    ctx.restore();
    // chrome frame
    const frame = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
    frame.addColorStop(0, '#f2f4f8');
    frame.addColorStop(0.5, '#59606e');
    frame.addColorStop(1, '#d9dde4');
    ctx.lineWidth = 7;
    ctx.strokeStyle = frame;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 3, ry + 3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 7, ry + 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Segmented bar: `segs` blocks, colour by value or fixed. */
  private segBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: (f: number) => string, segs = 20) {
    ctx.fillStyle = '#050507';
    ctx.beginPath();
    ctx.roundRect(x - 3, y - 3, w + 6, h + 6, 4);
    ctx.fill();
    const sw = w / segs;
    const lit = Math.ceil(clamp(frac, 0, 1) * segs);
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle = i < lit ? color(i / segs) : '#1b1d24';
      ctx.fillRect(x + i * sw + 1, y, sw - 2, h);
      if (i < lit) {
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(x + i * sw + 1, y, sw - 2, 2);
      }
    }
  }

  private status(ctx: CanvasRenderingContext2D, race: Race, time: number) {
    const p = race.player;
    const x = RIGHT, labelX = x + 6, barX = x + 112, barW = 236;
    const hp = p.health / p.maxHealth;
    const healthColor = (f: number) => (hp < 0.3 ? (Math.floor(time * 6) % 2 ? '#ff3b30' : '#7a120e') : f < 0.25 ? '#ff5a3a' : f < 0.55 ? '#ffc23a' : '#3ee06a');

    // player
    ctx.fillStyle = '#d21f1f';
    ctx.beginPath();
    ctx.arc(labelX + 7, 30, 7, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, (p.name || 'YOU').slice(0, 7), labelX + 20, 34, { size: 9, color: COLORS.yellow, shadow: false });
    this.segBar(ctx, barX, 24, barW, 12, hp, healthColor);
    // bike
    ctx.fillStyle = '#8fb6ff';
    ctx.fillRect(labelX + 2, 50, 12, 6);
    ctx.fillRect(labelX + 6, 46, 4, 14);
    text(ctx, 'BIKE', labelX + 20, 58, { size: 9, color: '#9fb8e8', shadow: false });
    this.segBar(ctx, barX, 48, barW, 12, 1 - p.damage / 100, () => (p.damage < 65 ? '#3aa0ff' : '#ff7a1a'));
    if (p.weapon) text(ctx, p.weapon.toUpperCase(), barX + barW + 10, 34, { size: 8, color: COLORS.orange, shadow: false });
    // nitro bottles
    for (let i = 0; i < Math.min(5, p.nitroCharges + (p.nitroTime > 0 ? 1 : 0)); i++) {
      const burning = p.nitroTime > 0 && i === p.nitroCharges;
      const bx = barX + barW + 12 + i * 12, by = 48;
      ctx.fillStyle = burning ? (Math.floor(time * 10) % 2 ? '#9fd4ff' : '#2f7bff') : '#2f7bff';
      ctx.beginPath();
      ctx.roundRect(bx, by, 8, 13, 3);
      ctx.fill();
      ctx.fillStyle = '#cfe6ff';
      ctx.fillRect(bx + 2, by - 3, 4, 3);
    }

    // nearest rival, with portrait
    let foe: Racer | null = null, best = 2200;
    for (const r of race.riders) {
      if (r === p || !r.onBike || (r.isCop && r.copState === 'parked')) continue;
      const d = Math.abs(r.z - p.z) + Math.abs(r.x - p.x) * 300;
      if (d < best) (best = d), (foe = r);
    }
    if (foe) {
      const id = foe.isCop ? 'cop' : foe.def?.id;
      const portrait = id && this.assets.has(`portraits/${id}`) ? this.assets.get(`portraits/${id}`) : null;
      if (portrait) {
        ctx.drawImage(portrait.img, labelX, 66, 22, 22);
        ctx.strokeStyle = foe.isCop ? '#3aa0ff' : '#ff3b30';
        ctx.lineWidth = 2;
        ctx.strokeRect(labelX, 66, 22, 22);
      }
      text(ctx, foe.name.toUpperCase().slice(0, 7), labelX + 28, 82, { size: 9, color: foe.isCop ? COLORS.blue : '#ff6a5a', shadow: false });
      this.segBar(ctx, barX, 72, barW, 12, foe.health / foe.maxHealth, () => (foe!.isCop ? '#3aa0ff' : '#ff8a1f'));
      if (foe.weapon) text(ctx, foe.isCop ? 'STICK' : foe.weapon.toUpperCase(), barX + barW + 10, 82, { size: 8, color: COLORS.orange, shadow: false });
    } else {
      text(ctx, 'NO ONE IN REACH', labelX + 28, 82, { size: 8, color: '#555b66', shadow: false });
    }

    // progress: a little road from START to the chequered flag
    const px = barX - 24, py = 104, pw = barW + 64;
    ctx.fillStyle = '#3a3d45';
    ctx.fillRect(px, py, pw, 10);
    ctx.fillStyle = '#e9edf3';
    for (let i = 0; i < pw; i += 14) ctx.fillRect(px + i, py + 4, 7, 2);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#fff' : '#000';
      ctx.fillRect(px + pw + 2 + i * 3, py - 2 + j * 6, 3, 6);
    }
    const leader = race.standings[0];
    for (const r of race.racers) {
      if (r === p) continue;
      const rx = px + race.progress(r) * pw;
      ctx.fillStyle = DESIGN_COLORS[r.design] ?? '#999';
      ctx.fillRect(rx - 2, py + 1, 4, 8);
      if (r === leader) {
        ctx.fillStyle = COLORS.yellow;
        ctx.beginPath();
        ctx.moveTo(rx - 4, py - 1);
        ctx.lineTo(rx, py - 6);
        ctx.lineTo(rx + 4, py - 1);
        ctx.fill();
      }
    }
    const ppx = px + race.progress(p) * pw;
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.arc(ppx, py + 5, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    const miles = (race.track.raceLength * (1 - race.progress(p))) / (MPH * 3600);
    text(ctx, `${miles.toFixed(1)} MI TO GO`, px, py + 30, { size: 7, color: '#9aa3b2', shadow: false });
    text(ctx, race.track.def.name.toUpperCase(), px + pw + 14, py + 30, { size: 7, color: '#9aa3b2', shadow: false, align: 'right' });
  }

  /** Flashing light bar across the dashboard while a cop is on your tail. */
  private copLights(ctx: CanvasRenderingContext2D, race: Race, time: number) {
    const p = race.player;
    const cop = race.cops.find((c) => (c.copState === 'chase' || c.copState === 'arrest') && Math.abs(c.z - p.z) < 9000);
    if (!cop) return;
    const on = Math.floor(time * 7) % 2;
    for (let i = 0; i < 2; i++) {
      const left = (i === 0) === !!on;
      const g = ctx.createLinearGradient(0, 0, 0, 14);
      const c = left ? '255,40,40' : '40,110,255';
      g.addColorStop(0, `rgba(${c},0.95)`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(i === 0 ? 0 : WIDTH / 2, 0, WIDTH / 2, 14);
    }
    ctx.fillStyle = on ? '#ff2a2a' : '#2a6aff';
    ctx.beginPath();
    ctx.roundRect(MIRROR.x - 46, 12, 92, 20, 6);
    ctx.fill();
    text(ctx, 'COPS!', MIRROR.x, 27, { size: 10, align: 'center', color: '#fff', shadow: false });
  }
}
