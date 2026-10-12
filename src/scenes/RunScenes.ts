/**
 * Endless run and daily challenge screens: the stage card before each race and the result after.
 * The run itself lives in `game.run` so it survives the trip through RaceScene.
 */
import { HEIGHT, WIDTH } from '../config';
import { bikeById } from '../data/bikes';
import { trackById } from '../data/tracks';
import { WEATHER } from '../data/weather';
import type { Game } from '../engine/Game';
import { formatTime, ordinal } from '../engine/math';
import { Scene } from '../engine/Scene';
import { dailyPoints, dailySpec, endlessStage, newDaily, newEndless, RUN_QUALIFY, stagePoints, todayKey } from '../game/Runs';
import { bar, blink, COLORS, cover, drawSprite, panel, text, vignette } from '../ui/draw';
import { addLocal, ONLINE, submitOnline, type BoardId } from '../game/Leaderboard';
import type { RaceOutcome } from './RaceScene';

/** Starts an endless run or today's challenge (asking for a name the first time). */
export function startRun(game: Game, mode: 'endless' | 'daily') {
  const name = game.records.name || game.career?.s.name || '';
  if (!name) return game.go('runname', { mode });
  game.run = mode === 'endless' ? newEndless(name) : newDaily(name);
  game.go('runintro');
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export class RunIntroScene extends Scene {
  enter() {
    this.game.audio.playMusic('music/menu');
  }

  private launch() {
    const run = this.game.run!;
    if (run.mode === 'endless') {
      const st = endlessStage(run);
      this.game.go('race', { track: st.track.id, weather: st.weather, run: st.race });
    } else {
      const d = dailySpec(run.date);
      this.game.go('race', { track: d.track.id, weather: d.weather, run: { mode: 'daily', stage: 1, level: d.level, bike: d.bike, damage: 0 } });
    }
  }

  update() {
    const i = this.game.input;
    if (this.time > 0.4 && i.pressed('confirm')) this.launch();
    if (i.pressed('back')) {
      this.game.run = null;
      this.game.go('menu');
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    const run = this.game.run!;
    const endless = run.mode === 'endless';
    const spec = endless ? endlessStage(run) : null;
    const daily = endless ? null : dailySpec(run.date);
    const track = spec?.track ?? daily!.track;
    const weather = spec?.weather ?? daily!.weather;
    const bike = bikeById(run.bike);
    cover(ctx, this.game.assets.get('ui/map'), 0.45, 1.1 + Math.sin(this.time * 0.3) * 0.02);
    vignette(ctx, 0.85);
    text(ctx, endless ? 'ENDLESS RUN' : 'DAILY CHALLENGE', WIDTH / 2, 92, { size: 72, font: 'title', align: 'center', color: endless ? COLORS.orange : COLORS.blue, outline: 9 });
    text(ctx, endless ? `STAGE ${run.stage}` : run.date ?? '', WIDTH / 2, 136, { size: 20, align: 'center', color: COLORS.white, outline: 5 });
    panel(ctx, WIDTH / 2 - 420, 170, 840, 400, COLORS.yellow);
    text(ctx, track.name.toUpperCase(), WIDTH / 2, 236, { size: 48, font: 'title', align: 'center', color: COLORS.yellow });
    const level = spec?.race.level ?? daily!.level;
    const miles = (level.miles * track.lengthFactor).toFixed(1);
    text(ctx, `${miles} MILES   ${WEATHER[weather].label}   ${level.cops} COP${level.cops > 1 ? 'S' : ''}`, WIDTH / 2, 274, { size: 12, align: 'center', color: '#ddd' });
    const img = this.game.assets.get(`bikes/${bike.id}`);
    if (!img.placeholder) drawSprite(ctx, img, WIDTH / 2 - 375, 315, 210);
    text(ctx, bike.name.toUpperCase(), WIDTH / 2 - 270, 494, { size: 11, align: 'center' });
    const x = WIDTH / 2 - 40;
    if (endless) {
      text(ctx, 'SCORE', x, 330, { size: 12, color: '#bbb' });
      text(ctx, fmt(run.score), x + 330, 330, { size: 18, align: 'right', color: COLORS.green });
      text(ctx, 'BEST', x, 366, { size: 12, color: '#bbb' });
      text(ctx, fmt(this.game.records.endlessBest), x + 330, 366, { size: 14, align: 'right', color: COLORS.yellow });
      text(ctx, 'BIKE CONDITION', x, 404, { size: 12, color: '#bbb' });
      bar(ctx, x, 416, 330, 16, 1 - run.damage / 100, run.damage > 60 ? COLORS.red : COLORS.green);
      text(ctx, `FINISH ${ordinal(RUN_QUALIFY)} OR BETTER TO REACH STAGE ${run.stage + 1}`, x, 470, { size: 10, color: COLORS.orange });
      text(ctx, 'Damage carries over. Rivals get faster every stage.', x, 500, { size: 9, color: '#999' });
    } else {
      const best = this.game.records.daily[run.date!] ?? 0;
      text(ctx, "TODAY'S BEST", x, 340, { size: 12, color: '#bbb' });
      text(ctx, best ? fmt(best) : '-', x + 330, 340, { size: 18, align: 'right', color: COLORS.yellow });
      text(ctx, 'Same road, weather and bike for', x, 400, { size: 10, color: '#ccc' });
      text(ctx, 'everyone today. Faster time =', x, 424, { size: 10, color: '#ccc' });
      text(ctx, 'more points. Retry as often as', x, 448, { size: 10, color: '#ccc' });
      text(ctx, 'you like: your best counts.', x, 472, { size: 10, color: '#ccc' });
    }
    if (this.time > 0.6 && blink(this.time)) text(ctx, 'PRESS ENTER TO RIDE', WIDTH / 2, HEIGHT - 70, { size: 18, align: 'center', outline: 5 });
    text(ctx, 'ESC TO QUIT', WIDTH / 2, HEIGHT - 36, { size: 9, align: 'center', color: '#888' });
  }
}

export class RunResultScene extends Scene {
  private points = 0;
  private goOn = false;
  private best = false;
  private headline = '';
  private color: string = COLORS.yellow;
  private localRank = 0;
  private onlineRank: number | null | 'sending' = null;

  constructor(game: Game, private o: RaceOutcome) {
    super(game);
  }

  enter() {
    const run = this.game.run!;
    const o = this.o;
    const finished = o.kind === 'finished';
    const rec = this.game.records;
    this.game.audio.stopMusic(0.3);
    run.knockouts += o.knockouts;
    if (run.mode === 'endless') {
      this.points = stagePoints(o.place, o.knockouts, run.stage, finished);
      run.score += this.points;
      run.history.push({ track: o.track, place: o.place, points: this.points });
      this.goOn = finished && o.place <= RUN_QUALIFY;
      if (this.goOn) {
        this.headline = o.place === 1 ? 'STAGE WON!' : `STAGE CLEARED - ${ordinal(o.place)}`;
        this.color = COLORS.green;
        // a quick roadside patch-up between stages
        run.damage = Math.max(0, o.damage - 30);
      } else {
        this.headline = o.kind === 'busted' ? 'BUSTED - RUN OVER' : o.kind === 'wrecked' ? 'WRECKED - RUN OVER' : o.kind === 'quit' ? 'RUN ABANDONED' : `${ordinal(o.place)} - RUN OVER`;
        this.color = COLORS.red;
        if (run.score > rec.endlessBest) (rec.endlessBest = run.score), (this.best = true);
        rec.endlessStage = Math.max(rec.endlessStage, run.stage);
      }
      this.game.audio.jingle(this.goOn ? 'music/win' : 'music/lose');
    } else {
      this.points = dailyPoints(o.place, o.time, o.knockouts, finished);
      run.score = this.points;
      const prev = rec.daily[run.date!] ?? 0;
      if (this.points > prev) (rec.daily[run.date!] = this.points), (this.best = true);
      this.headline = finished ? `FINISHED ${ordinal(o.place)}` : o.kind === 'busted' ? 'BUSTED' : o.kind === 'wrecked' ? 'WRECKED' : 'GAVE UP';
      this.color = finished ? COLORS.green : COLORS.red;
      this.game.audio.jingle(finished ? 'music/win' : 'music/lose');
    }
    this.game.events.emit({ type: 'runEnd', run, outcome: o, over: !this.goOn });
    // the run is over (or today's attempt is done): post it to the boards
    if (!this.goOn && run.score > 0) {
      const board: BoardId = run.mode === 'endless' ? 'endless' : `daily-${run.date}`;
      const entry = { name: run.name, score: run.score, stage: run.stage, date: todayKey() };
      this.localRank = addLocal(rec, board, entry);
      if (ONLINE) {
        this.onlineRank = 'sending';
        submitOnline(board, entry).then((r) => (this.onlineRank = r));
      }
    }
    this.game.saveRecords();
  }

  update() {
    if (this.time < 1) return;
    const i = this.game.input;
    const run = this.game.run!;
    if (i.pressed('confirm')) {
      if (this.goOn) {
        run.stage++;
        this.game.go('runintro');
      } else if (run.mode === 'daily') {
        // retry today's challenge
        this.game.run = newDaily(run.name, todayKey());
        this.game.go('runintro');
      } else {
        this.game.run = null;
        this.game.go('menu');
      }
      return;
    }
    if (i.pressed('back') && !this.goOn) {
      this.game.run = null;
      this.game.go('menu');
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    const run = this.game.run!;
    const o = this.o;
    cover(ctx, this.game.assets.get(this.goOn ? 'ui/victory' : o.kind === 'busted' ? 'ui/busted' : o.kind === 'wrecked' ? 'ui/wrecked' : 'ui/lounge'), 0.6);
    vignette(ctx, 0.8);
    const k = Math.min(1, this.time * 3);
    text(ctx, this.headline, WIDTH / 2, 110, { size: 64 * (0.7 + 0.3 * k), font: 'title', align: 'center', color: this.color, outline: 9 });
    text(ctx, `${trackById(o.track).name.toUpperCase()}  -  ${WEATHER[o.weather].label}`, WIDTH / 2, 150, { size: 12, align: 'center', outline: 4 });
    panel(ctx, WIDTH / 2 - 330, 190, 660, 330);
    const rows: [string, string, string?][] = [
      ['PLACE', o.kind === 'finished' ? ordinal(o.place) : '-'],
      ['TIME', o.kind === 'finished' ? formatTime(o.time) : '-'],
      ['RIVALS DECKED', String(o.knockouts)],
      [run.mode === 'endless' ? 'STAGE POINTS' : 'SCORE', `+${fmt(this.points)}`, COLORS.green],
    ];
    if (run.mode === 'endless') rows.push(['RUN TOTAL', fmt(run.score), COLORS.yellow]);
    rows.forEach(([a, b, c], i) => {
      text(ctx, a, WIDTH / 2 - 290, 250 + i * 46, { size: 13, color: '#ccc' });
      text(ctx, b, WIDTH / 2 + 290, 250 + i * 46, { size: 16, align: 'right', color: c ?? COLORS.white });
    });
    if (this.best && this.time > 0.8 && blink(this.time, 1.5)) text(ctx, 'NEW PERSONAL BEST!', WIDTH / 2, 560, { size: 22, align: 'center', color: COLORS.yellow, outline: 5 });
    const ranks: string[] = [];
    if (this.localRank) ranks.push(`#${this.localRank} ON THIS DEVICE`);
    if (this.onlineRank === 'sending') ranks.push('SENDING TO ONLINE BOARD...');
    else if (typeof this.onlineRank === 'number') ranks.push(`#${this.onlineRank} ONLINE`);
    if (ranks.length) text(ctx, ranks.join('    '), WIDTH / 2, 600, { size: 12, align: 'center', color: COLORS.blue, outline: 4 });
    if (this.time > 1) {
      const msg = this.goOn ? `ENTER: ON TO STAGE ${run.stage + 1}` : run.mode === 'daily' ? 'ENTER: TRY AGAIN    ESC: MENU' : 'ENTER: BACK TO MENU';
      if (blink(this.time)) text(ctx, msg, WIDTH / 2, HEIGHT - 50, { size: 14, align: 'center', outline: 4 });
    }
  }
}
