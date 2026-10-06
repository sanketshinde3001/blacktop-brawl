/**
 * Pseudo-3D road renderer (the classic segment projection technique used by 16-bit racers).
 *  1. project each segment near-to-far, drawing ground/rumble/road and tracking the lowest
 *     visible y ("maxy") so hills hide what's behind them;
 *  2. draw props and moving things far-to-near, clipped against those hill lines.
 *
 * A render is a *view*: any size, looking forward (dir 1) or backward (dir -1). Looking back
 * mirrors left/right, reverses the curves, shows cars' fronts and riders' headlights. The same
 * code draws the main view, the look-back view and the rear-view mirrors.
 */
import { CAMERA, cameraDepth, DRAW_DISTANCE, FOG_DENSITY, RIDER_HEIGHT, ROAD_WIDTH, SEGMENT_LENGTH, VIEW_HEIGHT, WIDTH } from '../config';
import type { Assets, Sprite } from '../engine/Assets';
import { mixColor } from '../engine/math';
import { WEATHER, type Weather, type WeatherInfo } from '../data/weather';
import type { Race } from './Race';
import type { Body, Racer } from './Racer';
import type { Segment, Track } from './Track';

export interface Camera {
  x: number;
  y: number;
  z: number;
}

export interface ViewOptions {
  /** 1 = looking down the road, -1 = looking back */
  dir: 1 | -1;
  width: number;
  height: number;
  fov: number;
  /** horizon as a fraction of the view height */
  horizon: number;
  /** don't draw the player's own bike (first person, mirrors) */
  hidePlayer?: boolean;
  /** camera roll in radians (first-person lean) */
  roll?: number;
  particles?: boolean;
  /** draw distance in segments (mirrors use less) */
  drawDistance?: number;
  /** whose eyes this is (split screen); defaults to the race's player */
  self?: Racer;
}

/** Main forward view using the live CAMERA settings. */
export const forwardView = (): ViewOptions => ({ dir: 1, width: WIDTH, height: VIEW_HEIGHT, fov: CAMERA.fov, horizon: CAMERA.horizon, particles: true });

interface Renderable {
  z: number;
  x: number;
  /** height above the road surface */
  h: number;
  sprite: Sprite;
  worldH: number;
  rot?: number;
  /** rotate around the sprite centre instead of the ground anchor */
  centerPivot?: boolean;
  flash?: boolean;
  alpha?: number;
  shadow?: number;
  /** tiny sort bias so the player always wins ties */
  bias?: number;
  /** draw gantry poles from the road up to the sprite's bottom corners */
  poles?: boolean;
  /** seen from the front without a front-view sprite: add a headlight glow */
  headlight?: boolean;
  /** lamps this thing carries (night / dusk / rain lighting) */
  lamp?: 'bike' | 'car' | 'cop' | 'player';
  /** a car or bike facing the camera (headlights instead of taillights) */
  facing?: boolean;
}

/** A light source on screen this frame, collected while drawing. */
interface Light {
  x: number;
  y: number;
  r: number;
  color: string;
  /** how much darkness it cuts away (0..1) */
  cut: number;
}

export interface Particle {
  z: number;
  x: number;
  h: number;
  vz: number;
  vx: number;
  vh: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

/** A projected point of the current view. */
interface Proj {
  x: number;
  y: number;
  w: number;
  scale: number;
  /** distance from the camera along the view direction */
  cz: number;
}

/** A segment as seen by the current view: `near` is its bottom edge on screen, `far` its top. */
interface ViewSeg {
  seg: Segment;
  near: Proj;
  far: Proj;
  nearZ: number;
  farZ: number;
  clip: number;
  fog: number;
  visible: boolean;
}

const FOG_STEPS = 24;
const proj = (): Proj => ({ x: 0, y: 0, w: 0, scale: 0, cz: 0 });
/** front-view car sprite for each rear-view one (and back) */
const CAR_FLIP: Record<string, string> = {
  'cars/sedanRear': 'cars/sedanFront',
  'cars/pickupRear': 'cars/pickupFront',
  'cars/sportsRear': 'cars/sportsFront',
  'cars/vanRear': 'cars/vanFront',
  'cars/wagonRear': 'cars/sedanFront',
  'cars/semiRear': 'cars/semiFront',
  'cars/sedanFront': 'cars/sedanRear',
  'cars/pickupFront': 'cars/pickupRear',
  'cars/sportsFront': 'cars/sportsRear',
  'cars/vanFront': 'cars/vanRear',
  'cars/semiFront': 'cars/semiRear',
};

export class RoadRenderer {
  bgScroll = 0;
  particles: Particle[] = [];
  showDebug = false;
  private fogCache = new Map<string, string[]>();
  private buckets = new Map<number, Renderable[]>();
  private rideScale = new Map<string, number>();
  private pool: ViewSeg[] = [];
  private vsegs = new Map<number, ViewSeg>();
  /** screen x of the road's far end last frame, per direction (splits the distant ground colours) */
  private farX: Record<number, number> = { 1: WIDTH / 2, [-1]: WIDTH / 2 };

  // current view
  private W = WIDTH;
  private H = VIEW_HEIGHT;
  private halfW = WIDTH / 2;
  private horizonY = VIEW_HEIGHT * CAMERA.horizon;
  private depth = cameraDepth();
  private dir: 1 | -1 = 1;
  private hidePlayer = false;
  private self: Racer | null = null;
  private wx: WeatherInfo = WEATHER.day;
  private weather: Weather = 'day';
  private lights: Light[] = [];
  /** where the player's bike was drawn (for the headlight beam), or null if not on screen */
  private playerScreen: { x: number; y: number; w: number } | null = null;
  private darkCanvas: HTMLCanvasElement | null = null;
  private time = 0;

  constructor(private assets: Assets) {}

  private fogged(color: string, fogColor: string, fog: number): string {
    const key = color + fogColor;
    let arr = this.fogCache.get(key);
    if (!arr) {
      arr = [];
      for (let i = 0; i <= FOG_STEPS; i++) arr.push(mixColor(color, fogColor, i / FOG_STEPS));
      this.fogCache.set(key, arr);
    }
    return arr[Math.round((1 - fog) * FOG_STEPS)];
  }

  /** Sub-pixel projection (no rounding) so distant things glide instead of stepping. */
  private project(p: Proj, xRel: number, yRel: number, cz: number) {
    p.cz = cz;
    const scale = (p.scale = this.depth / cz);
    p.x = this.halfW + scale * xRel * this.halfW;
    p.y = this.horizonY - scale * yRel * this.halfW;
    p.w = scale * ROAD_WIDTH * this.halfW;
  }

  render(ctx: CanvasRenderingContext2D, race: Race, cam: Camera, dz: number, view: ViewOptions = forwardView()) {
    const track = race.track;
    const colors = track.def.colors;
    this.W = view.width;
    this.H = view.height;
    this.halfW = view.width / 2;
    this.horizonY = view.height * view.horizon;
    this.depth = 1 / Math.tan(((view.fov / 2) * Math.PI) / 180);
    this.dir = view.dir;
    this.hidePlayer = !!view.hidePlayer;
    this.self = view.self ?? race.player;
    this.weather = race.weather;
    this.wx = WEATHER[race.weather];
    this.lights.length = 0;
    this.playerScreen = null;
    this.time = race.time;
    const dir = view.dir;
    const drawDistance = view.drawDistance ?? DRAW_DISTANCE;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.W, this.H);
    ctx.clip();
    if (view.roll) {
      // tilt the world around the horizon, scaled up a little so the corners stay covered
      const k = 1 + Math.abs(view.roll) * 1.1;
      ctx.translate(this.halfW, this.horizonY);
      ctx.rotate(view.roll);
      ctx.scale(k, k);
      ctx.translate(-this.halfW, -this.horizonY);
    }

    const base = track.findSegment(cam.z);
    if (dir > 0) this.bgScroll += ((base.curve * dz) / SEGMENT_LENGTH) * 0.0009;
    this.drawBackground(ctx, track);

    // fraction of the base segment already behind the camera, in the view direction
    const inSeg = (cam.z % SEGMENT_LENGTH) / SEGMENT_LENGTH;
    const travelled = dir > 0 ? inSeg : 1 - inSeg;
    const curveOf = (s: Segment) => s.curve * dir;
    const camX = cam.x * dir;
    let maxy = this.H;
    let x = 0;
    let dx = -(curveOf(base) * travelled);
    const segs = track.segments;
    this.vsegs.clear();
    let used = 0;

    for (let n = 0; n <= drawDistance; n++) {
      const i = base.index + n * dir;
      if (i < 0 || i >= segs.length) break;
      const seg = segs[i];
      const vs = (this.pool[used] ??= { seg, near: proj(), far: proj(), nearZ: 0, farZ: 0, clip: 0, fog: 0, visible: false });
      used++;
      vs.seg = seg;
      vs.nearZ = dir > 0 ? seg.p1.world.z : seg.p2.world.z;
      vs.farZ = dir > 0 ? seg.p2.world.z : seg.p1.world.z;
      const nearY = dir > 0 ? seg.p1.world.y : seg.p2.world.y;
      const farY = dir > 0 ? seg.p2.world.y : seg.p1.world.y;
      vs.fog = 1 / Math.pow(Math.E, (n / drawDistance) ** 2 * FOG_DENSITY);
      vs.clip = maxy;
      vs.visible = false;
      this.vsegs.set(i, vs);
      this.project(vs.near, x - camX, nearY - cam.y, (vs.nearZ - cam.z) * dir);
      this.project(vs.far, x + dx - camX, farY - cam.y, (vs.farZ - cam.z) * dir);
      x += dx;
      dx += curveOf(seg);
      if (vs.near.cz <= this.depth || vs.far.y >= vs.near.y || vs.far.y >= maxy) continue;
      vs.visible = true;
      this.drawSegment(ctx, vs, colors);
      maxy = vs.near.y;
      this.farX[dir] = vs.far.x;
    }

    this.bucketEntities(race);
    for (let n = drawDistance; n > 0; n--) {
      const i = base.index + n * dir;
      const vs = this.vsegs.get(i);
      if (!vs) continue;
      if (track.def.railLeft && vs.visible) this.drawRail(ctx, vs, -1.1 * dir, track.def.colors.fog);
      const items = this.buckets.get(i);
      const props = vs.seg.props;
      if (!props.length && !items) continue;
      const list: Renderable[] = items ? [...items] : [];
      for (const p of props) {
        const sprite = p.flip ? this.assets.flipped(p.sprite) : this.assets.get(p.sprite);
        list.push({ z: vs.seg.p1.world.z, x: p.offset, h: p.lift ?? 0, sprite, worldH: p.h, poles: !!p.lift });
      }
      // far to near along the view direction
      list.sort((a, b) => (b.z - a.z) * dir || (a.bias ?? 0) - (b.bias ?? 0));
      for (const r of list) this.drawRenderable(ctx, r, vs);
    }
    if (view.particles) this.drawParticles(ctx, cam);
    if (this.wx.darkness > 0 || this.wx.lights) this.lightingPass(ctx, race, view);
    ctx.restore();
  }

  // --- lighting (dusk / night / rain) --------------------------------------------------------
  /**
   * Darkens the scene with a tinted overlay and cuts the lights out of it: your headlight beam,
   * other vehicles' head- and taillights. Then adds the glows on top.
   */
  private lightingPass(ctx: CanvasRenderingContext2D, race: Race, view: ViewOptions) {
    const { W, H, horizonY } = this;
    const wx = this.wx;
    const pad = Math.round(W * 0.3);
    const cw = W + pad * 2, ch = H + pad * 2;
    if (!this.darkCanvas || this.darkCanvas.width !== cw || this.darkCanvas.height !== ch) {
      this.darkCanvas = document.createElement('canvas');
      this.darkCanvas.width = cw;
      this.darkCanvas.height = ch;
    }
    const g = this.darkCanvas.getContext('2d')!;
    // the beam: forward from the bike (or from under the dash in first person)
    const beam: Light[] = [];
    if (view.dir > 0) {
      const ps = this.hidePlayer ? { x: W / 2, y: H * 1.05, w: W * 0.2 } : this.playerScreen;
      if (ps && this.self?.onBike) {
        const reach = Math.max(40, ps.y - horizonY);
        const vx = this.farX[1] ?? W / 2;
        // a pool of light just ahead of the wheel, narrowing and fading toward the horizon
        for (const t of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
          beam.push({ x: ps.x + (vx - ps.x) * t, y: ps.y - reach * t, r: W * (0.26 - t * 0.22) + ps.w * 0.5 * (1 - t), color: '', cut: 0.97 - t * 0.4 });
        }
      }
    }
    if (wx.darkness > 0) {
      g.setTransform(1, 0, 0, 1, pad, pad);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(-pad, -pad, cw, ch);
      const a = wx.darkness;
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, `rgba(${wx.tint},${a * 0.25})`);
      grad.addColorStop(Math.min(0.95, (horizonY / H) * 0.9), `rgba(${wx.tint},${a * 0.55})`);
      grad.addColorStop(Math.min(0.98, horizonY / H + 0.05), `rgba(${wx.tint},${a * 0.9})`);
      grad.addColorStop(1, `rgba(${wx.tint},${a})`);
      g.fillStyle = grad;
      g.fillRect(-pad, -pad, cw, ch);
      g.globalCompositeOperation = 'destination-out';
      const hole = (l: Light, squash = 1) => {
        g.save();
        g.translate(l.x, l.y);
        g.scale(1, squash);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, l.r);
        rg.addColorStop(0, `rgba(0,0,0,${l.cut})`);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg;
        g.beginPath();
        g.arc(0, 0, l.r, 0, Math.PI * 2);
        g.fill();
        g.restore();
      };
      for (const b of beam) hole(b, 0.45);
      for (const l of this.lights) hole({ ...l, r: l.r * 3, cut: l.cut * 0.8 });
      ctx.drawImage(this.darkCanvas, -pad, -pad);
    }
    // glows
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (wx.darkness > 0.5) {
      // warm light falling on the road from your headlamp
      for (const b of beam) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.scale(1, 0.4);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, b.r);
        rg.addColorStop(0, `rgba(255,232,180,${0.09 * b.cut})`);
        rg.addColorStop(1, 'rgba(255,232,180,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(-b.r, -b.r, b.r * 2, b.r * 2);
        ctx.restore();
      }
    }
    for (const l of this.lights) {
      const rg = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      rg.addColorStop(0, l.color);
      rg.addColorStop(0.25, l.color.replace(/,[\d.]+\)$/, ',0.35)'));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
      if (this.weather === 'rain' && l.y > horizonY) {
        // wet road: a long streak reflected under the lamp
        const rh = Math.min(H - l.y, l.r * 5);
        const sg = ctx.createLinearGradient(0, l.y, 0, l.y + rh);
        sg.addColorStop(0, l.color.replace(/,[\d.]+\)$/, ',0.28)'));
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(l.x - l.r * 0.18, l.y, l.r * 0.36, rh);
      }
    }
    ctx.restore();
  }

  /** Remembers the lamps of something just drawn at (sx, top..bottom). */
  private addLamps(r: Renderable, sx: number, roadY: number, destW: number, destH: number, lift: number, fog: number) {
    if (!r.lamp || fog < 0.08) return;
    const k = Math.min(1, fog * 1.4);
    const base = roadY - lift;
    if (r.lamp === 'car') {
      const facing = r.facing;
      const y = base - destH * (facing ? 0.3 : 0.36);
      const color = facing ? `rgba(255,248,215,${0.95 * k})` : `rgba(255,40,30,${0.9 * k})`;
      const rr = Math.max(2, destW * (facing ? 0.16 : 0.09));
      for (const dx of [-0.36, 0.36]) this.lights.push({ x: sx + destW * dx, y, r: rr, color, cut: facing ? 0.9 : 0.4 });
    } else if (r.lamp === 'bike' || r.lamp === 'cop' || r.lamp === 'player') {
      if (r.facing) this.lights.push({ x: sx, y: base - destH * 0.42, r: Math.max(2.5, destW * 0.28), color: `rgba(255,248,215,${k})`, cut: 0.95 });
      else this.lights.push({ x: sx, y: base - destH * 0.3, r: Math.max(2, destW * 0.12), color: `rgba(255,40,30,${0.9 * k})`, cut: 0.5 });
      if (r.lamp === 'cop') {
        const on = Math.floor(this.time * 7) % 2 === 0;
        this.lights.push({ x: sx + destW * (on ? -0.2 : 0.2), y: base - destH * 0.62, r: Math.max(3, destW * 0.3), color: on ? `rgba(255,40,40,${k})` : `rgba(50,110,255,${k})`, cut: 0.7 });
      }
      if (r.lamp === 'player') this.playerScreen = { x: sx, y: base - destH * 0.1, w: destW };
    }
  }

  // --- background --------------------------------------------------------------------------
  private drawBackground(ctx: CanvasRenderingContext2D, track: Track) {
    const c = track.def.colors;
    const { W, H, horizonY } = this;
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, c.sky);
    sky.addColorStop(1, c.fog);
    ctx.fillStyle = sky;
    ctx.fillRect(-W, -H, W * 3, H * 3);
    // distant ground: each side's own ground colour (sea on the Pacific side), heavily fogged,
    // split where the road vanishes (remembered from the previous frame)
    const band = (color: string, x0: number, x1: number) => {
      const g = ctx.createLinearGradient(0, horizonY, 0, H);
      g.addColorStop(0, this.fogged(color, c.fog, 0.35));
      g.addColorStop(1, this.fogged(color, c.fog, 0.8));
      ctx.fillStyle = g;
      ctx.fillRect(x0, horizonY, x1 - x0, H * 2);
    };
    const split = Math.max(0, Math.min(W, this.farX[this.dir]));
    const [left, right] = this.dir > 0 ? [c.groundL[0], c.groundR[0]] : [c.groundR[0], c.groundL[0]];
    band(left, -W, split);
    band(right, split, W * 2);

    // backdrop: only the part above its own horizon line, scrolled with the curves.
    // Looking back shows the other half of the panorama.
    const bg = this.assets.get(track.def.bg);
    const horizon = bg.horizon ?? 0.6;
    const s = (horizonY + 70 * (H / VIEW_HEIGHT)) / (horizon * bg.h);
    const w = bg.w * s, hAbove = horizon * bg.h * s;
    const top = horizonY - hAbove;
    const scroll = this.bgScroll + (this.dir > 0 ? 0 : 0.5);
    let ox = -(((scroll * w) % w) + w) % w - w;
    if (this.weather === 'night') this.drawNightSky(ctx, scroll);
    if (this.weather === 'dusk') {
      // a low sun glow behind the hills
      const sx = W * 0.5 - (((scroll * 1.7) % 1) - 0.5) * W * 0.2;
      const rg = ctx.createRadialGradient(sx, horizonY, 0, sx, horizonY, W * 0.45);
      rg.addColorStop(0, 'rgba(255,190,110,0.85)');
      rg.addColorStop(1, 'rgba(255,120,80,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, horizonY + 2);
    }
    const m = this.assets.mip(bg, w);
    for (; ox < W * 2; ox += w) ctx.drawImage(m.img, 0, 0, bg.w * m.k, bg.h * horizon * m.k, ox, top, w + 1, hAbove + 1);
    // the backdrop art is painted in daylight: tint it for the conditions
    const tint = this.weather === 'night' ? 'rgba(6,10,30,0.74)' : this.weather === 'dusk' ? 'rgba(150,60,40,0.3)' : this.weather === 'rain' ? 'rgba(78,88,100,0.45)' : '';
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(-W, top - 2, W * 3, hAbove + 4);
    }
    if (this.weather === 'dusk') {
      // low sun: warm light washing over the hills from the horizon up
      const wash = ctx.createLinearGradient(0, top, 0, horizonY);
      wash.addColorStop(0, 'rgba(255,140,60,0)');
      wash.addColorStop(1, 'rgba(255,140,60,0.35)');
      ctx.fillStyle = wash;
      ctx.fillRect(-W, top, W * 3, hAbove + 2);
    }
  }

  /** Stars and a moon (drawn before the backdrop so hills hide them). */
  private drawNightSky(ctx: CanvasRenderingContext2D, scroll: number) {
    const { W, horizonY } = this;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const shift = ((scroll * W * 1.5) % W + W) % W;
    for (let i = 0; i < 140; i++) {
      const x = (rnd() * W - shift + W) % W, y = rnd() * horizonY * 0.95;
      const b = 0.35 + rnd() * 0.65;
      const tw = 0.75 + 0.25 * Math.sin(this.time * (1 + rnd() * 3) + i);
      ctx.fillStyle = `rgba(230,236,255,${b * tw})`;
      const sz = rnd() < 0.08 ? 2 : 1.2;
      ctx.fillRect(x, y, sz, sz);
    }
    const mx = (W * 0.78 - shift * 0.5 + W) % W, my = horizonY * 0.28, mr = Math.max(8, W * 0.022);
    const glow = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 5);
    glow.addColorStop(0, 'rgba(200,215,255,0.35)');
    glow.addColorStop(1, 'rgba(200,215,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
    ctx.fillStyle = '#eef1fa';
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,170,200,0.35)';
    ctx.beginPath();
    ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.25, 0, Math.PI * 2);
    ctx.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- road ----------------------------------------------------------------------------
  private drawSegment(ctx: CanvasRenderingContext2D, vs: ViewSeg, c: Track['def']['colors']) {
    const seg = vs.seg;
    const { x: x1, y: y1, w: w1 } = vs.near;
    const { x: x2, y: y2, w: w2 } = vs.far;
    const k = seg.dark ? 1 : 0;
    const fog = vs.fog;
    const L = -this.W, R = this.W * 2; // generous so a rolled camera never shows gaps
    const poly = (color: string, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.lineTo(dx, dy);
      ctx.closePath();
      ctx.fill();
    };
    const yb = y1 + 1; // overlap by a pixel to hide seams
    const [gl, gr] = this.dir > 0 ? [c.groundL, c.groundR] : [c.groundR, c.groundL];
    poly(this.fogged(gl[k], c.fog, fog), L, y2, x2, y2, x1, yb, L, yb);
    poly(this.fogged(gr[k], c.fog, fog), x2, y2, R, y2, R, yb, x1, yb);
    const r1 = w1 / 14, r2 = w2 / 14;
    poly(this.fogged(c.rumble[k], c.fog, fog), x1 - w1 - r1, yb, x1 - w1, yb, x2 - w2, y2, x2 - w2 - r2, y2);
    poly(this.fogged(c.rumble[k], c.fog, fog), x1 + w1 + r1, yb, x1 + w1, yb, x2 + w2, y2, x2 + w2 + r2, y2);
    poly(this.fogged(c.road[k], c.fog, fog), x1 - w1, yb, x1 + w1, yb, x2 + w2, y2, x2 - w2, y2);
    if (!seg.dark) {
      const l1 = w1 / 50, l2 = w2 / 50;
      poly(this.fogged(c.lane, c.fog, fog), x1 - l1, yb, x1 + l1, yb, x2 + l2, y2, x2 - l2, y2);
    }
    // edge lines
    const e1 = w1 / 70, e2 = w2 / 70;
    const edge = this.fogged('#e8e8e8', c.fog, fog);
    poly(edge, x1 - w1 * 0.94 - e1, yb, x1 - w1 * 0.94 + e1, yb, x2 - w2 * 0.94 + e2, y2, x2 - w2 * 0.94 - e2, y2);
    poly(edge, x1 + w1 * 0.94 - e1, yb, x1 + w1 * 0.94 + e1, yb, x2 + w2 * 0.94 + e2, y2, x2 + w2 * 0.94 - e2, y2);
    if (seg.line) this.drawLine(ctx, x1, yb, w1, x2, y2, w2, seg.line);
  }

  private drawLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, w1: number, x2: number, y2: number, w2: number, kind: 'start' | 'finish') {
    const cells = 16;
    for (let i = 0; i < cells; i++) {
      for (let row = 0; row < 2; row++) {
        if ((i + row) % 2 === 0) continue;
        const t0 = i / cells, t1 = (i + 1) / cells;
        const ya = row === 0 ? y1 : (y1 + y2) / 2, yb = row === 0 ? (y1 + y2) / 2 : y2;
        const xa0 = x1 - w1 + 2 * w1 * t0, xa1 = x1 - w1 + 2 * w1 * t1;
        const xb0 = x2 - w2 + 2 * w2 * t0, xb1 = x2 - w2 + 2 * w2 * t1;
        ctx.fillStyle = kind === 'finish' ? '#111' : '#f4f4f4';
        ctx.beginPath();
        ctx.moveTo(xa0, ya);
        ctx.lineTo(xa1, ya);
        ctx.lineTo(xb1, yb);
        ctx.lineTo(xb0, yb);
        ctx.fill();
      }
    }
  }

  /** Continuous guard rail drawn as geometry (a row of billboards would look like panels). */
  private drawRail(ctx: CanvasRenderingContext2D, vs: ViewSeg, offset: number, fogColor: string) {
    const a = vs.near, b = vs.far;
    const xa = a.x + a.w * offset, xb = b.x + b.w * offset;
    const ha = 330 * a.scale * this.halfW, hb = 330 * b.scale * this.halfW;
    ctx.fillStyle = this.fogged(vs.seg.dark ? '#8e969c' : '#aab2b8', fogColor, vs.fog);
    ctx.beginPath();
    ctx.moveTo(xa, a.y - ha * 0.55);
    ctx.lineTo(xb, b.y - hb * 0.55);
    ctx.lineTo(xb, b.y - hb);
    ctx.lineTo(xa, a.y - ha);
    ctx.fill();
    if (vs.seg.index % 2 === 0) {
      ctx.fillStyle = this.fogged('#5a4a3a', fogColor, vs.fog);
      const pw = Math.max(1, 40 * a.scale * this.halfW);
      ctx.fillRect(xa - pw / 2, a.y - ha, pw, ha);
    }
  }

  /**
   * Builds every mipmap and tinted rider frame this race will need up front, so nothing gets
   * generated (and hitches a frame) the first time it scrolls into view.
   */
  warmUp(race: Race): number {
    const t0 = performance.now();
    const warm = (s: Sprite) => this.assets.mip(s, 8);
    const seen = new Set<string>();
    for (const seg of race.track.segments) {
      for (const p of seg.props) {
        const key = p.sprite + (p.flip ? '~' : '');
        if (seen.has(key)) continue;
        seen.add(key);
        warm(p.flip ? this.assets.flipped(p.sprite) : this.assets.get(p.sprite));
      }
    }
    for (const id of Object.keys(CAR_FLIP)) warm(this.assets.get(id));
    for (const id of ['props/flagmanUp', 'props/flagmanDown']) warm(this.assets.get(id));
    const frames = ['ride', 'punchL', 'punchR', 'kickL', 'kickR', 'clubL', 'clubR', 'tumble', 'bikeDown', 'down', 'front'];
    for (const r of race.riders) for (const f of frames) warm(this.riderSprite(r, f));
    // every rider can pick up any weapon mid-race: build the chain / crowbar frames now
    for (const r of race.riders) for (const f of ['chainL', 'chainR', 'crowbarL', 'crowbarR']) if (!r.isCop) warm(this.frameSprite(r, f));
    for (const h of race.humans) for (const f of ['down', 'runBack1', 'runBack2', 'runFront1', 'runFront2']) warm(this.riderSprite(h, f));
    warm(this.assets.get(race.track.def.bg));
    return performance.now() - t0;
  }

  // --- sprites -------------------------------------------------------------------------
  private bucketEntities(race: Race) {
    this.buckets.clear();
    const push = (r: Renderable) => {
      const i = Math.floor(r.z / SEGMENT_LENGTH);
      if (!this.vsegs.has(i)) return;
      let b = this.buckets.get(i);
      if (!b) this.buckets.set(i, (b = []));
      b.push(r);
    };
    for (const c of race.traffic.cars) {
      const id = this.dir > 0 ? c.type.sprite : (CAR_FLIP[c.type.sprite] ?? c.type.sprite);
      push({ z: c.z, x: c.x, h: 0, sprite: this.assets.get(id), worldH: c.type.height, shadow: c.type.width * 1.3, lamp: 'car', facing: c.oncoming !== this.dir < 0 });
    }
    for (const r of race.riders) {
      if (r === this.self && this.hidePlayer) continue;
      for (const item of this.riderRenderables(r, race)) push(item);
    }
  }

  /** pixels->world scale for a rider design, from its upright riding frame */
  private designScale(design: string): number {
    let s = this.rideScale.get(design);
    if (!s) {
      s = RIDER_HEIGHT / this.assets.get(`riders/${design}/ride`).h;
      this.rideScale.set(design, s);
    }
    return s;
  }

  private riderSprite(r: Racer, frame: string): Sprite {
    const id = `riders/${r.design}/${frame}`;
    const finalId = this.assets.has(id) ? id : `riders/${r.design}/ride`;
    return r.hue ? this.assets.tinted(finalId, r.hue) : this.assets.get(finalId);
  }

  /** A rider frame; chain / crowbar swings are made from the club swing on the fly. */
  private frameSprite(r: Racer, frame: string): Sprite {
    const m = /^(chain|crowbar)([LR])$/.exec(frame);
    if (!m) return this.riderSprite(r, frame);
    return this.assets.weaponFrame(this.riderSprite(r, `club${m[2]}`), this.riderSprite(r, 'ride'), this.riderSprite(r, `punch${m[2]}`), m[1] as 'chain' | 'crowbar');
  }

  private riderRenderables(r: Racer, race: Race): Renderable[] {
    const out: Renderable[] = [];
    const bias = r.isPlayer ? -1 : 0;
    if (r.onBike || (r.isCop && !r.crash)) {
      let frame = 'ride';
      let headlight = false;
      if (this.dir < 0) {
        // seen from the front: a front-view frame if one exists, else the riding frame + headlight
        if (this.assets.has(`riders/${r.design}/front`)) frame = 'front';
        else headlight = true;
      } else {
        const a = r.attack;
        if (a && a.t > 0.03 && a.t < a.duration - 0.04) {
          const kind = r.isCop && a.kind === 'kick' ? 'punch' : a.kind;
          frame = `${kind}${a.side < 0 ? 'L' : 'R'}`;
        }
      }
      const base = this.frameSprite(r, frame);
      // no front-view art: show the rider as a dark, backlit silhouette behind a headlight
      const sprite = headlight ? this.assets.shaded(base) : base;
      const worldH = sprite.h * this.designScale(r.design);
      const h = r.y - race.track.heightAt(r.z);
      const wobble = r.hitStun > 0 ? Math.sin(r.hitStun * 60) * 0.06 : 0;
      const lamp = r === this.self ? 'player' : r.isCop && (r.copState === 'chase' || r.copState === 'arrest') ? 'cop' : 'bike';
      out.push({ z: r.z, x: r.x, h, sprite, worldH, rot: (r.lean + wobble) * this.dir, flash: r.hitFlash > 0, shadow: 0.17, bias, headlight: headlight && !this.wx.lights, lamp, facing: this.dir < 0 });
      return out;
    }
    const c = r.crash;
    if (!c) return out;
    // the bike, lying where it slid
    const bikeSprite = this.riderSprite(r, 'bikeDown');
    out.push(this.bodyRenderable(c.bike, bikeSprite, 1050, c.bike.landed && c.bike.h < 1 ? 0 : c.bike.rot, bias));
    // the rider
    if (r.state === 'running' && r.isPlayer) {
      const standing = !r.runPhase;
      const back = r.runDir > 0;
      const frame = back ? (Math.floor(r.runPhase) % 2 ? 'runBack2' : 'runBack1') : Math.floor(r.runPhase) % 2 ? 'runFront2' : 'runFront1';
      const s = this.riderSprite(r, standing ? 'runBack1' : frame);
      out.push({ z: c.rider.z, x: c.rider.x, h: Math.abs(Math.sin(r.runPhase * Math.PI)) * 40, sprite: s, worldH: 780, shadow: 0.12, bias });
    } else if ((r.state === 'down' || r.state === 'running' || r.state === 'out') && r.isPlayer) {
      out.push(this.bodyRenderable(c.rider, this.riderSprite(r, 'down'), 950, 0, bias));
    } else if ((r.state === 'down' || r.state === 'out') && this.assets.has(`riders/${r.design}/down`)) {
      // rivals lying in the road after the tumble has stopped
      out.push(this.bodyRenderable(c.rider, this.riderSprite(r, 'down'), 950, 0, bias));
    } else {
      const s = this.riderSprite(r, 'tumble');
      out.push(this.bodyRenderable(c.rider, s, 900, c.rider.h < 1 && Math.abs(c.rider.vrot) < 1 ? 0 : c.rider.rot, bias));
    }
    return out;
  }

  private bodyRenderable(b: Body, sprite: Sprite, worldW: number, rot: number, bias: number): Renderable {
    const worldH = (worldW * sprite.h) / sprite.w;
    return { z: b.z, x: b.x, h: b.h, sprite, worldH, rot, centerPivot: true, shadow: 0.16, bias };
  }

  private drawRenderable(ctx: CanvasRenderingContext2D, r: Renderable, home: ViewSeg) {
    const vs = this.vsegs.get(Math.floor(r.z / SEGMENT_LENGTH)) ?? home;
    if (vs.near.cz <= 1) return;
    const t = (r.z - vs.nearZ) / (vs.farZ - vs.nearZ);
    const p1 = vs.near, p2 = vs.far;
    const halfW = this.halfW;
    const scale = p1.scale + (p2.scale - p1.scale) * t;
    const roadX = p1.x + (p2.x - p1.x) * t;
    const roadY = p1.y + (p2.y - p1.y) * t;
    const sx = roadX + scale * r.x * this.dir * ROAD_WIDTH * halfW;
    const destH = r.worldH * scale * halfW;
    if (destH < 1.5) return;
    const s = r.sprite;
    const destW = (destH * s.w) / s.h;
    const lift = r.h * scale * halfW;
    const clipY = home.clip;
    const fog = vs.fog;

    if (r.shadow) {
      const sw = r.shadow * ROAD_WIDTH * scale * halfW;
      ctx.fillStyle = `rgba(0,0,0,${0.22 * fog})`;
      ctx.beginPath();
      ctx.ellipse(sx, roadY, sw, Math.max(1, sw * 0.18), 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const ax = (s.ax / s.w) * destW, ay = (s.ay / s.h) * destH;
    const destX = sx - ax;
    const destY = roadY - lift - ay;
    if (destY > clipY) return;
    if (r.poles) {
      const pw = Math.max(2, destW * 0.022);
      const bottom = Math.min(roadY, clipY);
      ctx.fillStyle = '#3b4048';
      for (const fx of [0.045, 0.955]) ctx.fillRect(destX + destW * fx - pw / 2, destY + destH - 2, pw, bottom - (destY + destH) + 2);
    }
    ctx.globalAlpha = (r.alpha ?? 1) * Math.min(1, fog * 1.6);
    const m = this.assets.mip(s, destW);
    const img = m.img;
    if (r.rot) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-this.W, -this.H, this.W * 3, clipY + this.H);
      ctx.clip();
      if (r.centerPivot) {
        ctx.translate(destX + destW / 2, destY + destH / 2);
        ctx.rotate(r.rot);
        ctx.drawImage(img, -destW / 2, -destH / 2, destW, destH);
      } else {
        ctx.translate(sx, roadY - lift);
        ctx.rotate(r.rot);
        ctx.drawImage(img, -ax, -ay, destW, destH);
      }
      if (r.flash) this.flash(ctx, img, r.centerPivot ? -destW / 2 : -ax, r.centerPivot ? -destH / 2 : -ay, destW, destH);
      ctx.restore();
    } else {
      const clipH = Math.max(0, destY + destH - clipY);
      if (clipH >= destH) {
        ctx.globalAlpha = 1;
        return;
      }
      const srcH = s.h * m.k * (1 - clipH / destH);
      ctx.drawImage(img, 0, 0, s.w * m.k, srcH, destX, destY, destW, destH - clipH);
      if (r.flash) this.flash(ctx, img, destX, destY, destW, destH - clipH);
    }
    if (this.wx.lights) this.addLamps(r, sx, roadY, destW, destH, lift, fog);
    if (r.headlight) {
      // a bright headlight where the tail light would be: reads as "coming at you"
      const hx = sx, hy = roadY - lift - destH * 0.42, hr = Math.max(2.5, destW * 0.2);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr * 2.2);
      g.addColorStop(0, 'rgba(255,252,225,1)');
      g.addColorStop(0.3, 'rgba(255,240,170,0.75)');
      g.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hx, hy, hr * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    if (this.showDebug) {
      ctx.strokeStyle = 'lime';
      ctx.strokeRect(destX, destY, destW, destH);
    }
  }

  private flash(ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(img, x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // --- particles (sparks, dust) ------------------------------------------------------------
  spawn(p: Omit<Particle, 'life'>) {
    this.particles.push({ ...p, life: p.max });
  }

  updateParticles(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.z += p.vz * dt;
      p.x += p.vx * dt;
      p.vh -= 4000 * dt;
      p.h = Math.max(0, p.h + p.vh * dt);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private drawParticles(ctx: CanvasRenderingContext2D, cam: Camera) {
    for (const p of this.particles) {
      const vs = this.vsegs.get(Math.floor(p.z / SEGMENT_LENGTH));
      if (!vs || !vs.visible || vs.near.cz <= 1 || (p.z - cam.z) * this.dir < 200) continue;
      const t = (p.z - vs.nearZ) / (vs.farZ - vs.nearZ);
      const a = vs.near, b = vs.far;
      const scale = a.scale + (b.scale - a.scale) * t;
      const x = a.x + (b.x - a.x) * t + scale * p.x * this.dir * ROAD_WIDTH * this.halfW;
      const y = a.y + (b.y - a.y) * t - p.h * scale * this.halfW;
      const size = Math.max(1.5, p.size * scale * this.halfW);
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }
}
