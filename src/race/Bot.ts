/**
 * A human-like driver for the player's bike, used by the headless simulator to measure difficulty
 * (and handy for automated testing). Unlike the rival AI it goes through the same controls and
 * physics as a real player, including curve drift, and reacts to traffic with a delay.
 */
import { CENTRIFUGAL, MPH } from '../config';
import { clamp } from '../engine/math';
import { planDodge } from './AI';
import { nearestFoe } from './Combat';
import { NO_CONTROLS, type Controls, type Race } from './Race';
import type { Car } from './Traffic';

export interface BotSkill {
  /** seconds of warning the bot needs before it reacts to a car (bigger = better) */
  reaction: number;
  /** attacks per second when someone is alongside */
  aggression: number;
  /** preferred lane */
  lane: number;
}

export const AVERAGE_PLAYER: BotSkill = { reaction: 1.1, aggression: 2, lane: 0.35 };

const memory = new WeakMap<Race, { car: Car; x: number }>();

export function botControls(race: Race, skill: BotSkill = AVERAGE_PLAYER, dt = 1 / 60): Controls {
  const p = race.player;
  if (p.state !== 'riding') return NO_CONTROLS;
  const sp = p.speed / p.topSpeed;
  let targetX = skill.lane;
  // Pick a side per car and stick with it (no flip-flopping), but re-plan when a different car
  // becomes the most urgent threat. Reacts only once a car is close enough for this skill level.
  const dodge = planDodge(p, race.traffic.cars);
  if (dodge) {
    const c = dodge.car;
    const dz = c.z - p.z;
    const closing = p.speed - c.speed;
    const stuckBehind = dz > 0 && dz < 1800 && Math.abs(c.x - p.x) < 0.45;
    const noticed = stuckBehind || dz <= 0 || (closing > 0 && dz / closing < skill.reaction);
    if (noticed) {
      const memo = memory.get(race);
      if (memo && memo.car === c) targetX = memo.x;
      else {
        targetX = dodge.x;
        memory.set(race, { car: c, x: dodge.x });
      }
    }
  }
  // feed-forward against the curve's pull + proportional correction
  const curve = race.track.curveAt(p.z);
  const drift = curve * sp * sp * CENTRIFUGAL;
  const power = 1.9 * p.handling * (0.35 + 0.65 * sp);
  const steer = clamp((targetX - p.x) * 3 + drift / power, -1, 1);
  const brake = Math.abs(curve) > 4.5 && sp > 0.9 ? 1 : 0;
  const foe = nearestFoe(p, race.riders, 0.55, 380);
  const swing = !!foe && Math.random() < skill.aggression * dt;
  return {
    ...NO_CONTROLS,
    steer,
    throttle: brake ? 0 : 1,
    brake,
    attackL: swing && foe!.side < 0,
    attackR: swing && foe!.side > 0,
    kick: false,
  };
}

/** mph → units/s helper for tests */
export const mph = (v: number) => v * MPH;
