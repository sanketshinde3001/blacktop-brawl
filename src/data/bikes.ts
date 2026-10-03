/**
 * Bike catalogue, three classes as in the original: rat bikes, sport bikes and super bikes.
 * topSpeed is in mph; accel is mph/s from a standstill; handling scales steering;
 * durability is how much crash damage the bike soaks up before it is wrecked.
 */

export type BikeClass = 'RAT' | 'SPORT' | 'SUPER';

export interface BikeDef {
  id: string;
  name: string;
  cls: BikeClass;
  price: number;
  cc: number;
  weight: number;
  topSpeed: number;
  accel: number;
  handling: number;
  durability: number;
  blurb: string;
  /** body paint [main, accent], used by the first-person cockpit */
  paint: [string, string];
  /** off-road speed limit as a fraction of top speed (default OFFROAD_LIMIT) */
  offroad?: number;
}

export const BIKES: BikeDef[] = [
  { id: 'straycat', name: 'Stray Cat 350', cls: 'RAT', price: 1000, cc: 350, weight: 380, topSpeed: 112, accel: 19, handling: 0.9, durability: 55, blurb: "It runs. Mostly. Don't ask about the brakes.", paint: ['#9c3a2e', '#d8d2c4'] },
  { id: 'mongrel', name: 'Mongrel 450', cls: 'RAT', price: 2400, cc: 450, weight: 405, topSpeed: 121, accel: 21, handling: 0.92, durability: 62, blurb: 'Built from three bikes and a lawnmower. Tough as nails.', paint: ['#6c6f74', '#a33a2a'] },
  { id: 'jackal', name: 'Jackal 500', cls: 'RAT', price: 3900, cc: 500, weight: 425, topSpeed: 130, accel: 23, handling: 0.95, durability: 68, blurb: 'The meanest rat on the road. Cheap thrills.', paint: ['#1d3566', '#c9ced8'] },
  { id: 'kestrel', name: 'Kestrel 600', cls: 'SPORT', price: 6400, cc: 600, weight: 410, topSpeed: 142, accel: 26, handling: 1.02, durability: 66, blurb: 'Light, twitchy and quick off the line.', paint: ['#e6e7ea', '#c8202a'] },
  { id: 'raptor', name: 'Raptor 750', cls: 'SPORT', price: 9200, cc: 750, weight: 440, topSpeed: 151, accel: 28, handling: 1.0, durability: 72, blurb: 'Plenty of grunt, corners like it is on rails.', paint: ['#1f8a3a', '#141416'] },
  { id: 'banshee', name: 'Banshee 750R', cls: 'SPORT', price: 12500, cc: 750, weight: 430, topSpeed: 160, accel: 30, handling: 1.05, durability: 70, blurb: 'A race replica that screams all the way to redline.', paint: ['#18181b', '#f07a14'] },
  { id: 'inferno', name: 'Inferno 900', cls: 'SUPER', price: 16500, cc: 900, weight: 470, topSpeed: 170, accel: 32, handling: 1.0, durability: 80, blurb: 'Hot-blooded superbike. Burns rubber and wallets.', paint: ['#c4161c', '#f5c518'] },
  { id: 'tempest', name: 'Tempest 1000', cls: 'SUPER', price: 21000, cc: 1000, weight: 465, topSpeed: 180, accel: 34, handling: 1.06, durability: 84, blurb: 'Silky smooth and brutally fast.', paint: ['#b9bec6', '#1f56c8'] },
  { id: 'nightmare', name: 'Nightmare 1100', cls: 'SUPER', price: 27500, cc: 1100, weight: 495, topSpeed: 192, accel: 36, handling: 1.04, durability: 92, blurb: 'The fastest thing on two wheels. Your rivals will have nightmares.', paint: ['#17171a', '#c9a227'] },
  // later additions (kept at the end: passwords store the index into this list)
  { id: 'mudcat', name: 'Mudcat 650', cls: 'RAT', price: 5200, cc: 650, weight: 350, topSpeed: 134, accel: 25, handling: 1.08, durability: 64, offroad: 0.85, blurb: 'Knobby tyres and long legs. Shortcuts? What shortcuts?', paint: ['#e8e6e0', '#f07a14'] },
  { id: 'vandal', name: 'Vandal 883', cls: 'RAT', price: 7800, cc: 883, weight: 560, topSpeed: 137, accel: 24, handling: 0.88, durability: 104, blurb: 'Built like a bank vault. Punches bounce right off it.', paint: ['#6b1414', '#d8d8d8'] },
  { id: 'apex', name: 'Apex 1300 Turbo', cls: 'SUPER', price: 36000, cc: 1300, weight: 480, topSpeed: 206, accel: 39, handling: 1.06, durability: 90, blurb: 'Turbocharged insanity. Street legal in zero states.', paint: ['#3b1a5a', '#14d4c4'] },
];

/** The catalogue in shop order (cheapest first). */
export const SHOP_BIKES: BikeDef[] = [...BIKES].sort((a, b) => a.price - b.price);

export const STARTER_BIKE = 'straycat';

export function bikeById(id: string): BikeDef {
  return BIKES.find((b) => b.id === id) ?? BIKES[0];
}

export function bikeIndex(id: string): number {
  return Math.max(0, BIKES.findIndex((b) => b.id === id));
}

/** Trade-in value when buying a new bike. */
export function tradeInValue(b: BikeDef): number {
  return Math.round((b.price * 0.5) / 10) * 10;
}

/** Cost to fix a wrecked bike. */
export function repairCost(b: BikeDef, level: number): number {
  return Math.max(300, Math.round((b.price * (0.28 + level * 0.04)) / 10) * 10);
}
