/** Everything after the finish line: result + money, standings, level complete, game over, victory. */
import { HEIGHT, QUALIFY_PLACE, WIDTH } from '../config';
import { prizeFor } from '../data/levels';
import { riderById } from '../data/riders';
import { TRACKS, trackById } from '../data/tracks';
import type { Game } from '../engine/Game';
import { formatMoney, formatTime, ordinal } from '../engine/math';
import { randPick } from '../engine/Rng';
import { Scene } from '../engine/Scene';
import { encodePassword } from '../game/Password';
import { Storage } from '../game/Storage';
import { blink, COLORS, cover, dialogue, panel, portrait, text, vignette } from '../ui/draw';
import type { RaceOutcome } from './RaceScene';

export class ResultScene extends Scene {
  private headline = '';
  private headColor: string = COLORS.yellow;
  private lines: [string, string][] = [];
  private speaker = { name: '', portrait: '', line: '' };
  private art = 'ui/lounge';
  private gameOver = false;
  private stamp = '';

  constructor(game: Game, private o: RaceOutcome) {
    super(game);
  }

  enter() {
    const c = this.game.career!;
    const a = this.game.audio;
    const voice = this.game.options.voice;
    const o = this.o;
    const trackIndex = TRACKS.findIndex((t) => t.id === o.track);
    const result = c.settle(o.kind, o.place, trackIndex);
    a.stopMusic(0.3);

    if (o.kind === 'finished') {
      const prize = result.prize;
      const qualified = result.qualified;
      this.headline = o.place === 1 ? 'YOU WON!' : `YOU PLACED ${ordinal(o.place)}`;
      this.headColor = qualified ? COLORS.green : COLORS.yellow;
      this.stamp = qualified ? 'QUALIFIED' : 'NOT QUALIFIED';
      this.lines = [
        ['TIME', formatTime(o.time)],
        ['PRIZE MONEY', `+${formatMoney(prize)}`],
        ['RIVALS DECKED', String(o.knockouts)],
        ['CASH', formatMoney(c.s.money)],
      ];
      this.art = o.place === 1 ? 'ui/victory' : 'ui/lounge';
      a.jingle(qualified ? 'music/win' : 'music/lose');
      if (voice) setTimeout(() => a.voice(qualified ? 'voice/qualified' : 'voice/notqualified'), 900);
      // A rival reacts: the winner gloats, or the runner-up grumbles if you won.
      const other = o.results.find((r) => !r.isPlayer && (o.place === 1 ? true : r === o.results[0]));
      const def = riderById(other?.id ?? '') ?? riderById('mongo')!;
      this.speaker = { name: def.name, portrait: `portraits/${def.id}`, line: randPick(o.place === 1 ? def.sore : def.gloat) };
    } else if (o.kind === 'busted') {
      const fine = result.fine;
      this.headline = 'BUSTED!';
      this.headColor = COLORS.blue;
      this.art = 'ui/busted';
      const paid = result.solvent;
      this.gameOver = !paid;
      this.lines = [
        ['FINE', `-${formatMoney(fine)}`],
        ['CASH', formatMoney(c.s.money)],
      ];
      this.stamp = paid ? 'NOT QUALIFIED' : "CAN'T PAY";
      this.speaker = {
        name: 'Officer Krupke',
        portrait: 'portraits/cop',
        line: paid ? `Reckless endangerment, assault with a motorcycle... that's ${formatMoney(fine)}, smart guy.` : "No money? Then that bike is impounded. You're done, pal.",
      };
      a.jingle('music/busted');
    } else if (o.kind === 'wrecked') {
      const cost = result.repair;
      this.headline = 'WRECKED!';
      this.headColor = COLORS.red;
      this.art = 'ui/wrecked';
      const paid = result.solvent;
      this.gameOver = !paid;
      this.lines = [
        ['REPAIRS', `-${formatMoney(cost)}`],
        ['CASH', formatMoney(c.s.money)],
      ];
      this.stamp = paid ? 'NOT QUALIFIED' : "CAN'T PAY";
      this.speaker = {
        name: 'Greasy Gus',
        portrait: 'portraits/mechanic',
        line: paid ? `Bent forks, cracked frame, what's left of the tank... ${formatMoney(cost)} and she'll run again.` : "Can't pay for the repairs? Then that pile of junk is mine now.",
      };
      a.jingle('music/lose');
    } else {
      this.headline = 'RACE FORFEITED';
      this.headColor = COLORS.grey;
      this.art = 'ui/lounge';
      this.stamp = 'NOT QUALIFIED';
      this.lines = [['CASH', formatMoney(c.s.money)]];
      const def = randPick(['razor', 'snake', 'grinder']);
      this.speaker = { name: riderById(def)!.name, portrait: `portraits/${def}`, line: 'Ha! Chicken! Buk-buk-buk-BAWK!' };
      a.jingle('music/lose');
    }
    this.game.saveCareer();
  }

  update() {
    if (this.time < 1) return;
    if (this.game.input.pressed('confirm')) {
      if (this.gameOver) this.game.go('gameover', { reason: this.o.kind });
      else this.game.go('standings', this.o);
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    cover(ctx, this.game.assets.get(this.art), 1, 1.04 + this.time * 0.004);
    vignette(ctx, 0.7);
    const k = Math.min(1, this.time * 3);
    text(ctx, this.headline, WIDTH / 2, 110, { size: 80 * (0.7 + 0.3 * k), font: 'title', align: 'center', color: this.headColor, outline: 10 });
    text(ctx, trackById(this.o.track).name.toUpperCase(), WIDTH / 2, 150, { size: 12, align: 'center', outline: 4 });
    panel(ctx, WIDTH - 470, 190, 440, 60 + this.lines.length * 40);
    this.lines.forEach(([k2, v], i) => {
      text(ctx, k2, WIDTH - 445, 240 + i * 40, { size: 12, color: '#ccc' });
      text(ctx, v, WIDTH - 55, 240 + i * 40, { size: 14, align: 'right', color: v.startsWith('-') ? COLORS.red : v.startsWith('+') ? COLORS.green : COLORS.white });
    });
    if (this.stamp && this.time > 0.6) {
      ctx.save();
      ctx.translate(WIDTH - 250, 250 + this.lines.length * 40 + 40);
      ctx.rotate(-0.08);
      const good = this.stamp === 'QUALIFIED';
      ctx.strokeStyle = good ? COLORS.green : COLORS.red;
      ctx.lineWidth = 5;
      ctx.strokeRect(-170, -30, 340, 56);
      text(ctx, this.stamp, 0, 10, { size: 20, align: 'center', color: good ? COLORS.green : COLORS.red });
      ctx.restore();
    }
    if (this.speaker.portrait) {
      portrait(ctx, this.game.assets.get(this.speaker.portrait), 50, HEIGHT - 250, 200);
      dialogue(ctx, 280, HEIGHT - 200, WIDTH - 320, this.speaker.name, this.speaker.line, Math.min(1, (this.time - 0.5) * 1.2));
    }
    if (this.time > 1 && blink(this.time)) text(ctx, 'PRESS ENTER', WIDTH / 2, HEIGHT - 16, { size: 12, align: 'center' });
  }
}

export class StandingsScene extends Scene {
  constructor(game: Game, private o: RaceOutcome) {
    super(game);
  }
  enter() {
    this.game.audio.playMusic('music/menu');
  }
  update() {
    if (this.time < 0.5 || !this.game.input.pressed('confirm')) return;
    const c = this.game.career!;
    this.game.go(c.levelComplete ? 'levelcomplete' : 'levels');
  }
  render(ctx: CanvasRenderingContext2D) {
    cover(ctx, this.game.assets.get('ui/lounge'), 0.5);
    vignette(ctx, 0.8);
    panel(ctx, 190, 20, WIDTH - 380, HEIGHT - 40);
    text(ctx, 'RACE RESULTS', WIDTH / 2, 80, { size: 52, font: 'title', align: 'center', color: COLORS.yellow });
    text(ctx, `${trackById(this.o.track).name.toUpperCase()}  -  LEVEL ${this.o.level}`, WIDTH / 2, 108, { size: 10, align: 'center', color: '#bbb' });
    const cols = [240, 330, 700, 900];
    ['POS', 'RIDER', 'TIME', 'PURSE'].forEach((h, i) => text(ctx, h, cols[i], 145, { size: 10, color: COLORS.red }));
    this.o.results.forEach((r, i) => {
      const y = 175 + i * 32;
      const shown = Math.min(this.o.results.length, Math.floor(this.time * 20));
      if (i >= shown) return;
      const player = r.isPlayer;
      if (player) {
        ctx.fillStyle = 'rgba(255,210,58,0.18)';
        ctx.fillRect(220, y - 22, WIDTH - 440, 30);
      }
      const color = player ? COLORS.yellow : i < QUALIFY_PLACE ? COLORS.white : '#aaa';
      const dnf = !isFinite(r.time);
      text(ctx, ordinal(i + 1), cols[0], y, { size: 12, color });
      text(ctx, r.name.toUpperCase(), cols[1], y, { size: 12, color });
      text(ctx, dnf ? 'DNF' : formatTime(r.time) + (r.finished ? '' : '*'), cols[2], y, { size: 12, color });
      const purse = dnf ? 0 : prizeFor(this.o.level, i + 1);
      text(ctx, purse ? formatMoney(purse) : '-', cols[3], y, { size: 12, color });
      if (i === QUALIFY_PLACE - 1) {
        ctx.fillStyle = COLORS.red;
        ctx.fillRect(230, y + 10, WIDTH - 460, 2);
      }
    });
    text(ctx, '* ESTIMATED   RED LINE = QUALIFYING CUT', WIDTH / 2, HEIGHT - 50, { size: 8, align: 'center', color: '#888' });
    if (blink(this.time)) text(ctx, 'PRESS ENTER', WIDTH / 2, HEIGHT - 28, { size: 10, align: 'center' });
  }
}

export class LevelCompleteScene extends Scene {
  private from = 0;
  private final = false;
  enter() {
    const c = this.game.career!;
    this.from = c.s.level;
    this.final = c.isFinalLevel;
    const a = this.game.audio;
    a.stopMusic(0.2);
    a.jingle('music/levelup');
    if (this.game.options.voice) setTimeout(() => a.voice(this.final ? 'voice/champion' : 'voice/levelup'), 600);
    this.game.events.emit({ type: 'levelUp', level: this.from });
    if (!this.final) {
      c.advanceLevel();
      this.game.saveCareer();
    }
  }
  update() {
    if (this.time > 1.2 && this.game.input.pressed('confirm')) this.game.go(this.final ? 'victory' : 'levels');
  }
  render(ctx: CanvasRenderingContext2D) {
    const c = this.game.career!;
    cover(ctx, this.game.assets.get('ui/victory'), 0.7, 1.05);
    vignette(ctx, 0.7);
    text(ctx, `LEVEL ${this.from} COMPLETE!`, WIDTH / 2, 200, { size: 90, font: 'title', align: 'center', color: COLORS.yellow, outline: 10 });
    if (this.final) {
      text(ctx, 'YOU CONQUERED EVERY ROAD', WIDTH / 2, 300, { size: 20, align: 'center', outline: 5 });
    } else {
      text(ctx, `ON TO LEVEL ${c.s.level}`, WIDTH / 2, 290, { size: 24, align: 'center', color: COLORS.green, outline: 5 });
      text(ctx, 'LONGER ROADS. FASTER RIVALS. MORE COPS. BIGGER PURSES.', WIDTH / 2, 340, { size: 11, align: 'center', outline: 4 });
      panel(ctx, WIDTH / 2 - 250, 400, 500, 120, COLORS.yellow);
      text(ctx, 'NEW PASSWORD', WIDTH / 2, 440, { size: 11, align: 'center', color: '#bbb' });
      text(ctx, encodePassword(c.s), WIDTH / 2, 490, { size: 30, align: 'center', color: COLORS.orange });
    }
    if (this.time > 1.2 && blink(this.time)) text(ctx, 'PRESS ENTER', WIDTH / 2, HEIGHT - 50, { size: 16, align: 'center', outline: 4 });
  }
}

export class GameOverScene extends Scene {
  constructor(game: Game, private params: { reason?: string } = {}) {
    super(game);
  }
  enter() {
    const a = this.game.audio;
    a.stopMusic(0.2);
    a.jingle('music/gameover');
    if (this.game.options.voice) setTimeout(() => a.voice('voice/gameover'), 700);
    Storage.saveCareer(null);
  }
  update() {
    if (this.time > 1.5 && this.game.input.pressed('confirm')) {
      this.game.career = null;
      this.game.go('title');
    }
  }
  render(ctx: CanvasRenderingContext2D) {
    cover(ctx, this.game.assets.get('ui/gameover'), Math.min(1, this.time), 1.05 + this.time * 0.005);
    vignette(ctx, 0.85);
    text(ctx, 'GAME OVER', WIDTH / 2, 280, { size: 130, font: 'title', align: 'center', color: COLORS.red, outline: 12 });
    const why = this.params.reason === 'busted' ? "YOU COULDN'T PAY THE FINE. THE COPS TOOK YOUR BIKE." : "YOU COULDN'T PAY FOR REPAIRS. YOUR BIKE IS SCRAP.";
    text(ctx, why, WIDTH / 2, 360, { size: 13, align: 'center', outline: 4 });
    if (this.time > 1.5 && blink(this.time)) text(ctx, 'PRESS ENTER', WIDTH / 2, HEIGHT - 60, { size: 16, align: 'center', outline: 4 });
  }
}

export class VictoryScene extends Scene {
  enter() {
    this.game.audio.playMusic('music/ending');
    this.game.events.emit({ type: 'champion' });
    Storage.saveCareer(null);
  }
  update() {
    if (this.time > 2 && this.game.input.pressed('confirm')) this.game.go('credits', { back: 'title', ending: true });
  }
  render(ctx: CanvasRenderingContext2D) {
    const c = this.game.career;
    cover(ctx, this.game.assets.get('ui/victory'), 1, 1.02 + Math.sin(this.time * 0.4) * 0.02);
    vignette(ctx, 0.6);
    text(ctx, 'CHAMPION!', WIDTH / 2, 170, { size: 140, font: 'title', align: 'center', color: COLORS.yellow, outline: 12 });
    text(ctx, `${c?.s.name ?? 'YOU'} RULES THE ROAD`, WIDTH / 2, 250, { size: 22, align: 'center', outline: 6 });
    if (c) {
      panel(ctx, WIDTH / 2 - 260, 470, 520, 150, COLORS.yellow);
      text(ctx, `RACES  ${c.s.races}`, WIDTH / 2, 515, { size: 14, align: 'center' });
      text(ctx, `WINS  ${c.s.wins}`, WIDTH / 2, 550, { size: 14, align: 'center' });
      text(ctx, `BANK  ${formatMoney(c.s.money)}`, WIDTH / 2, 585, { size: 14, align: 'center', color: COLORS.green });
    }
    if (this.time > 2 && blink(this.time)) text(ctx, 'PRESS ENTER', WIDTH / 2, HEIGHT - 30, { size: 14, align: 'center', outline: 4 });
  }
}
