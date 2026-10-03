/** The player's persistent progress: level, cash, bike and which tracks are qualified. */
import { LEVEL_COUNT, QUALIFY_PLACE, STARTING_CASH, TRACK_COUNT } from '../config';
import { bikeById, repairCost, STARTER_BIKE, type BikeDef } from '../data/bikes';
import { levelDef, prizeFor, type Difficulty } from '../data/levels';
import { NO_UPGRADES, UPGRADES, upgradePrice, type UpgradeId, type Upgrades } from '../data/upgrades';

export type RaceEnd = 'finished' | 'busted' | 'wrecked' | 'quit';

/** What a race did to your wallet and your progress. */
export interface Settlement {
  prize: number;
  fine: number;
  repair: number;
  qualified: boolean;
  /** false when a fine or repair bill couldn't be paid: game over */
  solvent: boolean;
}

export interface CareerState {
  name: string;
  level: number;
  money: number;
  bike: string;
  qualified: boolean[];
  difficulty: Difficulty;
  races: number;
  wins: number;
  /** shop upgrades (missing in saves from before upgrades existed) */
  upgrades?: Upgrades;
}

export function newCareer(name = 'RIDER', difficulty: Difficulty = 'normal'): CareerState {
  return {
    name,
    level: 1,
    money: STARTING_CASH,
    bike: STARTER_BIKE,
    qualified: Array(TRACK_COUNT).fill(false),
    difficulty,
    races: 0,
    wins: 0,
    upgrades: { ...NO_UPGRADES },
  };
}

export class Career {
  constructor(public s: CareerState) {}

  get bike(): BikeDef {
    return bikeById(this.s.bike);
  }

  get upgrades(): Upgrades {
    return { ...NO_UPGRADES, ...(this.s.upgrades ?? {}) };
  }

  /** Price of the next stage of an upgrade, or null when maxed out. */
  nextUpgradePrice(id: UpgradeId): number | null {
    const tier = this.upgrades[id];
    if (tier >= 3) return null;
    return upgradePrice(UPGRADES.find((u) => u.id === id)!, tier, this.bike);
  }

  buyUpgrade(id: UpgradeId): boolean {
    const price = this.nextUpgradePrice(id);
    if (price === null || this.s.money < price) return false;
    this.s.money -= price;
    this.s.upgrades = { ...this.upgrades, [id]: this.upgrades[id] + 1 };
    return true;
  }

  /** What the parts fitted to the current bike add to its trade-in value (half what they cost). */
  partsValue(): number {
    let v = 0;
    for (const u of UPGRADES) if (u.bikePart) for (let t = 0; t < this.upgrades[u.id]; t++) v += upgradePrice(u, t, this.bike);
    return Math.round(v * 0.5 / 10) * 10;
  }

  /** New bike: the old one's parts go with it. */
  changeBike(id: string) {
    this.s.bike = id;
    this.s.upgrades = { ...this.upgrades, engine: 0, tyres: 0, brakes: 0 };
  }

  get levelComplete(): boolean {
    return this.s.qualified.every(Boolean);
  }

  get isFinalLevel(): boolean {
    return this.s.level >= LEVEL_COUNT;
  }

  qualifiedCount(): number {
    return this.s.qualified.filter(Boolean).length;
  }

  earn(amount: number) {
    this.s.money += amount;
  }

  /** Pays a fine/repair. Returns false if the player can't cover it (game over). */
  pay(amount: number): boolean {
    if (this.s.money < amount) {
      this.s.money = 0;
      return false;
    }
    this.s.money -= amount;
    return true;
  }

  /** Applies a race result: prize money, qualification, fines and repair bills. */
  settle(kind: RaceEnd, place: number, trackIndex: number): Settlement {
    const level = this.s.level;
    const out: Settlement = { prize: 0, fine: 0, repair: 0, qualified: false, solvent: true };
    this.s.races++;
    if (kind === 'finished') {
      out.prize = prizeFor(level, place);
      this.earn(out.prize);
      out.qualified = place <= QUALIFY_PLACE;
      if (out.qualified) this.s.qualified[trackIndex] = true;
      if (place === 1) this.s.wins++;
    } else if (kind === 'busted') {
      out.fine = levelDef(level).fine;
      out.solvent = this.pay(out.fine);
    } else if (kind === 'wrecked') {
      out.repair = repairCost(this.bike, level);
      out.solvent = this.pay(out.repair);
    }
    return out;
  }

  advanceLevel() {
    this.s.level = Math.min(LEVEL_COUNT, this.s.level + 1);
    this.s.qualified = Array(TRACK_COUNT).fill(false);
  }
}
