/**
 * Shop upgrades: three tiers each. Engine, tyres and brakes are parts of the bike (they go with it
 * when you trade it in); armour and the nitro kit belong to you and stay.
 */
import type { BikeDef } from './bikes';

export type UpgradeId = 'engine' | 'tyres' | 'brakes' | 'armour' | 'nitro';
export type Upgrades = Record<UpgradeId, number>;

export const NO_UPGRADES: Upgrades = { engine: 0, tyres: 0, brakes: 0, armour: 0, nitro: 0 };
export const MAX_TIER = 3;

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** what each tier does, for the shop */
  effect: string;
  /** part of the bike (lost on trade-in) */
  bikePart: boolean;
  prices: [number, number, number];
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'engine', name: 'ENGINE TUNE', effect: '+4% top speed, +6% acceleration per stage', bikePart: true, prices: [700, 1700, 3600] },
  { id: 'tyres', name: 'RACE TYRES', effect: 'sharper steering, more grip in the rain and off-road', bikePart: true, prices: [500, 1300, 2800] },
  { id: 'brakes', name: 'BRAKES', effect: '+20% stopping power per stage', bikePart: true, prices: [400, 1000, 2200] },
  { id: 'armour', name: 'BODY ARMOUR', effect: '+15 health and 10% less damage per stage', bikePart: false, prices: [800, 2000, 4500] },
  { id: 'nitro', name: 'NITRO KIT', effect: '+1 nitro boost per race per stage', bikePart: false, prices: [600, 1500, 3200] },
];

/** Bike parts cost more on pricier bikes. */
export function upgradePrice(u: UpgradeDef, tier: number, bike: BikeDef): number {
  const base = u.prices[Math.max(0, Math.min(2, tier))];
  const k = u.bikePart ? (bike.cls === 'RAT' ? 1 : bike.cls === 'SPORT' ? 1.5 : 2.2) : 1;
  return Math.round((base * k) / 10) * 10;
}

/** What the race needs from the upgrades. */
export function upgradeEffects(u: Upgrades) {
  return {
    topSpeed: 1 + 0.04 * u.engine,
    accel: 1 + 0.06 * u.engine,
    handling: 1 + 0.05 * u.tyres,
    grip: 0.06 * u.tyres,
    offroad: 0.05 * u.tyres,
    brakes: 1 + 0.2 * u.brakes,
    health: 15 * u.armour,
    armour: 0.1 * u.armour,
    nitro: u.nitro,
  };
}
