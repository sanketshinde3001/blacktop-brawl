/**
 * Punches, kicks and club swings. An attack is resolved once, at its `hitAt` moment, against the
 * closest rider on the attacked side within reach.
 */
import { ATTACKS, isWeapon, type AttackKind, type Racer } from './Racer';
import { rand } from '../engine/Rng';

export interface HitResult {
  attacker: Racer;
  target: Racer;
  kind: AttackKind;
  damage: number;
  knockedOff: boolean;
  stole: boolean;
}

/** The player's arms are a bit longer than everyone else's - it keeps fights fun. */
export const PLAYER_REACH = 1.3;

/** Riders on `side` of `a` that an attack of this kind could reach, nearest first. */
export function targetsInReach(a: Racer, riders: Racer[], side: -1 | 1, kind: AttackKind): Racer[] {
  const spec = ATTACKS[kind];
  const k = a.isPlayer ? PLAYER_REACH : 1;
  return riders
    .filter((r) => {
      if (r === a || r.state !== 'riding') return false;
      const dx = (r.x - a.x) * side;
      return dx > 0.02 && dx < spec.reach * k && Math.abs(r.z - a.z) < spec.reachZ * k;
    })
    .sort((p, q) => Math.abs(p.z - a.z) + Math.abs(p.x - a.x) * 400 - (Math.abs(q.z - a.z) + Math.abs(q.x - a.x) * 400));
}

/** Nearest rider close enough to fight, and which side they're on. */
export function nearestFoe(a: Racer, riders: Racer[], range = 0.6, rangeZ = 420): { foe: Racer; side: -1 | 1 } | null {
  let best: Racer | null = null, bestD = Infinity;
  for (const r of riders) {
    if (r === a || r.state !== 'riding') continue;
    const dx = Math.abs(r.x - a.x), dz = Math.abs(r.z - a.z);
    if (dx < range && dz < rangeZ && dx > 0.03) {
      const d = dz + dx * 500;
      if (d < bestD) (bestD = d), (best = r);
    }
  }
  return best ? { foe: best, side: best.x < a.x ? -1 : 1 } : null;
}

export function resolveAttack(a: Racer, riders: Racer[], damageScale = 1, vsPlayerScale = 1): HitResult | null {
  const atk = a.attack;
  if (!atk || atk.resolved || atk.t < atk.hitAt) return null;
  atk.resolved = true;
  const target = targetsInReach(a, riders, atk.side, atk.kind)[0];
  if (!target || target.invulnerable > 0) return null;
  if (target.isPlayer) target.lastHurt = 0;
  const spec = ATTACKS[atk.kind];
  let damage = rand(spec.damage[0], spec.damage[1]) * damageScale;
  if (target.isCop) damage *= 0.7;
  if (target.isPlayer) damage *= vsPlayerScale;
  damage *= 1 - target.armour;
  target.health -= damage;
  target.hitStun = target.isPlayer ? 0.18 : 0.28;
  target.hitFlash = 0.18;
  target.x += atk.side * spec.push * (target.isPlayer ? 0.5 : 1) * target.pushScale;
  target.speed *= atk.kind === 'kick' ? 0.94 : 0.97;
  target.lean += atk.side * 0.25;
  if (target.attack && !target.attack.resolved) target.attack = null; // interrupted
  target.grudge = Math.min(1, target.grudge + (a.isPlayer ? 0.25 : 0));

  // Hitting an armed rider can knock the club loose into your hand.
  let stole = false;
  if (target.weapon && !a.weapon && !isWeapon(atk.kind)) {
    const swinging = !!target.attack && isWeapon(target.attack.kind);
    if (Math.random() < (swinging ? 0.65 : 0.2)) {
      a.weapon = target.weapon;
      target.weapon = null;
      stole = true;
    }
  }
  const knockedOff = target.health <= 0;
  if (knockedOff) {
    target.health = 0;
    target.startCrash('knockout', 0.8);
  }
  return { attacker: a, target, kind: atk.kind, damage, knockedOff, stole };
}
