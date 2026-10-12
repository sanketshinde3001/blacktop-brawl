/**
 * Game-wide events (separate from a race's own event list) so systems like achievements and
 * stats can listen without the scenes knowing about them.
 */
import type { RaceEvent } from '../race/Race';
import type { RaceOutcome } from '../scenes/RaceScene';
import type { RunState } from './Runs';

export type GameEvent =
  | { type: 'race'; e: RaceEvent }
  | { type: 'raceEnd'; outcome: RaceOutcome }
  | { type: 'runEnd'; run: RunState; outcome: RaceOutcome; over: boolean }
  | { type: 'levelUp'; level: number }
  | { type: 'champion' }
  | { type: 'buy'; what: 'bike' | 'upgrade'; id: string }
  | { type: 'nitro' }
  | { type: 'twoPlayer'; winner: number };

export class EventBus {
  private subs: ((e: GameEvent) => void)[] = [];
  on(fn: (e: GameEvent) => void) {
    this.subs.push(fn);
  }
  emit(e: GameEvent) {
    for (const fn of this.subs) fn(e);
  }
}
