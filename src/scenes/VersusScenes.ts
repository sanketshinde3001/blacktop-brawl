/**
 * Two players, one screen (split top / bottom, like the 16-bit sequels): a setup screen, the
 * split-screen race and the result. Player 1 rides the top half, player 2 the bottom.
 * Controls: P1 = W A S D + Q / E hit, R kick, Left Shift nitro (or gamepad 1);
 *           P2 = I J K L or arrows + U / O hit, H kick, N or Right Shift nitro (or gamepad 2).
 */
import { HEIGHT, MPH, ROAD_WIDTH, WIDTH } from '../config';
import { bikeById, SHOP_BIKES } from '../data/bikes';
import { levelDef } from '../data/levels';
import { TRACKS, trackById } from '../data/tracks';
import { WEATHER, type Weather } from '../data/weather';
import type { EngineSound } from '../engine/Audio';
import type { Game } from '../engine/Game';
import type { Seat } from '../engine/Input';
import { clamp, formatTime, ordinal, smooth } from '../engine/math';
import { rand, randPick } from '../engine/Rng';
import { Scene } from '../engine/Scene';
import { NO_CONTROLS, Race, type Controls, type RaceEvent } from '../race/Race';
import type { Racer } from '../race/Racer';
import { RoadRenderer, type Camera } from '../race/Renderer';
import { WeatherFx } from '../race/WeatherFx';
import { blink, COLORS, cover, drawSprite, panel, text, vignette } from '../ui/draw';
import { Menu } from '../ui/Menu';

export interface VersusSettings {
  track: string;
  weather: Weather | 'random';
  bikes: [string, string];
  rivals: number;
  level: number;
}

const RIVAL_OPTIONS = [13, 6, 0];
const WEATHERS: (Weather | 'random')[] = ['day', 'dusk', 'night', 'rain', 'random'];
const P_COLORS = ['#ff4a3a', '#3ee06a'];
const HALF = HEIGHT / 2;
const STRIP = 54;
const VIEW_H = HALF - STRIP;

let last: VersusSettings = { track: 'sierra', weather: 'day', bikes: ['raptor', 'raptor'], rivals: 13, level: 2 };

export class VersusSetupScene extends Scene {
  private menu: Menu;
  private s: VersusSettings = { ...last, bikes: [...last.bikes] as [string, string] };

  constructor(game: Game) {
    super(game);
    const s = this.s;
    const cycle = <T,>(list: readonly T[], v: T, d: number) => list[(list.indexOf(v) + d + list.length) % list.length];
    const bikeIds = SHOP_BIKES.map((b) => b.id);
    this.menu = new Menu(
      [
        { label: 'ROAD', value: () => trackById(s.track).name.toUpperCase(), onAdjust: (d) => (s.track = cycle(TRACKS.map((t) => t.id), s.track, d)) },
        { label: 'CONDITIONS', value: () => (s.weather === 'random' ? 'RANDOM' : WEATHER[s.weather].label), onAdjust: (d) => (s.weather = cycle(WEATHERS, s.weather, d)) },
        { label: 'P1 BIKE', value: () => bikeById(s.bikes[0]).name.toUpperCase(), onAdjust: (d) => (s.bikes[0] = cycle(bikeIds, s.bikes[0], d)) },
        { label: 'P2 BIKE', value: () => bikeById(s.bikes[1]).name.toUpperCase(), onAdjust: (d) => (s.bikes[1] = cycle(bikeIds, s.bikes[1], d)) },
        { label: 'RIVALS', value: () => (s.rivals ? `${s.rivals} RIDERS` : 'NONE - JUST YOU TWO'), onAdjust: (d) => (s.rivals = cycle(RIVAL_OPTIONS, s.rivals, d)) },
        { label: 'RIVAL SPEED', value: () => `LEVEL ${s.level}`, onAdjust: (d) => (s.level = clamp(s.level + d, 1, 5)) },
        { label: 'START RACE', onSelect: () => this.start() },
        { label: 'BACK', onSelect: () => this.game.go('menu') },
      ],
      game,
    );
    this.menu.index = 6;
  }

  private start() {
    last = { ...this.s, bikes: [...this.s.bikes] as [string, string] };
    this.game.go('versusrace', last);
  }

  enter() {
    this.game.audio.playMusic('music/menu');
  }

  update() {
    this.menu.update();
    if (this.game.input.pressed('back')) this.game.go('menu');
  }

  render(ctx: CanvasRenderingContext2D) {
    cover(ctx, this.game.assets.get('ui/lounge'), 0.45);
    vignette(ctx, 0.85);
    text(ctx, '2 PLAYERS', WIDTH / 2, 80, { size: 72, font: 'title', align: 'center', color: COLORS.yellow, outline: 9 });
    text(ctx, 'SPLIT SCREEN  -  ONE KEYBOARD OR TWO GAMEPADS', WIDTH / 2, 114, { size: 10, align: 'center', color: '#ccc', outline: 3 });
    panel(ctx, 70, 140, 700, 430);
    this.menu.render(ctx, 420, 196, { time: this.time, spacing: 46, size: 14, width: 560 });
    // bikes preview
    for (let k = 0; k < 2; k++) {
      const img = this.game.assets.get(`bikes/${this.s.bikes[k]}`);
      const x = 820, y = 150 + k * 210;
      panel(ctx, x - 10, y, 420, 196, P_COLORS[k]);
      text(ctx, `PLAYER ${k + 1}`, x + 10, y + 30, { size: 14, color: P_COLORS[k] });
      if (!img.placeholder) drawSprite(ctx, img, x + 110, y + 40, 200);
      text(ctx, k === 0 ? 'W A S D   Q/E HIT   R KICK   L-SHIFT NOS' : 'I J K L / ARROWS   U/O HIT   H KICK   N NOS', x + 200, y + 184, { size: 7, align: 'center', color: '#bbb' });
    }
    if (this.game.touch.enabled) text(ctx, 'NEEDS A KEYBOARD OR TWO GAMEPADS', WIDTH / 2, 610, { size: 12, align: 'center', color: COLORS.red, outline: 4 });
    text(ctx, '▲ ▼ CHOOSE   ◀ ▶ CHANGE   ENTER START   ESC BACK', WIDTH / 2, HEIGHT - 30, { size: 9, align: 'center', color: '#aaa' });
  }
}

interface Message {
  text: string;
  color: string;
  size: number;
  t: number;
  dur: number;
}

/** One player's half of the screen. */
class PlayerView {
  cam: Camera = { x: 0, y: 0, z: 0 };
  camBack = 0;
  lastCamZ = 0;
  shake = 0;
  messages: Message[] = [];
  knockouts = 0;
  engine: EngineSound | null = null;
  constructor(public racer: Racer, public seat: Seat, public index: number) {}

  say(t: string, color: string = COLORS.yellow, size = 26, dur = 1.6) {
    this.messages = this.messages.filter((m) => m.size < 60);
    this.messages.push({ text: t, color, size, t: 0, dur });
  }
}

/** framed for the short half-height view: lower, a bit further back and wider */
const CAM = { fov: 84, height: 760, distance: 2700, horizon: 0.3 };

export class VersusRaceScene extends Scene {
  race: Race;
  private renderer: RoadRenderer;
  private views: PlayerView[];
  private fx: WeatherFx;
  private paused = false;
  private pauseMenu: Menu;
  private done = false;

  constructor(game: Game, private s: VersusSettings) {
    super(game);
    const weather: Weather = s.weather === 'random' ? randPick<Weather>(['day', 'dusk', 'night', 'rain']) : s.weather;
    this.race = new Race({
      track: trackById(s.track),
      level: levelDef(s.level),
      bike: bikeById(s.bikes[0]),
      difficulty: 'normal',
      playerName: 'P1',
      second: { name: 'P2', bike: bikeById(s.bikes[1]) },
      rivals: s.rivals,
      weather,
      nitro: 2,
      aspect: (id) => {
        const sp = game.assets.get(id);
        return sp.w / sp.h;
      },
    });
    this.renderer = new RoadRenderer(game.assets);
    this.fx = new WeatherFx(weather);
    this.views = [new PlayerView(this.race.player, game.input.seat(0), 0), new PlayerView(this.race.player2!, game.input.seat(1), 1)];
    for (const v of this.views) {
      v.cam.z = v.racer.z - CAM.distance;
      v.cam.x = v.racer.x * ROAD_WIDTH;
      v.cam.y = this.race.track.heightAt(v.racer.z) + CAM.height;
      v.lastCamZ = v.cam.z;
    }
    this.pauseMenu = new Menu(
      [
        { label: 'RESUME', onSelect: () => (this.paused = false) },
        { label: 'QUIT RACE', onSelect: () => this.game.go('versus') },
      ],
      game,
    );
  }

  enter() {
    this.renderer.warmUp(this.race);
    const a = this.game.audio;
    a.playMusic(this.race.track.def.music);
    for (const v of this.views) v.engine = a.createEngine();
    a.play('sfx/crowd', { volume: 0.7 });
  }

  exit() {
    for (const v of this.views) v.engine?.stop();
  }

  onHide() {
    if (this.race.phase !== 'over') this.paused = true;
  }

  private controls(v: PlayerView): Controls {
    const i = v.seat;
    return {
      steer: i.axisX(),
      throttle: i.isDown('throttle') ? 1 : 0,
      brake: i.isDown('brake') ? 1 : 0,
      attackL: i.pressed('attackL'),
      attackR: i.pressed('attackR'),
      kick: i.pressed('kick'),
      nitro: i.pressed('nitro'),
      runX: i.axisX(),
      runZ: (i.isDown('up') ? 1 : 0) - (i.isDown('down') ? 1 : 0),
    };
  }

  update(dt: number) {
    const input = this.game.input;
    if (input.pressed('pause') && this.race.phase !== 'over') {
      this.paused = !this.paused;
      this.pauseMenu.index = 0;
      return;
    }
    if (this.paused) {
      this.pauseMenu.update();
      return;
    }
    const [a, b] = this.views;
    this.race.update(dt, a.racer.out ? NO_CONTROLS : this.controls(a), b.racer.out ? NO_CONTROLS : this.controls(b));
    for (const e of this.race.events) this.onEvent(e);
    this.race.events.length = 0;
    for (const v of this.views) {
      this.updateCamera(v, dt);
      for (const m of v.messages) m.t += dt;
      v.messages = v.messages.filter((m) => m.t < m.dur);
      v.shake = Math.max(0, v.shake - dt * 2.5);
      const p = v.racer;
      const { rpm } = p.gearRpm();
      v.engine?.update(p.onBike ? rpm : 900, p.onBike ? p.throttle : 0, p.onBike ? 0.6 : 0.15);
    }
    this.renderer.updateParticles(dt);
    const sp = Math.max(...this.views.map((v) => (v.racer.onBike ? v.racer.speed / v.racer.topSpeed : 0)));
    this.fx.update(dt, clamp(sp, 0, 1), false);
    if (this.fx.struck) setTimeout(() => this.game.audio.play('sfx/thunder', { volume: 0.9 }), 400);
    if (this.race.phase === 'over' && !this.done) this.finish();
  }

  private updateCamera(v: PlayerView, dt: number) {
    const p = v.racer;
    let focusZ = p.z, focusX = p.x, back = 0;
    if (p.crash) {
      const bk = p.crash.bike, body = p.crash.rider;
      focusZ = Math.max(Math.min(bk.z, body.z), body.z - 5000);
      focusX = Math.abs(bk.z - body.z) < 5000 ? (bk.x + body.x) / 2 : body.x;
      back = 650 + Math.min(1500, Math.abs(bk.z - body.z) * 0.25);
    }
    v.camBack = smooth(v.camBack, back, 3, dt);
    const targetZ = focusZ - CAM.distance - v.camBack;
    v.cam.z = p.crash ? smooth(v.cam.z, targetZ, 5, dt) : targetZ;
    v.cam.x = smooth(v.cam.x, focusX * ROAD_WIDTH * 0.8, 8, dt);
    const track = this.race.track;
    const ground = p.airborne ? p.y : track.heightAt(focusZ);
    v.cam.y = smooth(v.cam.y, Math.max(ground, track.heightAt(v.cam.z) + 250) + CAM.height + v.camBack * 0.35, 16, dt);
  }

  private viewOf(r: Racer | undefined): PlayerView | undefined {
    return this.views.find((v) => v.racer === r);
  }

  private onEvent(e: RaceEvent) {
    const a = this.game.audio;
    switch (e.type) {
      case 'countdown':
        a.blip(440, 0.18, 'square', 0.3);
        for (const v of this.views) v.say(String(e.n), COLORS.yellow, 70, 0.9);
        break;
      case 'go':
        a.blip(880, 0.4, 'square', 0.3);
        for (const v of this.views) v.say('GO!', COLORS.green, 80, 1.1);
        break;
      case 'hit': {
        const { hit } = e;
        const id = hit.kind === 'chain' ? 'sfx/chain' : hit.kind === 'club' || hit.kind === 'crowbar' ? 'sfx/club' : hit.kind === 'kick' ? 'sfx/kick' : 'sfx/punch';
        const near = this.views.some((v) => Math.abs(v.racer.z - hit.target.z) < 4000);
        if (near) a.play(id, { volume: 0.8, rate: rand(0.9, 1.1) });
        const tv = this.viewOf(hit.target);
        if (tv) tv.shake = Math.max(tv.shake, 0.35);
        const av = this.viewOf(hit.attacker);
        if (av && hit.knockedOff) {
          av.knockouts++;
          av.say(hit.target.isPlayer ? `YOU DECKED ${hit.target.name}!` : `DECKED ${hit.target.name.toUpperCase()}!`, COLORS.green, 24);
        }
        if (av && hit.stole) av.say(`GOT A ${(hit.attacker.weapon ?? 'club').toUpperCase()}!`, COLORS.orange, 24);
        break;
      }
      case 'crash': {
        const v = this.viewOf(e.racer);
        if (this.views.some((w) => Math.abs(w.racer.z - e.racer.z) < 5000)) a.play(e.cause === 'car' || e.cause === 'headon' ? 'sfx/carCrash' : 'sfx/crash', { volume: 0.8 });
        if (v) (v.shake = 1), v.say(randPick(['OUCH!', 'WIPEOUT!', 'EAT ASPHALT!']), COLORS.red, 34);
        break;
      }
      case 'nitro': {
        a.play('sfx/nitro', { volume: 0.8 });
        this.viewOf(e.racer)?.say('NITRO!', COLORS.blue, 34, 1);
        break;
      }
      case 'copAlert':
        this.viewOf(e.cop.copTarget ?? undefined)?.say('COPS!', COLORS.blue, 34);
        break;
      case 'bust':
        a.jingle('music/busted');
        this.viewOf(e.racer)?.say('BUSTED!', COLORS.blue, 60, 99);
        break;
      case 'wrecked':
        a.play('sfx/carCrash');
        this.viewOf(e.racer)?.say('WRECKED!', COLORS.red, 60, 99);
        break;
      case 'finish': {
        const v = this.viewOf(e.racer);
        if (v) {
          v.say(`FINISHED ${ordinal(e.place)}`, COLORS.green, 50, 99);
          a.play('sfx/crowd');
        }
        break;
      }
      case 'horn':
        if (this.views.some((v) => Math.abs(v.racer.z - e.car.z) < 6000)) a.play(e.car.type.truck ? 'sfx/truckHorn' : 'sfx/horn', { volume: 0.5 });
        break;
    }
  }

  private finish() {
    this.done = true;
    const r = this.race;
    const results = r.finalResults();
    const rows = this.views.map((v) => {
      const p = v.racer;
      return {
        name: `PLAYER ${v.index + 1}`,
        place: results.findIndex((s) => s.racer === p) + 1,
        time: p.finishTime,
        status: p.out ? p.out.toUpperCase() : p.finishTime !== null ? 'FINISHED' : 'DNF',
        knockouts: v.knockouts,
        bike: bikeById(this.s.bikes[v.index]).name,
      };
    });
    const finishers = rows.filter((x) => x.status === 'FINISHED');
    const winner = finishers.length ? rows.indexOf(finishers.sort((p, q) => p.place - q.place)[0]) : -1;
    this.game.events.emit({ type: 'twoPlayer', winner });
    this.game.go('versusresult', { rows, winner, settings: this.s, track: r.track.def.name, weather: r.weather });
  }

  // --- render ----------------------------------------------------------------------------------
  render(ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingQuality = 'low';
    for (const v of this.views) {
      ctx.save();
      ctx.translate(0, v.index * HALF);
      ctx.beginPath();
      ctx.rect(0, 0, WIDTH, HALF);
      ctx.clip();
      const cam = { ...v.cam };
      if (v.shake > 0) (cam.x += rand(-1, 1) * v.shake * 90), (cam.y += rand(-1, 1) * v.shake * 60);
      const dz = v.cam.z - v.lastCamZ;
      v.lastCamZ = v.cam.z;
      const p = v.racer;
      this.renderer.render(ctx, this.race, cam, dz, { dir: 1, width: WIDTH, height: VIEW_H, fov: CAM.fov, horizon: CAM.horizon, particles: true, self: p });
      this.fx.draw(ctx, WIDTH, VIEW_H, WIDTH / 2, VIEW_H * CAM.horizon, p.onBike ? clamp(p.speed / p.topSpeed, 0, 1) : 0);
      if (p.boost > 0.05) this.speedLines(ctx, p.boost);
      this.drawMessages(ctx, v);
      this.drawStrip(ctx, v);
      ctx.restore();
    }
    // divider
    ctx.fillStyle = '#000';
    ctx.fillRect(0, HALF - 3, WIDTH, 6);
    ctx.fillStyle = COLORS.yellow;
    ctx.fillRect(0, HALF - 1, WIDTH, 2);
    this.fx.drawFlash(ctx, WIDTH, HEIGHT);
    if (this.race.phase === 'countdown') {
      text(ctx, `${this.race.track.def.name.toUpperCase()}  -  ${WEATHER[this.race.weather].label}`, WIDTH / 2, HALF + 8, { size: 14, align: 'center', outline: 4, baseline: 'middle' });
    }
    if (this.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      panel(ctx, WIDTH / 2 - 220, 220, 440, 220);
      text(ctx, 'PAUSED', WIDTH / 2, 290, { size: 56, font: 'title', align: 'center', color: COLORS.yellow });
      this.pauseMenu.render(ctx, WIDTH / 2, 350, { time: this.time });
    }
  }

  private speedLines(ctx: CanvasRenderingContext2D, k: number) {
    const cx = WIDTH / 2, vy = VIEW_H * CAM.horizon;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k) * 0.5;
    ctx.strokeStyle = '#e8f4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const phase = (this.time * 2.2 + i * 0.137) % 1;
      const r0 = 80 + phase * 600, r1 = r0 + 50 + phase * 180;
      ctx.moveTo(cx + Math.cos(a) * r0, vy + Math.sin(a) * r0 * 0.5);
      ctx.lineTo(cx + Math.cos(a) * r1, vy + Math.sin(a) * r1 * 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawMessages(ctx: CanvasRenderingContext2D, v: PlayerView) {
    for (const m of v.messages) {
      const k = Math.min(1, m.t * 6);
      ctx.globalAlpha = Math.min(1, (m.dur - m.t) * 3);
      text(ctx, m.text, WIDTH / 2, VIEW_H * 0.42, { size: m.size * (0.6 + 0.4 * k), font: 'title', color: m.color, align: 'center', outline: 7 });
      ctx.globalAlpha = 1;
    }
    const p = v.racer;
    if (p.state === 'running' && p.crash && Math.floor(this.time * 3) % 2 === 0) {
      const dzb = p.crash.bike.z - p.crash.rider.z;
      const dir = Math.abs(dzb) < 300 ? (p.crash.bike.x < p.crash.rider.x ? '◀' : '▶') : dzb > 0 ? '▲' : '▼';
      text(ctx, `GET BACK ON YOUR BIKE ${dir}`, WIDTH / 2, 40, { size: 14, align: 'center', color: COLORS.yellow, outline: 4 });
    }
    // player tag
    ctx.fillStyle = P_COLORS[v.index];
    ctx.beginPath();
    ctx.roundRect(12, 10, 46, 24, 6);
    ctx.fill();
    text(ctx, `P${v.index + 1}`, 35, 28, { size: 12, align: 'center', color: '#000', shadow: false });
  }

  /** Compact dashboard under each half. */
  private drawStrip(ctx: CanvasRenderingContext2D, v: PlayerView) {
    const p = v.racer, r = this.race;
    const y = VIEW_H;
    const g = ctx.createLinearGradient(0, y, 0, HALF);
    g.addColorStop(0, '#23262e');
    g.addColorStop(1, '#0a0b0e');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, WIDTH, STRIP);
    ctx.fillStyle = P_COLORS[v.index];
    ctx.fillRect(0, y, WIDTH, 3);
    const mid = y + STRIP / 2 + 6;
    // speed + gear
    const mph = p.onBike ? Math.round(p.mph) : 0;
    text(ctx, String(mph).padStart(3, ' '), 30, mid + 4, { size: 22, color: '#ffc23a', shadow: false });
    text(ctx, 'MPH', 112, mid + 2, { size: 8, color: '#8d95a3', shadow: false });
    text(ctx, p.onBike ? `G${p.gearRpm().gear}` : 'N', 160, mid + 2, { size: 12, color: '#9dffb0', shadow: false });
    // place
    const place = r.placeOf(p);
    const out = !!p.out;
    text(ctx, out ? p.out!.toUpperCase() : ordinal(place), 250, mid + 4, { size: 18, color: out ? COLORS.red : place <= 4 ? COLORS.yellow : COLORS.white, shadow: false });
    text(ctx, out ? '' : `/${r.racers.length}`, 330, mid + 2, { size: 8, color: '#888', shadow: false });
    // health / bike bars
    const bar = (x: number, yy: number, w: number, f: number, color: string, label: string) => {
      text(ctx, label, x, yy + 9, { size: 7, color: '#9aa3b2', shadow: false });
      ctx.fillStyle = '#050506';
      ctx.fillRect(x + 44, yy, w, 10);
      ctx.fillStyle = color;
      ctx.fillRect(x + 44, yy, w * clamp(f, 0, 1), 10);
    };
    const hp = p.health / p.maxHealth;
    bar(390, y + 12, 200, hp, hp < 0.3 ? COLORS.red : hp < 0.55 ? '#ffc23a' : '#3ee06a', 'RIDER');
    bar(390, y + 30, 200, 1 - p.damage / 100, p.damage > 65 ? COLORS.orange : '#3aa0ff', 'BIKE');
    // nitro + weapon
    for (let i = 0; i < Math.min(5, p.nitroCharges); i++) {
      ctx.fillStyle = '#2f7bff';
      ctx.beginPath();
      ctx.roundRect(650 + i * 13, y + 14, 8, 14, 3);
      ctx.fill();
    }
    if (p.weapon) text(ctx, p.weapon.toUpperCase(), 650, y + 44, { size: 8, color: COLORS.orange, shadow: false });
    // progress: both players and the leader
    const px = 760, pw = 470, py = y + 22;
    ctx.fillStyle = '#3a3d45';
    ctx.fillRect(px, py, pw, 8);
    const leader = r.standings[0];
    if (leader && !leader.isPlayer) {
      ctx.fillStyle = COLORS.yellow;
      ctx.fillRect(px + r.progress(leader) * pw - 2, py - 3, 4, 14);
    }
    this.views.forEach((w) => {
      ctx.fillStyle = P_COLORS[w.index];
      ctx.beginPath();
      ctx.arc(px + r.progress(w.racer) * pw, py + 4, w === v ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
    });
    const miles = (r.track.raceLength * (1 - r.progress(p))) / (MPH * 3600);
    text(ctx, `${miles.toFixed(1)} MI`, px, y + 48, { size: 7, color: '#9aa3b2', shadow: false });
    text(ctx, formatTime(r.time), px + pw, y + 48, { size: 7, align: 'right', color: '#7dffb0', shadow: false });
  }
}

export interface VersusResult {
  rows: { name: string; place: number; time: number | null; status: string; knockouts: number; bike: string }[];
  winner: number;
  settings: VersusSettings;
  track: string;
  weather: Weather;
}

export class VersusResultScene extends Scene {
  constructor(game: Game, private r: VersusResult) {
    super(game);
  }

  enter() {
    this.game.audio.stopMusic(0.3);
    this.game.audio.jingle(this.r.winner >= 0 ? 'music/win' : 'music/lose');
  }

  update() {
    if (this.time < 1) return;
    const i = this.game.input;
    if (i.pressed('confirm')) this.game.go('versusrace', this.r.settings);
    if (i.pressed('back')) this.game.go('versus');
  }

  render(ctx: CanvasRenderingContext2D) {
    const { rows, winner } = this.r;
    cover(ctx, this.game.assets.get(winner >= 0 ? 'ui/victory' : 'ui/wrecked'), 0.55);
    vignette(ctx, 0.8);
    const head = winner >= 0 ? `PLAYER ${winner + 1} WINS!` : 'NOBODY FINISHED!';
    const k = Math.min(1, this.time * 3);
    text(ctx, head, WIDTH / 2, 120, { size: 80 * (0.7 + 0.3 * k), font: 'title', align: 'center', color: winner >= 0 ? P_COLORS[winner] : COLORS.red, outline: 10 });
    text(ctx, `${this.r.track.toUpperCase()}  -  ${WEATHER[this.r.weather].label}`, WIDTH / 2, 160, { size: 12, align: 'center', outline: 4 });
    rows.forEach((row, i) => {
      const x = 140 + i * 520;
      panel(ctx, x, 200, 480, 300, P_COLORS[i]);
      text(ctx, row.name, x + 240, 250, { size: 22, align: 'center', color: P_COLORS[i] });
      const lines: [string, string][] = [
        ['BIKE', row.bike.toUpperCase()],
        ['RESULT', row.status === 'FINISHED' ? ordinal(row.place) : row.status],
        ['TIME', row.time !== null ? formatTime(row.time) : '-'],
        ['RIDERS DECKED', String(row.knockouts)],
      ];
      lines.forEach(([a, b], j) => {
        text(ctx, a, x + 30, 310 + j * 44, { size: 11, color: '#bbb' });
        text(ctx, b, x + 450, 310 + j * 44, { size: 12, align: 'right' });
      });
      if (i === winner) text(ctx, '★ WINNER ★', x + 240, 540, { size: 18, align: 'center', color: COLORS.yellow, outline: 4 });
    });
    if (this.time > 1 && blink(this.time)) text(ctx, 'ENTER: REMATCH    ESC: CHANGE SETUP', WIDTH / 2, HEIGHT - 50, { size: 14, align: 'center', outline: 4 });
  }
}
