/**
 * One race: owns the track, riders, cops and traffic and advances the simulation.
 * It knows nothing about rendering or audio; it reports what happened through `events`.
 */
import { MAX_X, MPH, OBSTACLE_CRASH_MPH, OFFROAD_LIMIT, RACERS, RIDER_HALF_WIDTH, ROAD_WIDTH, RUN_SPEED, SEGMENT_LENGTH, STEER_RESPONSE, STEER_RETURN } from '../config';
import type { BikeDef } from '../data/bikes';
import { DIFFICULTY, type Difficulty, type LevelDef } from '../data/levels';
import { RIDERS } from '../data/riders';
import type { TrackDef } from '../data/tracks';
import { WEATHER, weatherColors, type Weather } from '../data/weather';
import { NO_UPGRADES, upgradeEffects, type Upgrades } from '../data/upgrades';
import { clamp } from '../engine/math';
import { rand } from '../engine/Rng';
import { updateCop, updateRival, type AIWorld } from './AI';
import { nearestFoe, resolveAttack, targetsInReach, type HitResult } from './Combat';
import { Racer, type AttackKind, type WeaponKind } from './Racer';
import { buildTrack, type AspectLookup, type Track } from './Track';
import { Traffic, type Car } from './Traffic';

export type RacePhase = 'countdown' | 'racing' | 'finished' | 'busted' | 'wrecked' | 'over';

export type RaceEvent =
  | { type: 'countdown'; n: number }
  | { type: 'go' }
  | { type: 'hit'; hit: HitResult }
  | { type: 'swing'; racer: Racer }
  | { type: 'nitro'; racer: Racer }
  | { type: 'crash'; racer: Racer; cause: string }
  | { type: 'thud'; racer: Racer }
  | { type: 'land'; racer: Racer }
  | { type: 'remount'; racer: Racer }
  | { type: 'copAlert'; cop: Racer }
  | { type: 'bust'; racer?: Racer }
  | { type: 'wrecked'; racer?: Racer }
  | { type: 'finish'; racer: Racer; place: number }
  | { type: 'horn'; car: Car };

export interface Controls {
  steer: number;
  throttle: number;
  brake: number;
  attackL: boolean;
  attackR: boolean;
  kick: boolean;
  /** on foot */
  runX: number;
  runZ: number;
  nitro?: boolean;
}

export const NO_CONTROLS: Controls = { steer: 0, throttle: 0, brake: 0, attackL: false, attackR: false, kick: false, runX: 0, runZ: 0 };

export interface RaceSetup {
  track: TrackDef;
  level: LevelDef;
  bike: BikeDef;
  difficulty: Difficulty;
  playerName: string;
  demo?: boolean;
  aspect: AspectLookup;
  /** race conditions (default: day) */
  weather?: Weather;
  /** bike damage carried in from a previous stage (endless runs) */
  startDamage?: number;
  /** nitro boosts for the player before upgrades (default 2) */
  nitro?: number;
  /** the player's shop upgrades */
  upgrades?: Upgrades;
  /** split screen: the second human rider */
  second?: { name: string; bike: BikeDef; upgrades?: Upgrades };
  /** how many rivals line up (default: the full field) */
  rivals?: number;
}

export interface Standing {
  racer: Racer;
  time: number;
  finished: boolean;
}

/** Rivals' weapons: clubs early on, chains from level 2, crowbars from level 3. */
function pickWeapon(level: number): WeaponKind {
  const r = Math.random();
  if (level >= 3) return r < 0.45 ? 'club' : r < 0.75 ? 'chain' : 'crowbar';
  if (level === 2) return r < 0.7 ? 'club' : 'chain';
  return 'club';
}

/** damage multiplier when a rival or cop hits the player */
const RIVAL_VS_PLAYER = 0.65;

const CRASH_DAMAGE: Record<string, [number, number]> = {
  obstacle: [14, 20],
  car: [20, 28],
  headon: [28, 36],
  knockout: [5, 8],
  bump: [8, 12],
};

export class Race {
  readonly track: Track;
  readonly traffic: Traffic;
  readonly player: Racer;
  /** split screen only */
  readonly player2: Racer | null = null;
  readonly rivals: Racer[] = [];
  readonly cops: Racer[] = [];
  /** everyone on a bike: player + rivals + cops */
  readonly riders: Racer[] = [];
  phase: RacePhase = 'countdown';
  countdown = 3.99;
  time = 0;
  endTimer = 0;
  events: RaceEvent[] = [];
  standings: Racer[] = [];
  finishOrder: Racer[] = [];
  /** debug: player can't be hurt */
  godMode = false;
  private lastCount = 4;
  private world: AIWorld;

  readonly weather: Weather;

  constructor(public setup: RaceSetup) {
    const { level, bike } = setup;
    this.weather = setup.weather ?? 'day';
    const wx = WEATHER[this.weather];
    // same road geometry (seeded by track id), repainted for the conditions
    this.track = buildTrack({ ...setup.track, colors: weatherColors(setup.track.colors, this.weather) }, level, setup.aspect);
    this.traffic = new Traffic(this.track, level.traffic);
    const diff = DIFFICULTY[setup.difficulty];

    const human = (id: string, name: string, b: BikeDef, upgrades: Upgrades | undefined, hue: number) => {
      const up = upgradeEffects(upgrades ?? NO_UPGRADES);
      const h = new Racer(id, name, 'player', hue, Racer.fromBike(b), true);
      h.bikeDef = b;
      h.topSpeed *= up.topSpeed;
      h.accel *= up.accel;
      h.handling *= up.handling;
      h.maxHealth = h.health = 100 + up.health;
      h.armour = up.armour;
      h.brakePower = up.brakes;
      h.offroadLimit = (b.offroad ?? OFFROAD_LIMIT) + up.offroad;
      h.pushScale = 440 / b.weight;
      h.nitroCharges = (setup.nitro ?? 2) + up.nitro;
      h.grip = Math.min(1, wx.grip + up.grip);
      return h;
    };
    this.player = human('player', setup.playerName, bike, setup.upgrades, 0);
    const pl = this.player;
    pl.damage = Math.max(0, Math.min(90, setup.startDamage ?? 0));
    // player two: same sprite set, re-coloured
    if (setup.second) this.player2 = human('player2', setup.second.name, setup.second.bike, setup.second.upgrades, 130);

    const fastestHuman = Math.max(...this.humans.map((h) => h.topSpeed));
    // 14 rivals, slowest skill band to fastest, spread over the level's speed range.
    for (const def of RIDERS.slice(0, Math.min(RACERS - 1, setup.rivals ?? RACERS - 1))) {
      const band = level.aiSpeed[0] + (level.aiSpeed[1] - level.aiSpeed[0]) * def.skill;
      // a faster bike (or upgrades) shouldn't leave the whole field standing: the best riders
      // stay within a few percent of you, the slowest about a quarter behind
      const keepUp = (fastestHuman / MPH) * (0.74 + 0.2 * def.skill);
      const speed = Math.max(band, keepUp);
      const top = speed * diff.speed * wx.rivalPace * rand(0.98, 1.02);
      const r = new Racer(def.id, def.name, def.design, def.hue, { topSpeed: top * 1.06, accel: 24 + level.level * 2.5, handling: 1 }, false, false, def);
      r.cruise = top * MPH;
      r.skill = def.skill;
      r.aggression = def.aggression;
      r.maxHealth = r.health = 45 + def.toughness * 45;
      r.weapon = Math.random() < def.club * (0.6 + level.level * 0.1) ? pickWeapon(level.level) : null;
      r.laneTimer = rand(1, 4);
      this.rivals.push(r);
    }

    // Grid: rows of three behind the start line; player starts mid-pack.
    const grid = [...this.rivals];
    grid.sort(() => Math.random() - 0.5);
    grid.splice(Math.min(7, grid.length), 0, this.player);
    if (this.player2) grid.splice(Math.min(8, grid.length), 0, this.player2);
    grid.forEach((r, i) => {
      const row = Math.floor(i / 3), col = i % 3;
      r.z = this.track.startZ - 300 - row * 520;
      r.x = (col - 1) * 0.5 + rand(-0.05, 0.05);
      r.y = this.track.heightAt(r.z);
      r.targetX = r.x;
    });

    for (const spawn of this.track.copSpawns) {
      const c = new Racer(`cop${this.cops.length}`, 'COP', 'cop', 0, { topSpeed: level.copSpeed, accel: 38, handling: 1.1 }, false, true);
      c.maxHealth = c.health = 160;
      c.z = spawn.z;
      c.x = spawn.side * 1.35;
      c.copSide = spawn.side;
      c.y = this.track.heightAt(c.z);
      c.copState = 'parked';
      c.state = 'riding';
      c.weapon = 'club';
      this.cops.push(c);
    }

    this.riders.push(...this.humans, ...this.rivals, ...this.cops);
    for (const r of this.rivals) r.grip = wx.grip;
    for (const r of this.cops) r.grip = wx.grip;
    this.world = {
      track: this.track,
      riders: this.riders,
      cars: this.traffic.cars,
      player: this.player,
      humans: this.humans,
      aggressionScale: diff.aggression,
      time: 0,
    };
    this.computeStandings();
  }

  get humans(): Racer[] {
    return this.player2 ? [this.player, this.player2] : [this.player];
  }

  get racers(): Racer[] {
    return [...this.humans, ...this.rivals];
  }

  get playerPlace(): number {
    return this.standings.indexOf(this.player) + 1;
  }

  placeOf(r: Racer): number {
    return this.standings.indexOf(r) + 1;
  }

  /** a human is done when they've finished, or (split screen) been busted / wrecked */
  private humanDone(h: Racer) {
    return h.finishTime !== null || h.out !== null;
  }

  /** 0..1 progress of a rider along the race distance */
  progress(r: Racer): number {
    return clamp((r.z - this.track.startZ) / this.track.raceLength, 0, 1);
  }

  private emit(e: RaceEvent) {
    this.events.push(e);
  }

  update(dt: number, controls: Controls, controls2: Controls = NO_CONTROLS) {
    this.world.time += dt;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount && n > 0) this.emit({ type: 'countdown', n });
      this.lastCount = n;
      this.player.throttle = controls.throttle; // rev the engine on the line
      if (this.player2) this.player2.throttle = controls2.throttle;
      if (this.countdown <= 0) {
        this.phase = 'racing';
        for (const r of this.racers) r.state = 'riding';
        this.emit({ type: 'go' });
      }
      return;
    }
    if (this.phase === 'over') return;

    if (this.phase === 'racing') this.time += dt;
    this.controlPlayer(this.player, dt, controls);
    if (this.player2) this.controlPlayer(this.player2, dt, controls2);
    for (const r of this.rivals) updateRival(r, dt, this.world);
    for (const c of this.cops) {
      const ev = updateCop(c, dt, this.world, this.setup.level.copSpeed);
      if (ev === 'activated') this.emit({ type: 'copAlert', cop: c });
      if (ev === 'bust' && this.phase === 'racing') this.bust(c.copTarget ?? this.player);
    }

    for (const r of this.riders) this.step(r, dt);
    this.resolveCombat();
    this.collide(dt);
    // traffic lives around the rear-most human still racing
    const active = this.humans.filter((h) => !this.humanDone(h));
    this.traffic.update(dt, Math.min(...(active.length ? active : this.humans).map((h) => h.bodyZ)));
    this.checkFinish();
    this.computeStandings();

    if (this.phase !== 'racing') {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.phase = 'over';
    }
  }

  // --- player --------------------------------------------------------------------------
  private controlPlayer(p: Racer, dt: number, c: Controls) {
    if (this.phase === 'busted' || this.phase === 'wrecked' || p.out) c = NO_CONTROLS; // it's over, pal
    else if (this.setup.demo && p === this.player) c = this.demoControls(p);
    if (p.state === 'riding') {
      // ease the (digital) steering input in and out so the bike carves instead of snapping
      const rate = c.steer === 0 || Math.sign(c.steer) !== Math.sign(p.steer) ? STEER_RETURN : STEER_RESPONSE;
      p.steer = this.setup.demo ? c.steer : p.steer + Math.max(-rate * dt, Math.min(rate * dt, c.steer - p.steer));
      p.throttle = c.throttle;
      p.brake = c.brake;
      const armed = p.weapon ?? 'punch';
      // Auto-aim: if nobody is on the side you swing at but someone is on the other side, hit them.
      const aim = (side: -1 | 1, kind: AttackKind): -1 | 1 => {
        if (targetsInReach(p, this.riders, side, kind).length) return side;
        const other = (-side) as -1 | 1;
        return targetsInReach(p, this.riders, other, kind).length ? other : side;
      };
      if (c.attackL && p.startAttack(armed, aim(-1, armed))) this.emit({ type: 'swing', racer: p });
      if (c.attackR && p.startAttack(armed, aim(1, armed))) this.emit({ type: 'swing', racer: p });
      if (c.nitro && p.startNitro()) this.emit({ type: 'nitro', racer: p });
      if (c.kick) {
        const foe = nearestFoe(p, this.riders, 0.75, 480);
        if (p.startAttack('kick', foe?.side ?? 1)) this.emit({ type: 'swing', racer: p });
      }
      // catch your breath: health comes back when nobody has hit you for a few seconds
      if (p.lastHurt > 3) p.health = Math.min(p.maxHealth, p.health + 6 * dt);
    } else if (p.state === 'finished') {
      // coast down past the line
      p.throttle = 0;
      p.brake = p.speed > 40 * MPH ? 0.3 : 0;
      p.steer = clamp(-p.x * 2, -1, 1);
    } else if (p.state === 'running' && p.crash) {
      const body = p.crash.rider;
      const bike = p.crash.bike;
      let runZ = c.runZ, runX = c.runX;
      if (!runZ && !runX) {
        // no input: jog back to the bike on your own (a little slower than running)
        runZ = clamp((bike.z - body.z) / 400, -1, 1) * 0.75;
        runX = clamp((bike.x - body.x) * 4, -1, 1) * 0.75;
      }
      body.z += runZ * RUN_SPEED * dt;
      body.x = clamp(body.x + runX * 1.4 * dt, -MAX_X, MAX_X);
      if (runZ || runX) p.runPhase += dt * 8;
      if (Math.abs(runZ) > 0.05) p.runDir = runZ > 0 ? 1 : -1;
      if (Math.abs(body.z - bike.z) < 420 && Math.abs(body.x - bike.x) < 0.38) {
        p.remount();
        this.emit({ type: 'remount', racer: p });
      }
    }
  }

  private demoControls(p: Racer): Controls {
    if (p.state === 'running' && p.crash) {
      const b = p.crash.bike, body = p.crash.rider;
      return { ...NO_CONTROLS, runZ: Math.sign(b.z - body.z), runX: clamp((b.x - body.x) * 5, -1, 1) };
    }
    p.cruise = p.topSpeed * 0.96;
    p.aggression = 0.6;
    updateRival(p, 0, this.world);
    const foe = nearestFoe(p, this.riders, 0.45, 300);
    const swing = !!foe && Math.random() < 0.04;
    return { ...NO_CONTROLS, steer: p.steer, throttle: p.throttle, brake: p.brake, attackL: swing && foe!.side < 0, attackR: swing && foe!.side > 0 };
  }

  // --- per-rider physics / state machine -------------------------------------------------
  private step(r: Racer, dt: number) {
    r.tickTimers(dt);
    r.landed = false;
    switch (r.state) {
      case 'riding':
      case 'finished':
        if (r.isCop && r.copState === 'parked') break;
        r.ride(dt, this.track, r.isPlayer && !this.setup.demo);
        if (r.landed) this.emit({ type: 'land', racer: r });
        break;
      case 'crashing':
        if (r.crash && !r.crash.rider.landed) {
          r.updateCrash(dt);
          if (r.crash.rider.landed) this.emit({ type: 'thud', racer: r });
        } else if (r.updateCrash(dt)) {
          r.state = 'down';
          r.downTimer = r.isPlayer ? 0.45 : rand(1.2, 2.4);
        }
        break;
      case 'down':
        r.updateCrash(dt);
        r.downTimer -= dt;
        if (r.downTimer <= 0) {
          if (r.isPlayer) {
            if (this.phase === 'racing' && r.damage >= 100 && !r.out) this.wreck(r);
            r.state = 'running';
          } else if (r.isCop) {
            r.copState = 'gone';
            r.state = 'out';
          } else {
            r.remount();
            if (r.finishTime !== null) r.state = 'finished';
          }
        }
        break;
      case 'running':
        r.updateCrash(dt);
        break;
    }
  }

  private resolveCombat() {
    for (const r of this.riders) {
      if (!r.attack || r.attack.resolved) continue;
      // rivals hit the player softer than the player hits them
      const scale = r.isPlayer ? 1.4 : 1;
      const hit = resolveAttack(r, this.riders, scale, r.isPlayer ? 1 : RIVAL_VS_PLAYER);
      if (!hit) continue;
      if (hit.target.isPlayer && this.godMode) {
        hit.target.health = hit.target.maxHealth;
      }
      this.emit({ type: 'hit', hit });
      if (hit.knockedOff) this.onCrash(hit.target, 'knockout');
    }
  }

  private onCrash(r: Racer, cause: string) {
    this.emit({ type: 'crash', racer: r, cause });
    if (r.isPlayer && !this.godMode) {
      const [a, b] = CRASH_DAMAGE[cause] ?? [10, 15];
      r.damage = Math.min(100, r.damage + rand(a, b) * 0.75 * (70 / (r.bikeDef ?? this.setup.bike).durability));
    }
    if (r.isPlayer && this.setup.demo) r.damage = 0;
  }

  private crash(r: Racer, cause: string) {
    if (!r.onBike || r.state === 'finished') return;
    if (r.isPlayer && this.godMode) {
      r.speed *= 0.4;
      return;
    }
    r.startCrash(cause);
    this.onCrash(r, cause);
  }

  // --- collisions ------------------------------------------------------------------------
  private collide(dt: number) {
    const mounted = this.riders.filter((r) => r.state === 'riding' && !(r.isCop && r.copState === 'parked'));

    // roadside props
    for (const r of mounted) {
      if (!r.offroad || r.airborne) continue;
      const seg = this.track.findSegment(r.z);
      const prev = this.track.segments[Math.max(0, seg.index - 1)];
      for (const s of [prev, seg]) {
        for (const p of s.props) {
          if (!p.solid) continue;
          const half = ((p.w / 2) * p.solid) / ROAD_WIDTH;
          if (Math.abs(r.x - p.offset) < half + RIDER_HALF_WIDTH && Math.abs(r.z - s.p1.world.z) < SEGMENT_LENGTH) {
            // small stuff (signs, mailboxes, cacti, fences) knocks you about; big stuff throws you off
            const small = p.h < 1500;
            if (!small && r.speed > OBSTACLE_CRASH_MPH * MPH) this.crash(r, 'obstacle');
            else {
              r.speed *= small ? 0.6 : 0;
              r.x += r.x > p.offset ? 0.08 : -0.08;
              r.hitStun = Math.max(r.hitStun, 0.25);
            }
          }
        }
      }
    }

    // cars
    for (const r of mounted) {
      if (r.airborne) continue;
      for (const c of this.traffic.cars) {
        const dz = c.z - r.z;
        const dx = Math.abs(c.x - r.x);
        if (r.isPlayer && c.oncoming && !c.honked && dz > 0 && dz < 3500 && dx < 0.45) {
          c.honked = 4;
          this.emit({ type: 'horn', car: c });
        }
        // the player's hitbox is a little forgiving: glancing a mirror doesn't end your race
        const reach = c.type.width + RIDER_HALF_WIDTH * (r.isPlayer ? 0.35 : 0.7);
        if (Math.abs(dz) < c.type.length / 2 + 120 && dx < reach) {
          if (c.oncoming) this.crash(r, 'headon');
          else if (r.speed > c.speed + 18 * MPH) this.crash(r, 'car');
          else {
            // a gentle rear bump: drop behind the car and glance off to the side
            r.speed = Math.max(0, c.speed * 0.85);
            r.z = Math.min(r.z, c.z - c.type.length / 2 - 130);
            r.x += (r.x < c.x ? -1 : 1) * 0.06;
          }
        }
      }
    }

    // bike-to-bike bumping
    for (let i = 0; i < mounted.length; i++) {
      for (let j = i + 1; j < mounted.length; j++) {
        const a = mounted[i], b = mounted[j];
        const dz = b.z - a.z;
        if (Math.abs(dz) > 230) continue;
        const dx = b.x - a.x;
        const overlap = RIDER_HALF_WIDTH * 2 - Math.abs(dx);
        if (overlap <= 0) continue;
        const dir = dx >= 0 ? 1 : -1;
        a.x -= (dir * overlap) * 0.35;
        b.x += (dir * overlap) * 0.35;
        const [rear, front] = dz >= 0 ? [a, b] : [b, a];
        if (Math.abs(dz) > 90 && rear.speed > front.speed) {
          if (rear.speed - front.speed > 55 * MPH && Math.random() < 0.5 * dt * 60 * 0.02) this.crash(rear, 'bump');
          rear.speed = front.speed * 0.98;
        }
      }
    }
  }

  // --- race state ------------------------------------------------------------------------
  private checkFinish() {
    for (const r of this.racers) {
      if (r.finishTime === null && r.z >= this.track.finishZ && r.onBike) {
        r.finishTime = this.time;
        r.state = 'finished';
        this.finishOrder.push(r);
        r.place = this.finishOrder.length;
        this.emit({ type: 'finish', racer: r, place: r.place });
        if (r.isPlayer && this.phase === 'racing') this.humanFinished();
      }
    }
  }

  /** The race ends once every human is done (one human = as soon as they finish). */
  private humanFinished() {
    if (this.humans.every((h) => this.humanDone(h))) {
      this.phase = 'finished';
      this.endTimer = 4.5;
    }
  }

  private bust(r: Racer) {
    this.emit({ type: 'bust', racer: r });
    if (this.player2) {
      // split screen: that rider is out, the other one races on
      r.out = 'busted';
      return this.humanFinished();
    }
    this.phase = 'busted';
    this.endTimer = 3.5;
  }

  private wreck(r: Racer) {
    this.emit({ type: 'wrecked', racer: r });
    if (this.player2) {
      r.out = 'wrecked';
      return this.humanFinished();
    }
    this.phase = 'wrecked';
    this.endTimer = 3.5;
  }

  /** Forfeit from the pause menu. */
  quit() {
    this.phase = 'over';
  }

  private computeStandings() {
    const done = this.finishOrder;
    const rest = this.racers.filter((r) => r.finishTime === null).sort((a, b) => b.z - a.z);
    this.standings = [...done, ...rest];
  }

  /**
   * Final results once the player is done. Riders still on the road get an estimated time from
   * their remaining distance and pace.
   */
  finalResults(): Standing[] {
    const list: Standing[] = this.racers.map((r) => {
      if (r.finishTime !== null) return { racer: r, time: r.finishTime, finished: true };
      const remaining = Math.max(0, this.track.finishZ - r.z);
      const pace = Math.max(40 * MPH, r.isPlayer ? r.topSpeed * 0.8 : r.cruise * 0.92);
      const penalty = r.state === 'riding' ? 0 : 3;
      return { racer: r, time: this.time + remaining / pace + penalty + Math.random() * 0.3, finished: false };
    });
    for (const h of this.humans) {
      // a busted / wrecked / quitting rider is last
      if (this.phase === 'busted' || this.phase === 'wrecked' || h.finishTime === null || h.out) list.find((s) => s.racer === h)!.time = Infinity;
    }
    return list.sort((a, b) => a.time - b.time);
  }
}
