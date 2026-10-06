/**
 * The race screen: feeds input into the Race simulation, drives the camera, turns race events
 * into sound / messages / particles, and hands the outcome to the results screen.
 */
import { CAMERA, CAMERA_MODES, CAMERA_ORDER, HEIGHT, MPH, ROAD_WIDTH, VIEW_HEIGHT, WIDTH, type CameraMode } from '../config';
import { bikeById, STARTER_BIKE } from '../data/bikes';
import { levelDef } from '../data/levels';
import { trackById, TRACKS } from '../data/tracks';
import { careerWeather, WEATHER, type Weather } from '../data/weather';
import type { RunRace } from '../game/Runs';
import { WeatherFx } from '../race/WeatherFx';
import type { LoopHandle, EngineSound } from '../engine/Audio';
import type { Game } from '../engine/Game';
import { clamp, ordinal, smooth } from '../engine/math';
import { rand, randPick } from '../engine/Rng';
import { Scene } from '../engine/Scene';
import { Hud } from '../race/Hud';
import { NO_CONTROLS, Race, type Controls, type RaceEvent } from '../race/Race';
import { Cockpit } from '../race/Cockpit';
import { forwardView, RoadRenderer, type Camera } from '../race/Renderer';
import type { PropInstance } from '../race/Track';
import { COLORS, panel, text } from '../ui/draw';
import { Menu } from '../ui/Menu';

export interface RaceParams {
  track: string;
  demo?: boolean;
  /** debug override */
  level?: number;
  /** conditions (default: the career table, random in the attract demo) */
  weather?: Weather;
  /** endless / daily run race (no career involved) */
  run?: RunRace;
}

export interface RaceOutcome {
  track: string;
  kind: 'finished' | 'busted' | 'wrecked' | 'quit';
  place: number;
  time: number;
  results: { id: string; name: string; time: number; finished: boolean; isPlayer: boolean }[];
  knockouts: number;
  level: number;
  weather: Weather;
  /** bike damage at the end (carried over in endless runs) */
  damage: number;
  /** how many times the player came off the bike */
  crashes: number;
  run?: RunRace;
}

interface Message {
  text: string;
  color: string;
  size: number;
  t: number;
  dur: number;
  y: number;
}

export class RaceScene extends Scene {
  race: Race;
  private renderer: RoadRenderer;
  private hud = new Hud(this.game.assets);
  private cockpit = new Cockpit(this.game.assets);
  private cam: Camera = { x: 0, y: CAMERA.height, z: 0 };
  /** exposed for live tweaking from the console */
  readonly cameraRig = CAMERA;
  /** player's chosen camera (V / Select cycles) */
  private mode: CameraMode = 'chase';
  /** 0 = chase-style camera, 1 = fully first person (eased so switching glides) */
  private firstness = 0;
  /** holding the look-back button */
  private lookingBack = false;
  /** rear view rendered every frame for the mirrors (drawn flipped, like a real mirror) */
  private mirror = document.createElement('canvas');
  private camBack = 0;
  private shake = 0;
  private messages: Message[] = [];
  private engine: EngineSound | null = null;
  private gravel: LoopHandle | null = null;
  private siren: LoopHandle | null = null;
  private paused = false;
  private pauseMenu: Menu;
  private knockouts = 0;
  private done = false;
  private lastCamZ = 0;
  private fx: WeatherFx;
  private rainLoop: LoopHandle | null = null;

  constructor(game: Game, private params: RaceParams) {
    super(game);
    const run = params.run;
    const career = run ? null : game.career;
    const demo = !!params.demo || (!career && !run);
    const level = run ? run.level : levelDef(params.level ?? career?.s.level ?? 1);
    const bike = run ? bikeById(run.bike) : demo && !career ? bikeById(randPick(['kestrel', 'raptor', 'banshee'])) : bikeById(career?.s.bike ?? STARTER_BIKE);
    const trackIndex = TRACKS.findIndex((t) => t.id === params.track);
    const weather: Weather =
      params.weather ?? (params.demo ? randPick<Weather>(['day', 'day', 'dusk', 'night', 'rain']) : career ? careerWeather(career.s.level, trackIndex) : 'day');
    this.race = new Race({
      track: trackById(params.track),
      level,
      bike,
      difficulty: run ? 'normal' : career?.s.difficulty ?? game.options.difficulty,
      playerName: (run ? game.run?.name : career?.s.name) || game.records.name || 'RIDER',
      demo: !!params.demo,
      weather,
      startDamage: run?.damage,
      upgrades: career?.upgrades,
      nitro: run ? 3 : 2,
      aspect: (id) => {
        const s = game.assets.get(id);
        return s.w / s.h;
      },
    });
    this.renderer = new RoadRenderer(game.assets);
    this.fx = new WeatherFx(this.race.weather);
    this.mode = game.options.camera ?? 'chase';
    this.mirror.width = 480;
    this.mirror.height = 150;
    Object.assign(CAMERA, CAMERA_MODES[this.mode]);
    this.firstness = this.mode === 'first' ? 1 : 0;
    this.cam.z = this.race.player.z - CAMERA.distance;
    this.cam.y = this.race.track.heightAt(this.race.player.z) + CAMERA.height;
    this.lastCamZ = this.cam.z;
    this.pauseMenu = new Menu(
      [
        { label: 'RESUME', onSelect: () => (this.paused = false) },
        { label: 'QUIT RACE', onSelect: () => this.forfeit() },
      ],
      game,
    );
  }

  enter() {
    const ms = this.renderer.warmUp(this.race);
    if (this.game.debug) console.debug(`[race] warmed up sprites in ${ms.toFixed(0)} ms`);
    const a = this.game.audio;
    a.playMusic(this.race.track.def.music);
    this.engine = a.createEngine();
    this.gravel = a.loop('sfx/gravel', 0);
    this.siren = a.loop('sfx/siren', 0);
    a.play('sfx/crowd', { volume: 0.7 });
    if (this.race.weather === 'rain') this.rainLoop = a.loop('sfx/rain', 0.22);
  }

  exit() {
    this.engine?.stop();
    this.gravel?.stop();
    this.siren?.stop();
    this.rainLoop?.stop();
  }

  onHide() {
    if (!this.params.demo && this.race.phase !== 'over' && !this.paused) {
      this.paused = true;
      this.pauseMenu.index = 0;
    }
  }

  private forfeit() {
    this.paused = false;
    this.race.quit();
  }

  // --- update --------------------------------------------------------------------------
  update(dt: number) {
    const input = this.game.input;
    if (this.params.demo && (input.anyKeyPressed || this.time > 45)) {
      this.game.go('title');
      this.done = true;
      return;
    }
    if (input.pressed('pause') && this.race.phase !== 'over' && !this.params.demo) {
      this.paused = !this.paused;
      this.game.audio.blip(300, 0.08);
      if (this.paused) this.pauseMenu.index = 0;
      return;
    }
    if (this.paused) {
      this.pauseMenu.update();
      this.engine?.update(1200, 0, 0.3);
      return;
    }
    if (this.game.debug) this.debugKeys();
    if (input.pressed('camera') && !this.params.demo) {
      this.mode = CAMERA_ORDER[(CAMERA_ORDER.indexOf(this.mode) + 1) % CAMERA_ORDER.length];
      this.game.options.camera = this.mode;
      this.game.saveOptions();
      this.say(CAMERA_MODES[this.mode].label, COLORS.blue, 28, 1.2);
      this.game.audio.blip(700, 0.05);
    }
    this.lookingBack = !this.params.demo && input.isDown('lookBack') && this.race.player.onBike;

    this.race.update(dt, this.params.demo ? NO_CONTROLS : this.readControls());
    for (const e of this.race.events) this.onEvent(e);
    this.race.events.length = 0;

    this.updateCamera(dt);
    this.renderer.updateParticles(dt);
    const pl = this.race.player;
    this.fx.update(dt, pl.onBike ? clamp(pl.speed / pl.topSpeed, 0, 1) : 0, this.firstness > 0.5 && !pl.crash && !this.lookingBack);
    if (this.fx.struck) setTimeout(() => this.game.audio.play('sfx/thunder', { volume: 0.9 }), 300 + Math.random() * 900);
    this.updateAudio();
    this.spawnDust();
    for (const m of this.messages) m.t += dt;
    this.messages = this.messages.filter((m) => m.t < m.dur);
    this.shake = Math.max(0, this.shake - dt * 2.5);

    if (this.race.phase === 'over' && !this.done) this.finish();
  }

  private readControls(): Controls {
    const i = this.game.input;
    return {
      steer: i.axisX(),
      throttle: i.isDown('throttle') ? 1 : 0,
      brake: i.isDown('brake') ? 1 : 0,
      attackL: i.pressed('attackL'),
      attackR: i.pressed('attackR'),
      kick: i.pressed('kick'),
      nitro: i.pressed('nitro'),
      runX: i.axisX(),
      runZ: -i.axisY(),
    };
  }

  private debugKeys() {
    const i = this.game.input, r = this.race;
    if (i.keyPressed('Digit1')) {
      r.godMode = !r.godMode;
      this.say(r.godMode ? 'GOD MODE ON' : 'GOD MODE OFF', COLORS.blue);
    }
    if (i.keyPressed('Digit2') && r.player.onBike) r.player.z += 8000;
    if (i.keyPressed('Digit3') && r.player.onBike) r.player.z = r.track.finishZ - 1500;
    if (i.keyPressed('Digit4')) r.player.startCrash('obstacle');
    if (i.keyPressed('Digit5')) {
      r.player.damage = 100;
      r.player.startCrash('car');
    }
    if (i.keyPressed('Digit6')) this.renderer.showDebug = !this.renderer.showDebug;
    if (i.keyPressed('Digit7')) r.player.weapon = r.player.weapon === 'club' ? 'chain' : r.player.weapon === 'chain' ? 'crowbar' : 'club';
    if (i.keyPressed('Digit8')) r.player.nitroCharges++;
  }

  private finish() {
    this.done = true;
    if (this.params.demo || (!this.game.career && !this.params.run)) {
      this.game.go('title');
      return;
    }
    const r = this.race;
    const results = r.finalResults();
    const outcome: RaceOutcome = {
      track: this.params.track,
      kind: r.player.finishTime !== null ? 'finished' : r.phase === 'busted' ? 'busted' : r.phase === 'wrecked' ? 'wrecked' : 'quit',
      place: results.findIndex((s) => s.racer.isPlayer) + 1,
      time: r.player.finishTime ?? r.time,
      results: results.map((s) => ({ id: s.racer.id, name: s.racer.name, time: s.time, finished: s.finished, isPlayer: s.racer.isPlayer })),
      knockouts: this.knockouts,
      level: r.setup.level.level,
      weather: r.weather,
      damage: r.player.damage,
      crashes: this.crashes,
      run: this.params.run,
    };
    // Busted / wrecked are decided by the last event, even if the timer flipped phase to 'over'.
    if (this.lastOutcome) outcome.kind = this.lastOutcome;
    this.game.events.emit({ type: 'raceEnd', outcome });
    this.game.go(this.params.run ? 'runresult' : 'result', outcome);
  }
  private lastOutcome: 'busted' | 'wrecked' | null = null;

  /** The preset in use: first person hands over to the chase cam while you're off the bike. */
  private activePreset() {
    const p = this.race.player;
    const mode = this.mode === 'first' && (p.crash || this.race.phase === 'countdown') ? 'chase' : this.mode;
    return mode;
  }

  private updateCamera(dt: number) {
    const p = this.race.player;
    const target = CAMERA_MODES[this.activePreset()];
    // glide between presets instead of cutting
    CAMERA.fov = smooth(CAMERA.fov, target.fov + p.boost * 12, 6, dt);
    CAMERA.height = smooth(CAMERA.height, target.height, 6, dt);
    CAMERA.distance = smooth(CAMERA.distance, target.distance, 6, dt);
    CAMERA.horizon = smooth(CAMERA.horizon, target.horizon, 6, dt);
    this.firstness = smooth(this.firstness, this.activePreset() === 'first' ? 1 : 0, 8, dt);
    let focusZ = p.z, focusX = p.x, back = 0;
    if (p.crash) {
      const b = p.crash.bike, body = p.crash.rider;
      // keep both the bike and the rider in shot, but never lose the rider
      focusZ = Math.max(Math.min(b.z, body.z), body.z - 5000);
      focusX = Math.abs(b.z - body.z) < 5000 ? (b.x + body.x) / 2 : body.x;
      back = 650 + Math.min(1500, Math.abs(b.z - body.z) * 0.25);
    }
    this.camBack = smooth(this.camBack, back, 3, dt);
    const targetZ = focusZ - CAMERA.distance - this.camBack;
    this.cam.z = p.crash ? smooth(this.cam.z, targetZ, 5, dt) : targetZ;
    const follow = 0.8 + 0.2 * this.firstness; // first person sits exactly on the bike
    this.cam.x = smooth(this.cam.x, focusX * ROAD_WIDTH * follow, 8 + 12 * this.firstness, dt);
    const track = this.race.track;
    const ground = p.airborne ? p.y : track.heightAt(focusZ);
    const targetY = Math.max(ground, track.heightAt(this.cam.z) + 250) + CAMERA.height + this.camBack * 0.35;
    this.cam.y = smooth(this.cam.y, targetY, 16, dt);
  }

  private updateAudio() {
    const p = this.race.player;
    const { rpm } = p.gearRpm();
    const onBike = p.onBike;
    this.engine?.update(onBike ? rpm : 900, onBike ? p.throttle : 0, onBike ? 1 : 0.25);
    this.gravel?.setVolume(onBike && p.offroad && p.speed > 5 * MPH ? clamp(p.speed / p.topSpeed, 0.2, 0.8) : 0);
    let sirenVol = 0;
    for (const c of this.race.cops) {
      if (c.copState !== 'chase' && c.copState !== 'arrest') continue;
      const d = Math.abs(c.z - p.bodyZ);
      sirenVol = Math.max(sirenVol, clamp(1 - d / 9000, 0, 1) * 0.7);
    }
    this.siren?.setVolume(sirenVol);
  }

  private spawnDust() {
    const p = this.race.player;
    if (p.boost > 0.2 && p.onBike && this.firstness < 0.5) {
      for (let k = 0; k < 2; k++)
        this.renderer.spawn({ z: p.z - 40, x: p.x + rand(-0.03, 0.03), h: 160, vz: p.speed * 0.7, vx: rand(-0.15, 0.15), vh: rand(-100, 200), max: 0.18, color: Math.random() < 0.5 ? '#6fb8ff' : '#ffb347', size: rand(40, 70) });
    }
    if (this.race.weather === 'rain') {
      // spray kicked up off the wet road by you and the bikes around you
      for (const r of this.race.riders) {
        if (!r.onBike || r.speed < 30 * MPH || Math.abs(r.z - p.z) > 4000 || Math.random() > (r.isPlayer ? 0.7 : 0.25)) continue;
        this.renderer.spawn({ z: r.z - 90, x: r.x + rand(-0.06, 0.06), h: 30, vz: r.speed * 0.55, vx: rand(-0.4, 0.4), vh: rand(200, 700), max: 0.45, color: 'rgba(210,220,232,0.55)', size: rand(50, 110) });
      }
    }
    if (p.onBike && p.offroad && p.speed > 20 * MPH && Math.random() < 0.6) {
      this.renderer.spawn({ z: p.z - 60, x: p.x + rand(-0.05, 0.05), h: 20, vz: p.speed * 0.6, vx: rand(-0.3, 0.3), vh: rand(300, 900), max: 0.5, color: '#9a7a4a', size: rand(40, 80) });
    }
  }

  private sparks(z: number, x: number, h: number, n: number, color = '#ffd23a') {
    for (let i = 0; i < n; i++) {
      this.renderer.spawn({ z, x: x + rand(-0.05, 0.05), h, vz: rand(-800, 1600), vx: rand(-0.9, 0.9), vh: rand(400, 1600), max: rand(0.3, 0.6), color, size: rand(25, 45) });
    }
  }

  private say(t: string, color: string = COLORS.yellow, size = 34, dur = 1.6) {
    this.messages = this.messages.filter((m) => m.y !== 150);
    this.messages.push({ text: t, color, size, t: 0, dur, y: 150 });
  }

  /** recent notable events, shown in the debug overlay */
  private log: string[] = [];
  private logEvent(e: RaceEvent) {
    const t = this.race.time.toFixed(1);
    let line = '';
    if (e.type === 'crash') line = `${t} CRASH ${e.racer.name} (${e.cause})`;
    else if (e.type === 'hit' && (e.hit.attacker.isPlayer || e.hit.target.isPlayer))
      line = `${t} ${e.hit.attacker.name} ${e.hit.kind} ${e.hit.target.name} -${e.hit.damage.toFixed(0)}${e.hit.knockedOff ? ' KO' : ''}`;
    else if (e.type === 'copAlert' || e.type === 'bust' || e.type === 'wrecked' || e.type === 'finish') line = `${t} ${e.type}${'racer' in e && e.racer ? ' ' + e.racer.name : ''}`;
    if (line) {
      this.log.push(line);
      if (this.log.length > 8) this.log.shift();
      if (this.game.debug) console.debug('[race]', line);
    }
  }

  private crashes = 0;

  private onEvent(e: RaceEvent) {
    this.logEvent(e);
    if (!this.params.demo) this.game.events.emit({ type: 'race', e });
    if (e.type === 'crash' && e.racer.isPlayer) this.crashes++;
    const a = this.game.audio;
    const p = this.race.player;
    const voice = this.game.options.voice;
    const pan = (z: number, x: number) => clamp((x - p.x) * 0.8, -1, 1) * (Math.abs(z - p.z) < 3000 ? 1 : 0.3);
    const vol = (z: number) => clamp(1 - Math.abs(z - p.bodyZ) / 6000, 0.1, 1);
    switch (e.type) {
      case 'countdown':
        a.blip(440, 0.18, 'square', 0.3);
        this.messages.push({ text: String(e.n), color: COLORS.yellow, size: 90, t: 0, dur: 0.9, y: 230 });
        break;
      case 'go':
        a.blip(880, 0.4, 'square', 0.3);
        if (voice) a.voice('voice/go');
        this.messages.push({ text: 'GO!', color: COLORS.green, size: 110, t: 0, dur: 1.2, y: 240 });
        break;
      case 'swing':
        a.play('sfx/grab', { volume: 0.25, rate: rand(1.2, 1.5) });
        break;
      case 'nitro':
        a.play('sfx/nitro', { volume: 0.9 });
        this.say('NITRO!', COLORS.blue, 44, 1);
        this.game.events.emit({ type: 'nitro' });
        break;
      case 'hit': {
        const { hit } = e;
        const id = hit.kind === 'chain' ? 'sfx/chain' : hit.kind === 'club' || hit.kind === 'crowbar' ? 'sfx/club' : hit.kind === 'kick' ? 'sfx/kick' : 'sfx/punch';
        a.play(id, { volume: vol(hit.target.z), rate: hit.kind === 'crowbar' ? rand(0.7, 0.8) : rand(0.9, 1.1), pan: pan(hit.target.z, hit.target.x) });
        if (Math.random() < 0.35) a.play('sfx/grunt', { volume: vol(hit.target.z) * 0.7, rate: rand(0.85, 1.15) });
        this.sparks(hit.target.z, hit.target.x, 650, hit.kind === 'punch' || hit.kind === 'kick' ? 5 : 10, '#fff6b0');
        if (hit.target.isPlayer) this.shake = Math.max(this.shake, 0.35);
        const w = (hit.attacker.weapon ?? 'club').toUpperCase();
        if (hit.stole && hit.attacker.isPlayer) (this.say(`GOT A ${w}!`, COLORS.orange), a.play('sfx/grab'));
        if (hit.stole && hit.target.isPlayer) this.say(`${hit.attacker.name.toUpperCase()} TOOK YOUR ${w}!`, COLORS.red, 24);
        if (hit.knockedOff && hit.attacker.isPlayer) {
          this.knockouts++;
          this.say(hit.target.isCop ? 'YOU DECKED A COP!' : `YOU DECKED ${hit.target.name.toUpperCase()}!`, COLORS.green, 30);
        }
        break;
      }
      case 'crash': {
        const r = e.racer;
        const big = e.cause === 'car' || e.cause === 'headon';
        a.play(big ? 'sfx/carCrash' : 'sfx/crash', { volume: vol(r.z), pan: pan(r.z, r.x) });
        if (r.isPlayer || Math.random() < 0.5) a.play('sfx/yell', { volume: vol(r.z) * 0.8, rate: rand(0.9, 1.1) });
        this.sparks(r.z, r.x, 200, 14, '#ff9a2a');
        if (r.isPlayer) {
          this.shake = 1;
          if (e.cause !== 'knockout' || Math.random() < 0.5) this.say(randPick(['OUCH!', 'WIPEOUT!', 'EAT ASPHALT!']), COLORS.red, 40);
        }
        break;
      }
      case 'thud':
        a.play('sfx/thud', { volume: vol(e.racer.bodyZ) * 0.8 });
        break;
      case 'land':
        if (e.racer.isPlayer) (a.play('sfx/thud', { volume: 0.5, rate: 1.3 }), (this.shake = Math.max(this.shake, 0.25)));
        break;
      case 'remount':
        a.blip(330, 0.08, 'triangle', 0.2);
        break;
      case 'copAlert':
        this.say('COPS!', COLORS.blue, 40);
        if (voice) a.voice('voice/pullover');
        break;
      case 'bust':
        this.lastOutcome = 'busted';
        this.say('BUSTED!', COLORS.blue, 70, 3.5);
        if (voice) a.voice('voice/busted');
        a.jingle('music/busted');
        break;
      case 'wrecked':
        this.lastOutcome = 'wrecked';
        this.say('WRECKED!', COLORS.red, 70, 3.5);
        if (voice) a.voice('voice/wrecked');
        break;
      case 'finish':
        if (e.racer.isPlayer) {
          this.say(`FINISHED ${ordinal(e.place)}`, e.place <= 4 ? COLORS.green : COLORS.yellow, 56, 4.5);
          a.play('sfx/crowd');
          if (e.place === 1 && voice) a.voice('voice/winner');
        }
        break;
      case 'horn':
        a.play(e.car.type.truck ? 'sfx/truckHorn' : 'sfx/horn', { volume: 0.6, pan: clamp(e.car.x - p.x, -1, 1) });
        break;
    }
  }

  // --- render --------------------------------------------------------------------------
  render(ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingQuality = 'low'; // bilinear; sprites come pre-shrunk from mipmaps
    const cam = { ...this.cam };
    if (this.shake > 0) {
      cam.x += rand(-1, 1) * this.shake * 90;
      cam.y += rand(-1, 1) * this.shake * 60;
    }
    const dz = this.cam.z - this.lastCamZ;
    this.lastCamZ = this.cam.z;
    const p = this.race.player;
    const first = this.firstness > 0.5 && !p.crash;
    // first person fills the whole screen: the cockpit carries the dashboard info
    const viewH = first ? HEIGHT : VIEW_HEIGHT;
    const scaleHorizon = (h: number) => (h * VIEW_HEIGHT) / viewH;
    this.renderMirror();
    if (this.lookingBack) {
      // turn your head: the road behind, from the rider's eyes
      const head: Camera = { x: p.x * ROAD_WIDTH, y: p.y + 900, z: p.z + 150 };
      this.renderer.render(ctx, this.race, head, 0, { dir: -1, width: WIDTH, height: viewH, fov: 82, horizon: scaleHorizon(0.42), hidePlayer: true });
      this.fx.draw(ctx, WIDTH, viewH, WIDTH / 2, viewH * scaleHorizon(0.42), 0.2);
      this.drawLookBackFrame(ctx);
    } else {
      const view = forwardView();
      if (first) {
        view.hidePlayer = true;
        view.roll = -p.lean * 0.75;
        view.height = viewH;
        view.horizon = scaleHorizon(view.horizon);
      }
      this.renderer.render(ctx, this.race, cam, dz, view);
      this.fx.draw(ctx, WIDTH, viewH, WIDTH / 2, viewH * view.horizon, p.onBike ? clamp(p.speed / p.topSpeed, 0, 1) : 0);
      if (p.boost > 0.05) this.drawSpeedLines(ctx, viewH, viewH * view.horizon, p.boost);
      if (first) this.cockpit.draw(ctx, { race: this.race, bike: this.race.setup.bike, time: this.time, mirror: this.mirror, night: this.race.weather === 'night' });
    }
    this.updateFlagman();
    if (first && !this.lookingBack) this.fx.drawDrops(ctx);
    if (!first) this.hud.render(ctx, this.race, this.time, this.mirror);
    this.fx.drawFlash(ctx, WIDTH, HEIGHT);
    this.drawOverlay(ctx);
    if (this.paused) this.drawPause(ctx);
    if (this.game.debug) this.drawDebug(ctx);
  }

  /** Rear view for the mirrors, flipped left-right like a real mirror. */
  private renderMirror() {
    const p = this.race.player;
    const g = this.mirror.getContext('2d')!;
    const eye: Camera = { x: p.bodyX * ROAD_WIDTH, y: (p.crash ? this.race.track.heightAt(p.bodyZ) : p.y) + 950, z: p.bodyZ - 60 };
    g.save();
    g.setTransform(-1, 0, 0, 1, this.mirror.width, 0);
    g.imageSmoothingQuality = 'low';
    this.renderer.render(g, this.race, eye, 0, { dir: -1, width: this.mirror.width, height: this.mirror.height, fov: 70, horizon: 0.45, hidePlayer: true, drawDistance: 110 });
    g.restore();
  }

  /** Nitro: streaks rushing out from the vanishing point and a blue tint at the edges. */
  private drawSpeedLines(ctx: CanvasRenderingContext2D, h: number, vy: number, k: number) {
    const cx = WIDTH / 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k) * 0.55;
    ctx.strokeStyle = '#e8f4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + (i % 3) * 0.37;
      const phase = (this.time * 2.2 + i * 0.137) % 1;
      const r0 = 120 + phase * 700, r1 = r0 + 60 + phase * 220;
      ctx.moveTo(cx + Math.cos(a) * r0, vy + Math.sin(a) * r0 * 0.6);
      ctx.lineTo(cx + Math.cos(a) * r1, vy + Math.sin(a) * r1 * 0.6);
    }
    ctx.stroke();
    const edge = ctx.createRadialGradient(cx, vy, h * 0.35, cx, vy, WIDTH * 0.75);
    edge.addColorStop(0, 'rgba(40,120,255,0)');
    edge.addColorStop(1, `rgba(40,120,255,${0.35 * k})`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, WIDTH, h);
    ctx.restore();
  }

  private drawLookBackFrame(ctx: CanvasRenderingContext2D) {
    const v = ctx.createRadialGradient(WIDTH / 2, VIEW_HEIGHT / 2, VIEW_HEIGHT * 0.35, WIDTH / 2, VIEW_HEIGHT / 2, VIEW_HEIGHT * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, WIDTH, VIEW_HEIGHT);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(WIDTH / 2 - 150, 18, 300, 38);
    text(ctx, '◀ LOOKING BACK ▶', WIDTH / 2, 45, { size: 16, align: 'center', color: COLORS.yellow });
  }

  /** Hint arrow when the player is on foot. */
  private drawOverlay(ctx: CanvasRenderingContext2D) {
    const p = this.race.player;
    for (const m of this.messages) {
      const k = Math.min(1, m.t * 6);
      const alpha = Math.min(1, (m.dur - m.t) * 3);
      ctx.globalAlpha = alpha;
      text(ctx, m.text, WIDTH / 2, m.y, { size: m.size * (0.6 + 0.4 * k), font: 'title', color: m.color, align: 'center', outline: 8 });
      ctx.globalAlpha = 1;
    }
    if (p.state === 'running' && p.crash) {
      const dzb = p.crash.bike.z - p.crash.rider.z;
      const dir = Math.abs(dzb) < 300 ? (p.crash.bike.x < p.crash.rider.x ? '◀' : '▶') : dzb > 0 ? '▲' : '▼';
      if (Math.floor(this.time * 3) % 2 === 0) {
        text(ctx, `GET BACK ON YOUR BIKE ${dir}`, WIDTH / 2, 80, { size: 18, align: 'center', color: COLORS.yellow, outline: 4 });
      }
    }
    if (this.params.demo) {
      text(ctx, 'DEMO', 24, 40, { size: 18, color: COLORS.red });
      if (Math.floor(this.time * 2) % 2 === 0) text(ctx, 'PRESS ANY KEY', WIDTH / 2, VIEW_HEIGHT - 30, { size: 18, align: 'center' });
    } else if (this.race.phase === 'countdown') {
      const where = this.params.run ? (this.params.run.mode === 'endless' ? `STAGE ${this.params.run.stage}` : 'DAILY CHALLENGE') : `LEVEL ${this.race.setup.level.level}`;
      const wx = this.race.weather === 'day' ? '' : `  -  ${WEATHER[this.race.weather].label}`;
      text(ctx, `${this.race.track.def.name.toUpperCase()}  -  ${where}${wx}`, WIDTH / 2, 80, { size: 18, align: 'center', color: COLORS.white, outline: 4 });
    }
    // controls reminder for the first few seconds of every race
    if (!this.params.demo && this.time < 9 && !this.game.touch.enabled) {
      ctx.globalAlpha = Math.min(1, (9 - this.time) / 1.5);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      // first person: keep the dials clear and show it near the top instead
      const hy = this.firstness > 0.5 ? 300 : VIEW_HEIGHT - 58;
      ctx.fillRect(WIDTH / 2 - 420, hy, 840, 40);
      text(ctx, 'ARROWS RIDE   A / D HIT   S KICK   SPACE NITRO   Q LOOK BACK   E CAMERA', WIDTH / 2, hy + 26, { size: 10, align: 'center', color: COLORS.yellow });
      ctx.globalAlpha = 1;
    }
  }

  /** The starter drops the flag at GO. */
  private updateFlagman() {
    if (this.flagman === undefined) this.flagman = this.findFlagman();
    if (this.flagman) this.flagman.sprite = this.race.phase === 'countdown' ? 'props/flagmanUp' : 'props/flagmanDown';
  }
  private flagman: PropInstance | null | undefined;
  private findFlagman() {
    const start = this.race.track.findSegment(this.race.track.startZ).index;
    for (let i = start; i < start + 6; i++) {
      const prop = this.race.track.segments[i]?.props.find((p) => p.sprite.startsWith('props/flagman'));
      if (prop) return prop;
    }
    return null;
  }

  private drawPause(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    panel(ctx, WIDTH / 2 - 220, 190, 440, 260);
    text(ctx, 'PAUSED', WIDTH / 2, 260, { size: 56, font: 'title', align: 'center', color: COLORS.yellow });
    this.pauseMenu.render(ctx, WIDTH / 2, 330, { time: this.time });
    text(ctx, 'Quitting counts as a DNF', WIDTH / 2, 430, { size: 9, align: 'center', color: '#999' });
  }

  private drawDebug(ctx: CanvasRenderingContext2D) {
    const r = this.race, p = r.player;
    const seg = r.track.findSegment(p.z);
    const lines = [
      `phase ${r.phase}  t ${r.time.toFixed(1)}  god ${r.godMode}`,
      `player ${p.state} z ${p.z.toFixed(0)} x ${p.x.toFixed(2)} mph ${p.mph.toFixed(0)} hp ${p.health.toFixed(0)} dmg ${p.damage.toFixed(0)}`,
      `seg ${seg.index}/${r.track.segments.length} curve ${seg.curve.toFixed(2)} y ${seg.p1.world.y.toFixed(0)} air ${p.airborne}`,
      `cars ${r.traffic.cars.length}  cops ${r.cops.map((c) => c.copState).join(',')}`,
      `keys: 1 god  2 skip  3 near finish  4 crash  5 wreck  6 boxes  7 weapon  8 +nitro`,
      ...this.log,
    ];
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(8, 24, 700, lines.length * 16 + 8);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#0f0';
    ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, 14, 40 + i * 16));
  }
}

export const ALL_TRACK_IDS = TRACKS.map((t) => t.id);
