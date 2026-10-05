/**
 * Civilian traffic: cars travelling our way in the right lane and oncoming cars in the left lane.
 * Cars are recycled around the player so density stays constant however long the track is.
 */
import { CAR_LENGTH, MPH } from '../config';
import { rand, randPick } from '../engine/Rng';
import type { Track } from './Track';

export interface CarType {
  sprite: string;
  /** world height in units */
  height: number;
  length: number;
  width: number;
  truck?: boolean;
}

const SAME: CarType[] = [
  { sprite: 'cars/sedanRear', height: 800, length: CAR_LENGTH, width: 0.27 },
  { sprite: 'cars/pickupRear', height: 850, length: CAR_LENGTH * 1.1, width: 0.29 },
  { sprite: 'cars/sportsRear', height: 650, length: CAR_LENGTH * 0.95, width: 0.27 },
  { sprite: 'cars/vanRear', height: 1050, length: CAR_LENGTH * 1.1, width: 0.29 },
  { sprite: 'cars/wagonRear', height: 800, length: CAR_LENGTH * 1.1, width: 0.28 },
  { sprite: 'cars/semiRear', height: 1900, length: CAR_LENGTH * 2.6, width: 0.34, truck: true },
];
const ONCOMING: CarType[] = [
  { sprite: 'cars/sedanFront', height: 800, length: CAR_LENGTH, width: 0.27 },
  { sprite: 'cars/pickupFront', height: 850, length: CAR_LENGTH * 1.1, width: 0.29 },
  { sprite: 'cars/vanFront', height: 1050, length: CAR_LENGTH * 1.1, width: 0.29 },
  { sprite: 'cars/sportsFront', height: 650, length: CAR_LENGTH * 0.95, width: 0.27 },
  { sprite: 'cars/semiFront', height: 1900, length: CAR_LENGTH * 2.2, width: 0.34, truck: true },
];

export class Car {
  honked = 0;
  constructor(public type: CarType, public z: number, public x: number, public speed: number) {}
  get oncoming() {
    return this.speed < 0;
  }
}

export class Traffic {
  cars: Car[] = [];
  private window = 90000;

  constructor(private track: Track, carsPerMile: number) {
    const count = Math.round((carsPerMile * this.window) / (MPH * 3600)) + 2;
    // Start traffic well up the road so the pack gets rolling before the first oncoming car.
    for (let i = 0; i < count; i++) this.cars.push(this.spawn(track.startZ + rand(30000, this.window + 30000), i % 2 === 0));
  }

  private spawn(z: number, oncoming: boolean): Car {
    if (oncoming) {
      const t = randPick(ONCOMING);
      return new Car(t, z, rand(-0.62, -0.42), -rand(35, 60) * MPH);
    }
    const t = randPick(SAME);
    return new Car(t, z, rand(0.42, 0.62), rand(30, 55) * MPH * (t.truck ? 0.8 : 1));
  }

  update(dt: number, focusZ: number) {
    for (const c of this.cars) {
      c.z += c.speed * dt;
      c.honked = Math.max(0, c.honked - dt);
    }
    // Same-direction cars don't drive through each other.
    const same = this.cars.filter((c) => !c.oncoming).sort((a, b) => a.z - b.z);
    for (let i = 0; i < same.length - 1; i++) {
      const a = same[i], b = same[i + 1];
      if (b.z - a.z < (a.type.length + b.type.length) / 2 + 300 && Math.abs(a.x - b.x) < 0.5) a.speed = Math.min(a.speed, b.speed);
    }
    // Recycle cars far behind the action to somewhere ahead of it.
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const behind = focusZ - c.z > 9000;
      const tooFar = c.z - focusZ > this.window + 20000;
      if (behind || tooFar || c.z > this.track.finishZ + 60000) {
        const z = focusZ + rand(this.window * 0.45, this.window);
        if (z < this.track.length - 2000) this.cars[i] = this.spawn(z, c.oncoming);
      }
    }
  }
}
