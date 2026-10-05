/**
 * Brains for the rival riders and the police. They drive the same Racer physics as the player by
 * setting steer / throttle / brake and starting attacks.
 */
import { MPH, RIDER_HALF_WIDTH } from '../config';
import { clamp } from '../engine/math';
import { rand } from '../engine/Rng';
import { nearestFoe } from './Combat';
import type { Racer } from './Racer';
import type { Car } from './Traffic';
import type { Track } from './Track';

export interface AIWorld {
  track: Track;
  riders: Racer[];
  cars: Car[];
  player: Racer;
  /** every human rider (two in split screen) */
  humans: Racer[];
  aggressionScale: number;
  time: number;
}

/**
 * Looks ahead for the most urgent car in our path. Returns a lateral position that clears it
 * (preferring the side with more road and no other car), or null when the way is clear.
 */
export function dodgeTraffic(r: Racer, cars: Car[]): number | null {
  const d = planDodge(r, cars);
  return d ? d.x : null;
}

/** Like dodgeTraffic, but also says whether every escape route is blocked (so: brake). */
export function planDodge(r: Racer, cars: Car[]): { x: number; squeezed: boolean; car: Car } | null {
  let threat: Car | null = null, soonest = Infinity;
  for (const c of cars) {
    const dz = c.z - r.z;
    // still alongside a car we're overtaking counts as a threat until we're clear of its tail
    if (dz < -(c.type.length / 2 + 250)) continue;
    const closing = r.speed - c.speed;
    // a car right ahead in our lane is something to pass even if we're not gaining on it (yet)
    const tailgating = dz > 0 && dz < 1800 && closing > -8 * MPH;
    if (dz > 0 && closing <= 0 && !tailgating) continue;
    const time = dz <= 0 ? 0 : tailgating && closing <= 0 ? 1.5 : dz / closing;
    if (time > 2.6 || time >= soonest) continue;
    if (Math.abs(r.x - c.x) < c.type.width + RIDER_HALF_WIDTH + 0.22) (threat = c), (soonest = time);
  }
  if (!threat) return null;
  const gap = threat.type.width + RIDER_HALF_WIDTH + 0.3;
  const candidates = [threat.x - gap, threat.x + gap].filter((x) => Math.abs(x) < 0.97);
  const blocked = (x: number) =>
    cars.some((c) => c !== threat && Math.abs(c.x - x) < c.type.width + 0.2 && c.z - r.z > -c.type.length && (c.z - r.z) / Math.max(1, r.speed - c.speed) < 2.6);
  const options = candidates.filter((x) => !blocked(x));
  const pool = options.length ? options : candidates.length ? candidates : [threat.x > 0 ? -0.5 : 0.5];
  return { x: pool.sort((a, b) => Math.abs(a - r.x) - Math.abs(b - r.x))[0], squeezed: !options.length, car: threat };
}

/** The human a rival or cop cares about: the nearest one still in the race. */
function focus(r: Racer, w: AIWorld): Racer {
  if (w.humans.length < 2) return w.player;
  let best = w.player, bd = Infinity;
  for (const h of w.humans) {
    if (h.out) continue;
    const d = Math.abs(h.bodyZ - r.z);
    if (d < bd) (bd = d), (best = h);
  }
  return best;
}

export function updateRival(r: Racer, dt: number, w: AIWorld) {
  if (r.state !== 'riding' && r.state !== 'finished') return;
  const p = focus(r, w);

  // --- speed -------------------------------------------------------------------------
  let cruise = r.cruise;
  const curve = Math.abs(w.track.curveAt(r.z + 1500));
  if (curve > 3.5) cruise *= 0.94;
  if (r.state === 'finished') cruise *= 0.55;
  else if (p.state !== 'finished' && r !== p) {
    // Gentle rubber band keeps the pack around the player, like the original.
    // runaway leaders ease off so the pack stays around you; stragglers catch up a little
    const d = r.z - p.z;
    if (d > 9000) cruise *= 0.86;
    else if (d > 4500) cruise *= 0.92;
    else if (d < -9000) cruise *= 1.05;
  }
  if (r.offroad) cruise = Math.min(cruise, r.topSpeed * 0.44);

  // --- lateral target ----------------------------------------------------------------
  r.laneTimer -= dt;
  if (r.laneTimer <= 0) {
    r.targetX = rand(-0.75, 0.75);
    r.laneTimer = rand(2, 6);
  }
  let targetX = r.targetX;

  // Pick fights: drift alongside the player (or anyone we hold a grudge against).
  const aggression = r.aggression * w.aggressionScale;
  const dzp = p.z - r.z;
  if (r !== p && p.state === 'riding' && r.state === 'riding' && Math.abs(dzp) < 1100 && aggression + r.grudge > 0.75) {
    const side = r.x < p.x ? -1 : 1;
    targetX = p.x + side * 0.3;
  }

  // Don't ride up the back of slower riders.
  for (const o of w.riders) {
    if (o === r || !o.onBike) continue;
    const dz = o.z - r.z;
    if (dz > 0 && dz < 700 && Math.abs(o.x - r.x) < 0.26 && o.speed < r.speed) {
      targetX = o.x + (r.x <= o.x ? -0.32 : 0.32);
      if (Math.abs(targetX) > 0.9) targetX = o.x + (r.x <= o.x ? 0.32 : -0.32);
    }
  }
  targetX = clamp(targetX, -0.88, 0.88);
  // Dodging traffic beats everything else; if there's no gap, back off.
  const dodge = planDodge(r, w.cars);
  if (dodge) {
    targetX = dodge.x;
    if (dodge.squeezed) cruise = Math.min(cruise, r.speed * 0.8);
  }

  const err = targetX - r.x;
  r.steer = clamp(err * (dodge ? 8 : 5), -1, 1);
  if (Math.abs(err) < 0.02) r.steer = 0;
  r.throttle = r.speed < cruise ? 1 : 0;
  r.brake = r.speed > cruise * 1.08 ? (dodge?.squeezed ? 1 : 0.5) : 0;

  // --- fighting ------------------------------------------------------------------------
  if (r.state === 'riding' && !r.attack && r.attackCooldown <= 0 && r.canFight) {
    const near = nearestFoe(r, w.riders, 0.5, 340);
    if (near) {
      const targetIsPlayer = near.foe === p;
      // Rivals mostly gang up on the player; they only occasionally brawl with each other.
      const want = (targetIsPlayer ? (aggression + r.grudge * 0.8) * (p.invulnerable > 0 ? 0 : 1.0) : aggression * 0.3) * dt;
      if (Math.random() < want) {
        const kind = r.weapon ?? (Math.random() < 0.35 ? 'kick' : 'punch');
        r.startAttack(kind, near.side);
        r.attackCooldown += rand(0.4, 1.4) / Math.max(0.3, aggression);
      }
    }
  }
  r.grudge = Math.max(0, r.grudge - dt * 0.02);
}

/**
 * Cops park at the roadside, give chase when the player rides past, hit you with a nightstick,
 * and bust you if they catch you off your bike.
 */
export function updateCop(c: Racer, dt: number, w: AIWorld, copTop: number): 'activated' | 'bust' | null {
  // stick with whoever woke us up, unless they're out of the race
  if (!c.copTarget || c.copTarget.out || c.copTarget.state === 'finished') c.copTarget = focus(c, w);
  const p = c.copTarget;
  let event: 'activated' | 'bust' | null = null;
  if (c.copState === 'gone') {
    c.throttle = 0;
    c.brake = 1;
    c.steer = clamp((c.copSide * 1.5 - c.x) * 3, -1, 1);
    return null;
  }
  if (c.copState === 'parked') {
    c.speed = 0;
    c.throttle = 0;
    const dz = c.z - p.bodyZ;
    if (dz < 2200 && dz > -400 && p.state !== 'finished') {
      c.copState = 'chase';
      event = 'activated';
    }
    return event;
  }
  if (c.state !== 'riding') return null;

  const playerDown = p.state === 'crashing' || p.state === 'down' || p.state === 'running';
  // grace period: a quick remount gets you away; dawdle near a cop and you're nicked
  if (playerDown && p.offBikeTime > 1.5 && Math.abs(p.bodyZ - c.z) < 3500) c.copState = 'arrest';
  if (!playerDown && c.copState === 'arrest') c.copState = 'chase';

  if (c.copState === 'arrest') {
    const dz = p.bodyZ - c.z;
    const targetSpeed = clamp(dz * 0.9, 0, copTop * MPH * 0.7);
    c.throttle = c.speed < targetSpeed ? 1 : 0;
    c.brake = c.speed > targetSpeed + 5 * MPH ? 1 : 0;
    c.steer = clamp((p.bodyX + 0.28 - c.x) * 4, -1, 1);
    if (Math.abs(dz) < 380 && c.speed < 25 * MPH) event = 'bust';
    return event;
  }

  // chase
  if (p.state === 'finished' || c.z < p.z - 16000) {
    c.copState = 'gone';
    return null;
  }
  const dz = p.z - c.z;
  const target = dz > 0 ? Math.min(copTop * MPH, p.speed + 22 * MPH + dz * 0.1) : Math.max(0, p.speed - 4 * MPH);
  c.throttle = c.speed < target ? 1 : 0;
  c.brake = c.speed > target + 10 * MPH ? 0.6 : 0;
  const side = c.x < p.x ? -1 : 1;
  let tx = Math.abs(dz) < 1500 ? p.x + side * 0.3 : p.x;
  tx = clamp(dodgeTraffic(c, w.cars) ?? tx, -0.95, 0.95);
  c.steer = clamp((tx - c.x) * 5, -1, 1);

  if (!c.attack && c.attackCooldown <= 0 && c.canFight && Math.abs(dz) < 330) {
    const dx = (p.x - c.x) * (p.x < c.x ? -1 : 1);
    if (dx > 0.04 && dx < 0.55 && Math.random() < 1.1 * dt) {
      c.startAttack('club', p.x < c.x ? -1 : 1);
      c.attackCooldown += rand(0.5, 1.2);
    }
  }
  return event;
}
