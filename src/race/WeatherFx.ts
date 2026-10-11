/**
 * Screen-space weather effects drawn over the road view: rain streaks that fly past faster the
 * quicker you ride, drops sliding down the windscreen / visor in first person, and lightning.
 */
import { WIDTH } from '../config';
import { rand } from '../engine/Rng';
import type { Weather } from '../data/weather';

interface Streak {
  /** angle from the vanishing point and distance along it */
  a: number;
  r: number;
  len: number;
}

interface Drop {
  x: number;
  y: number;
  r: number;
  vy: number;
  life: number;
}

export class WeatherFx {
  private streaks: Streak[] = [];
  private drops: Drop[] = [];
  private flash = 0;
  private nextBolt = rand(6, 14);
  /** set when lightning strikes this frame (the scene plays the thunder) */
  struck = false;

  constructor(public weather: Weather) {
    if (weather === 'rain') {
      for (let i = 0; i < 260; i++) this.streaks.push({ a: rand(0, Math.PI * 2), r: rand(10, 900), len: rand(14, 40) });
    }
  }

  get active() {
    return this.weather === 'rain';
  }

  update(dt: number, speedFrac: number, firstPerson: boolean) {
    this.struck = false;
    if (!this.active) return;
    // streaks stream out from the vanishing point; faster riding = faster, longer streaks
    const v = 260 + speedFrac * 1500;
    for (const s of this.streaks) {
      s.r += (v + s.r * (0.6 + speedFrac * 2.4)) * dt;
      if (s.r > 1100) {
        s.r = rand(5, 120);
        s.a = rand(0, Math.PI * 2);
        s.len = rand(14, 40);
      }
    }
    // windscreen drops (first person): new ones land, slide, get blown off at speed
    if (firstPerson) {
      if (this.drops.length < 40 && Math.random() < dt * 30) this.drops.push({ x: rand(330, WIDTH - 330), y: rand(380, 560), r: rand(3, 9), vy: 0, life: rand(1.5, 4) });
      for (const d of this.drops) {
        d.vy += (20 + speedFrac * 120) * dt;
        d.y += d.vy * dt;
        d.x += (d.x - WIDTH / 2) * speedFrac * 0.8 * dt;
        d.life -= dt;
      }
      this.drops = this.drops.filter((d) => d.life > 0 && d.y < 600);
    } else this.drops.length = 0;
    // lightning now and then
    this.flash = Math.max(0, this.flash - dt * 3.5);
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.flash = 1;
      this.struck = true;
      this.nextBolt = rand(9, 22);
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, vanishX: number, vanishY: number, speedFrac: number) {
    if (!this.active) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(205,215,232,0.42)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const stretch = 1 + speedFrac * 2.2;
    for (const s of this.streaks) {
      const c = Math.cos(s.a), sn = Math.sin(s.a);
      // a little gravity: streaks lean downward as well as outward
      const x0 = vanishX + c * s.r, y0 = vanishY + sn * s.r * 0.75 + s.r * 0.25;
      const l = s.len * stretch * (0.4 + s.r / 900);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + c * l, y0 + (sn * 0.75 + 0.25) * l + l * 0.3);
    }
    ctx.stroke();
    // misty haze at the bottom (spray off the road)
    const haze = ctx.createLinearGradient(0, h * 0.7, 0, h);
    haze.addColorStop(0, 'rgba(180,190,205,0)');
    haze.addColorStop(1, `rgba(180,190,205,${0.12 + speedFrac * 0.12})`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
    ctx.restore();
  }

  /** Drops on the windscreen (first person only); drawn over the cockpit. */
  drawDrops(ctx: CanvasRenderingContext2D) {
    for (const d of this.drops) {
      const a = Math.min(1, d.life);
      const g = ctx.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.3, 0, d.x, d.y, d.r);
      g.addColorStop(0, `rgba(255,255,255,${0.55 * a})`);
      g.addColorStop(0.5, `rgba(200,215,235,${0.18 * a})`);
      g.addColorStop(1, `rgba(40,50,70,${0.25 * a})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.r * 0.8, d.r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Lightning: a white flash over everything. */
  drawFlash(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (this.flash <= 0) return;
    // double flicker
    const f = this.flash > 0.7 ? 1 : this.flash > 0.5 ? 0.3 : this.flash;
    ctx.fillStyle = `rgba(235,240,255,${0.55 * f})`;
    ctx.fillRect(0, 0, w, h);
  }
}
