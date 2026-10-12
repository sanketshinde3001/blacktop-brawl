/**
 * Achievements + lifetime stats. Listens to the game event bus, keeps counters in the records
 * store and shows a toast when something unlocks. Everything is local; nothing is sent anywhere.
 */
import { WIDTH } from '../config';
import { MAX_TIER, type UpgradeId } from '../data/upgrades';
import type { Game } from '../engine/Game';
import { FONT_BODY } from '../ui/draw';
import type { GameEvent } from './Events';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'firstblood', name: 'FIRST BLOOD', desc: 'Knock a rival off their bike' },
  { id: 'copknocker', name: 'COP KNOCKER', desc: 'Deck a police officer' },
  { id: 'sticky', name: 'STICKY FINGERS', desc: "Steal a rival's weapon" },
  { id: 'arsenal', name: 'ARSENAL', desc: 'Get your hands on a club, a chain and a crowbar' },
  { id: 'winner', name: 'WINNER', desc: 'Win a race' },
  { id: 'hattrick', name: 'HAT TRICK', desc: 'Win three races in a row' },
  { id: 'wrecking', name: 'WRECKING BALL', desc: 'Deck five riders in one race' },
  { id: 'clean', name: 'NOT A SCRATCH', desc: 'Win a race without crashing once' },
  { id: 'nightrider', name: 'NIGHT RIDER', desc: 'Qualify in a night race' },
  { id: 'rainman', name: 'SINGING IN THE RAIN', desc: 'Win a race in the rain' },
  { id: 'nos', name: 'NOS ADDICT', desc: 'Fire 25 nitro boosts' },
  { id: 'levelup', name: 'MOVING UP', desc: 'Qualify on all five roads of a level' },
  { id: 'champion', name: 'CHAMPION', desc: 'Win the level 5 championship' },
  { id: 'busted', name: 'YOU HAVE THE RIGHT...', desc: 'Get busted by the cops' },
  { id: 'loaded', name: 'FULLY LOADED', desc: 'Max out any upgrade' },
  { id: 'topshelf', name: 'TOP SHELF', desc: 'Buy the Apex 1300 Turbo' },
  { id: 'stage5', name: 'ROAD WARRIOR', desc: 'Reach stage 5 of an endless run' },
  { id: 'stage10', name: 'IRON BUTT', desc: 'Reach stage 10 of an endless run' },
  { id: 'daily', name: 'DAILY GRIND', desc: 'Finish a daily challenge' },
  { id: 'versus', name: 'HEAD TO HEAD', desc: 'Win a two-player race' },
];

interface Toast {
  def: AchievementDef;
  t: number;
}

export class Achievements {
  private toasts: Toast[] = [];

  constructor(private game: Game) {
    game.events.on((e) => this.on(e));
    game.overlays.push((ctx, dt) => this.render(ctx, dt));
  }

  get unlocked(): Set<string> {
    return new Set(this.game.records.achievements);
  }

  private stat(key: string, add = 1): number {
    const s = this.game.records.stats;
    s[key] = (s[key] ?? 0) + add;
    return s[key];
  }

  unlock(id: string) {
    const rec = this.game.records;
    if (rec.achievements.includes(id)) return;
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return;
    rec.achievements.push(id);
    this.game.saveRecords();
    this.toasts.push({ def, t: 0 });
    this.game.audio.play('sfx/achievement', { volume: 0.7 });
  }

  private on(e: GameEvent) {
    const rec = this.game.records;
    switch (e.type) {
      case 'race': {
        const r = e.e;
        if (r.type === 'hit' && r.hit.attacker.isPlayer) {
          if (r.hit.knockedOff) {
            this.unlock(r.hit.target.isCop ? 'copknocker' : 'firstblood');
            this.stat('knockouts');
          }
          if (r.hit.stole) this.unlock('sticky');
          const w = r.hit.attacker.weapon;
          if (r.hit.stole && w && !rec.weapons.includes(w)) {
            rec.weapons.push(w);
            if (rec.weapons.length >= 3) this.unlock('arsenal');
          }
        }
        if (r.type === 'nitro' && this.stat('nitros') >= 25) this.unlock('nos');
        break;
      }
      case 'raceEnd': {
        const o = e.outcome;
        this.stat('races');
        if (o.kind === 'busted') this.unlock('busted');
        if (o.knockouts >= 5) this.unlock('wrecking');
        if (o.kind === 'finished' && o.place === 1) {
          this.stat('wins');
          this.unlock('winner');
          if (this.stat('winStreak') >= 3) this.unlock('hattrick');
          if (o.crashes === 0) this.unlock('clean');
          if (o.weather === 'rain') this.unlock('rainman');
        } else rec.stats.winStreak = 0;
        if (o.kind === 'finished' && o.place <= 4 && o.weather === 'night') this.unlock('nightrider');
        break;
      }
      case 'runEnd':
        if (e.run.mode === 'endless' && e.run.stage >= 5) this.unlock('stage5');
        if (e.run.mode === 'endless' && e.run.stage >= 10) this.unlock('stage10');
        if (e.run.mode === 'daily' && e.outcome.kind === 'finished') this.unlock('daily');
        break;
      case 'levelUp':
        this.unlock('levelup');
        break;
      case 'champion':
        this.unlock('champion');
        break;
      case 'buy':
        if (e.what === 'bike' && e.id === 'apex') this.unlock('topshelf');
        if (e.what === 'upgrade' && this.game.career && this.game.career.upgrades[e.id as UpgradeId] >= MAX_TIER) this.unlock('loaded');
        break;
      case 'twoPlayer':
        if (e.winner >= 0) this.unlock('versus');
        break;
    }
    this.game.saveRecords();
  }

  private render(ctx: CanvasRenderingContext2D, dt: number) {
    if (!this.toasts.length) return;
    const t = this.toasts[0];
    t.t += dt;
    const dur = 3.6;
    if (t.t > dur) {
      this.toasts.shift();
      return;
    }
    const k = Math.min(1, t.t * 5, (dur - t.t) * 5);
    const w = 440, h = 64, x = WIDTH - w - 18 + (1 - k) * (w + 30), y = 18;
    ctx.save();
    ctx.fillStyle = 'rgba(8,8,12,0.92)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = '#ffd23a';
    ctx.lineWidth = 3;
    ctx.stroke();
    // trophy badge
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath();
    ctx.arc(x + 34, y + h / 2, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1206';
    ctx.font = `16px ${FONT_BODY}`;
    ctx.textAlign = 'center';
    ctx.fillText('★', x + 34, y + h / 2 + 7);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9aa3b2';
    ctx.font = `8px ${FONT_BODY}`;
    ctx.fillText('ACHIEVEMENT UNLOCKED', x + 66, y + 22);
    ctx.fillStyle = '#ffd23a';
    ctx.font = `12px ${FONT_BODY}`;
    ctx.fillText(t.def.name, x + 66, y + 40, w - 80);
    ctx.fillStyle = '#ddd';
    ctx.font = `7px ${FONT_BODY}`;
    ctx.fillText(t.def.desc.toUpperCase(), x + 66, y + 55, w - 80);
    ctx.restore();
  }
}
