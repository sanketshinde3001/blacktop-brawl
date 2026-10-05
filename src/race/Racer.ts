/**
 * A motorcycle + rider. Used for the player, the 14 rivals and the cops.
 * Coordinates: z = distance along the road, x = lateral position (-1..1 is the road surface),
 * y = absolute world height (follows the road except when airborne).
 */
import { CENTRIFUGAL, GRAVITY, MAX_X, MPH, OFFROAD_LIMIT } from '../config';
import type { BikeDef } from '../data/bikes';
import type { RiderDef } from '../data/riders';
import { approach, clamp } from '../engine/math';
import { rand, randSign } from '../engine/Rng';
import type { Track } from './Track';

export type RiderState = 'grid' | 'riding' | 'crashing' | 'down' | 'running' | 'finished' | 'out';
export type WeaponKind = 'club' | 'chain' | 'crowbar';
export type AttackKind = 'punch' | 'kick' | WeaponKind;
export const isWeapon = (k: AttackKind): k is WeaponKind => k === 'club' || k === 'chain' || k === 'crowbar';
export type CopState = 'parked' | 'chase' | 'arrest' | 'gone';

export interface Attack {
  kind: AttackKind;
  side: -1 | 1;
  t: number;
  duration: number;
  hitAt: number;
  resolved: boolean;
}

export const ATTACKS: Record<AttackKind, { duration: number; hitAt: number; reach: number; reachZ: number; damage: [number, number]; push: number }> = {
  punch: { duration: 0.36, hitAt: 0.15, reach: 0.44, reachZ: 330, damage: [7, 11], push: 0.05 },
  kick: { duration: 0.46, hitAt: 0.2, reach: 0.42, reachZ: 300, damage: [10, 14], push: 0.22 },
  club: { duration: 0.5, hitAt: 0.22, reach: 0.58, reachZ: 380, damage: [16, 24], push: 0.1 },
  /** longest reach, lighter hits */
  chain: { duration: 0.56, hitAt: 0.26, reach: 0.74, reachZ: 420, damage: [12, 18], push: 0.14 },
  /** heaviest hits, a touch slower */
  crowbar: { duration: 0.54, hitAt: 0.25, reach: 0.56, reachZ: 370, damage: [21, 29], push: 0.12 },
};

/** Nitro: how long a boost lasts and what it adds. */
export const NITRO = { duration: 2.6, topSpeed: 0.28, accel: 1.4 };

/** A tumbling body (rider or bike) after a crash. */
export interface Body {
  z: number;
  x: number;
  h: number;
  vz: number;
  vx: number;
  vh: number;
  rot: number;
  vrot: number;
  landed: boolean;
  rest: number;
}

export interface CrashSim {
  rider: Body;
  bike: Body;
  t: number;
  cause: string;
}

const BRAKE = 55 * MPH;
const COAST = 9 * MPH;
const STEER_RATE = 1.9;

export class Racer {
  z = 0;
  x = 0;
  y = 0;
  vy = 0;
  airborne = false;
  speed = 0;
  steer = 0;
  throttle = 0;
  brake = 0;
  lean = 0;
  offroad = false;
  /** road grip: 1 dry, lower in the wet (less steering bite, more slide, weaker brakes) */
  grip = 1;
  /** shop upgrades / bike traits (player only) */
  brakePower = 1;
  offroadLimit = OFFROAD_LIMIT;
  /** fraction of incoming hit damage blocked by armour */
  armour = 0;
  /** how far hits shove this bike sideways (heavier bikes move less) */
  pushScale = 1;
  /** split screen: a human who got busted / wrecked sits out the rest of the race */
  out: 'busted' | 'wrecked' | null = null;
  /** cops: the human they're after */
  copTarget: Racer | null = null;
  /** humans: the bike they ride (crash damage depends on its toughness) */
  bikeDef: BikeDef | null = null;

  topSpeed: number;
  accel: number;
  handling: number;

  health: number;
  maxHealth: number;
  /** bike damage 0..100 (only matters for the player) */
  damage = 0;
  weapon: WeaponKind | null = null;
  /** nitro boosts left this race, the time left on the current one and its eased strength */
  nitroCharges = 0;
  nitroTime = 0;
  boost = 0;
  attack: Attack | null = null;
  attackCooldown = 0;
  hitStun = 0;
  hitFlash = 0;
  invulnerable = 0;
  /** seconds since this rider last took a hit (player health regenerates after a while) */
  lastHurt = 99;
  /** seconds spent off the bike in the current crash (cops only move in after a grace period) */
  offBikeTime = 0;

  state: RiderState = 'grid';
  crash: CrashSim | null = null;
  downTimer = 0;
  runPhase = 0;
  /** direction the on-foot player is running, for picking front/back frames */
  runDir = 1;

  finishTime: number | null = null;
  place = 0;

  // AI
  cruise = 0;
  targetX = 0;
  laneTimer = 0;
  aggression = 0.5;
  skill = 0.5;
  grudge = 0;
  // cop
  copState: CopState | null = null;
  copSide: 1 | -1 = 1;

  constructor(
    public id: string,
    public name: string,
    public design: string,
    public hue: number,
    bike: { topSpeed: number; accel: number; handling: number },
    public isPlayer = false,
    public isCop = false,
    public def?: RiderDef,
  ) {
    this.topSpeed = bike.topSpeed * MPH;
    this.accel = bike.accel * MPH;
    this.handling = bike.handling;
    this.maxHealth = this.health = 100;
  }

  static fromBike(b: BikeDef) {
    return { topSpeed: b.topSpeed, accel: b.accel, handling: b.handling };
  }

  get mph(): number {
    return this.speed / MPH;
  }

  get onBike(): boolean {
    return this.state === 'riding' || this.state === 'finished' || this.state === 'grid';
  }

  get canFight(): boolean {
    return this.state === 'riding' && this.hitStun <= 0 && !this.airborne;
  }

  /** Where the rider's body actually is (differs from z while crashed). */
  get bodyZ(): number {
    return this.crash ? this.crash.rider.z : this.z;
  }
  get bodyX(): number {
    return this.crash ? this.crash.rider.x : this.x;
  }

  /** Gear + rpm for the tachometer and engine sound. */
  gearRpm(): { gear: number; rpm: number } {
    const f = clamp(this.speed / this.topSpeed, 0, 1);
    const shifts = [0, 0.2, 0.38, 0.56, 0.75, 1.0001];
    let g = 0;
    while (g < 4 && f >= shifts[g + 1]) g++;
    const t = (f - shifts[g]) / (shifts[g + 1] - shifts[g]);
    return { gear: g + 1, rpm: 1800 + t * 8700 + (this.throttle && f < 0.02 ? 2500 : 0) };
  }

  /** Riding physics. `centrifugal` is off for AI, which "knows" the road. */
  ride(dt: number, track: Track, centrifugal: boolean) {
    this.nitroTime = Math.max(0, this.nitroTime - dt);
    this.boost += ((this.nitroTime > 0 ? 1 : 0) - this.boost) * (1 - Math.exp(-(this.nitroTime > 0 ? 6 : 2.5) * dt));
    const top = this.topSpeed * (1 + NITRO.topSpeed * this.boost);
    const max = this.offroad ? top * this.offroadLimit : top;
    if (this.throttle > 0 && !this.airborne) {
      const f = this.speed / top;
      this.speed += this.accel * (1 + NITRO.accel * this.boost) * this.throttle * Math.max(0.05, 1 - f * f) * dt;
    } else if (this.brake > 0) {
      this.speed -= BRAKE * this.brake * this.brakePower * (0.4 + 0.6 * this.grip) * dt;
    } else {
      this.speed -= COAST * dt;
    }
    if (this.speed > max) this.speed = approach(this.speed, max, (this.offroad ? 70 : 20) * MPH * dt);
    this.speed = clamp(this.speed, 0, top * 1.02);

    const sp = Math.min(1, this.speed / this.topSpeed);
    if (!this.airborne) {
      const steerPower = STEER_RATE * this.handling * (0.35 + 0.65 * sp) * (0.4 + 0.6 * this.grip);
      this.x += this.steer * steerPower * dt;
      if (centrifugal) this.x -= track.curveAt(this.z) * sp * sp * CENTRIFUGAL * (2.25 - 1.25 * this.grip) * dt;
    }
    this.x = clamp(this.x, -MAX_X, MAX_X);
    this.offroad = Math.abs(this.x) > 1.02;

    const oldZ = this.z;
    this.z += this.speed * dt;
    this.followGround(dt, track, oldZ);

    const targetLean = -this.steer * 0.3 * Math.min(1, sp * 1.4) + track.curveAt(this.z) * 0.02 * sp;
    this.lean += (targetLean - this.lean) * (1 - Math.exp(-7 * dt));
  }

  /** Keeps the bike on the road surface, launching it off sharp crests. */
  followGround(dt: number, track: Track, _oldZ: number) {
    const ground = track.heightAt(this.z);
    if (this.airborne) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        this.y = ground;
        this.airborne = false;
        this.vy = 0;
        this.landed = true;
      }
      return;
    }
    if (Math.abs(ground - this.y) > 1500) {
      // teleport / remount far from where we were: just snap to the road
      this.y = ground;
      this.vy = 0;
      return;
    }
    const newVy = (ground - this.y) / Math.max(dt, 1e-4);
    // If the road drops away faster than gravity can pull us down, we fly.
    if (this.speed > 60 * MPH && newVy < this.vy - GRAVITY * dt * 1.15) {
      this.airborne = true;
      this.vy = Math.min(this.vy, this.speed * 0.5) - GRAVITY * dt;
      this.y += this.vy * dt;
      return;
    }
    this.vy = newVy;
    this.y = ground;
  }
  /** set for one frame after landing a jump */
  landed = false;

  startAttack(kind: AttackKind, side: -1 | 1) {
    if (this.attack || this.attackCooldown > 0 || !this.canFight) return false;
    const a = ATTACKS[kind];
    this.attack = { kind, side, t: 0, duration: a.duration, hitAt: a.hitAt, resolved: false };
    this.attackCooldown = a.duration + 0.08;
    return true;
  }

  /** Fires a nitro boost if one is left and none is burning. */
  startNitro(): boolean {
    if (this.nitroCharges <= 0 || this.nitroTime > 0 || this.state !== 'riding' || this.airborne) return false;
    this.nitroCharges--;
    this.nitroTime = NITRO.duration;
    return true;
  }

  /** Throws the rider off the bike. */
  startCrash(cause: string, severity = 1) {
    if (!this.onBike || this.state === 'finished') return;
    const v = this.speed;
    const headOn = cause === 'headon';
    this.crash = {
      cause,
      t: 0,
      rider: {
        z: this.z,
        x: this.x,
        h: 120,
        vz: headOn ? v * 0.25 + 600 : v * 0.5,
        vx: rand(-0.4, 0.4) + this.steer * 0.25,
        vh: 1200 + v * 0.08 * severity + (headOn ? 900 : 0),
        rot: 0,
        vrot: randSign() * rand(6, 11),
        landed: false,
        rest: 0,
      },
      bike: {
        z: this.z,
        x: this.x,
        h: 60,
        vz: headOn ? v * 0.1 : v * 0.45,
        vx: rand(-0.5, 0.5),
        vh: 500 + v * 0.05,
        rot: 0,
        vrot: randSign() * rand(3, 6),
        landed: false,
        rest: 0,
      },
    };
    this.state = 'crashing';
    this.attack = null;
    this.nitroTime = 0;
    this.boost = 0;
    this.speed = 0;
    this.airborne = false;
    this.throttle = 0;
    this.steer = 0;
  }

  /** Advances the tumbling bodies; returns true once the rider has come to rest. */
  updateCrash(dt: number): boolean {
    const c = this.crash!;
    c.t += dt;
    for (const b of [c.rider, c.bike]) {
      b.vh -= GRAVITY * 0.8 * dt;
      b.h += b.vh * dt;
      if (b.h <= 0) {
        b.h = 0;
        if (b.vh < -500) {
          b.vh = -b.vh * 0.32;
          b.landed = true;
        } else b.vh = 0;
      }
      const onGround = b.h <= 1;
      if (onGround) {
        b.vz = approach(b.vz, 0, (b === c.bike ? 6000 : 7500) * dt);
        b.vx *= 1 - 3 * dt;
        b.vrot *= 1 - 5 * dt;
        if (Math.abs(b.vrot) < 0.5) b.rot = approach(b.rot, Math.round(b.rot / Math.PI) * Math.PI, 3 * dt);
      }
      b.z += b.vz * dt;
      b.x = clamp(b.x + b.vx * dt, -MAX_X, MAX_X);
      b.rot += b.vrot * dt;
      if (onGround && b.vz < 40) b.rest += dt;
    }
    return c.rider.rest > 0.4 && c.bike.rest > 0.1;
  }

  /** Puts the rider back on the bike where it came to rest. */
  remount() {
    const c = this.crash;
    if (c) {
      this.z = c.bike.z;
      this.x = clamp(c.bike.x, -MAX_X, MAX_X);
    }
    this.crash = null;
    this.state = 'riding';
    this.speed = 0;
    this.lean = 0;
    this.invulnerable = 1.6;
    this.health = Math.max(this.health, this.maxHealth * 0.6);
  }

  tickTimers(dt: number) {
    this.lastHurt += dt;
    this.offBikeTime = this.crash ? this.offBikeTime + dt : 0;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.hitStun = Math.max(0, this.hitStun - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.attack) {
      this.attack.t += dt;
      if (this.attack.t >= this.attack.duration) this.attack = null;
    }
  }
}
