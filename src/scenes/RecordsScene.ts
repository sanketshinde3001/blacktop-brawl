/** Records: achievements, scoreboards (online when configured, else this device) and stats. */
import { HEIGHT, WIDTH } from '../config';
import type { Game } from '../engine/Game';
import { Scene } from '../engine/Scene';
import { ACHIEVEMENTS } from '../game/Achievements';
import { fetchOnline, localBoard, ONLINE, type BoardId } from '../game/Leaderboard';
import { dailySpec, todayKey } from '../game/Runs';
import type { BoardEntry } from '../game/Storage';
import { COLORS, cover, panel, text, vignette } from '../ui/draw';

type Tab = 'achievements' | 'boards' | 'stats';
const TABS: [Tab, string][] = [
  ['achievements', 'ACHIEVEMENTS'],
  ['boards', 'SCOREBOARDS'],
  ['stats', 'STATS'],
];

export class RecordsScene extends Scene {
  private tab = 0;
  private online: Partial<Record<BoardId, BoardEntry[] | 'loading' | null>> = {};

  constructor(game: Game) {
    super(game);
  }

  enter() {
    this.game.audio.playMusic('music/menu');
    if (ONLINE) {
      for (const b of ['endless', `daily-${todayKey()}`] as BoardId[]) {
        this.online[b] = 'loading';
        fetchOnline(b).then((list) => (this.online[b] = list));
      }
    }
  }

  update() {
    const i = this.game.input;
    if (i.pressed('left')) (this.tab = (this.tab + TABS.length - 1) % TABS.length), this.game.audio.blip(520, 0.04);
    if (i.pressed('right')) (this.tab = (this.tab + 1) % TABS.length), this.game.audio.blip(520, 0.04);
    if (i.pressed('back') || i.pressed('confirm')) this.game.go('menu');
  }

  render(ctx: CanvasRenderingContext2D) {
    cover(ctx, this.game.assets.get('ui/lounge'), 0.4);
    vignette(ctx, 0.85);
    text(ctx, 'RECORDS', WIDTH / 2, 74, { size: 64, font: 'title', align: 'center', color: COLORS.yellow, outline: 8 });
    TABS.forEach(([, label], k) => {
      const on = k === this.tab;
      const x = WIDTH / 2 + (k - 1) * 260;
      ctx.fillStyle = on ? COLORS.yellow : 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.roundRect(x - 120, 96, 240, 32, 8);
      ctx.fill();
      text(ctx, label, x, 118, { size: 11, align: 'center', color: on ? '#1a1206' : '#ccc', shadow: false });
    });
    panel(ctx, 60, 146, WIDTH - 120, HEIGHT - 206);
    const tab = TABS[this.tab][0];
    if (tab === 'achievements') this.renderAchievements(ctx);
    else if (tab === 'boards') this.renderBoards(ctx);
    else this.renderStats(ctx);
    text(ctx, '◀ ▶ SWITCH   ESC BACK', WIDTH / 2, HEIGHT - 22, { size: 9, align: 'center', color: '#aaa' });
  }

  private renderAchievements(ctx: CanvasRenderingContext2D) {
    const got = new Set(this.game.records.achievements);
    text(ctx, `${got.size} / ${ACHIEVEMENTS.length} UNLOCKED`, WIDTH / 2, 180, { size: 11, align: 'center', color: '#bbb' });
    ACHIEVEMENTS.forEach((a, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 96 + col * 560, y = 212 + row * 44;
      const on = got.has(a.id);
      ctx.fillStyle = on ? COLORS.yellow : '#2a2c31';
      ctx.beginPath();
      ctx.arc(x + 12, y - 5, 12, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, on ? '★' : '?', x + 12, y + 1, { size: 11, align: 'center', color: on ? '#1a1206' : '#666', shadow: false });
      text(ctx, a.name, x + 36, y - 2, { size: 11, color: on ? COLORS.white : '#777' });
      text(ctx, a.desc.toUpperCase(), x + 36, y + 14, { size: 7, color: on ? '#bbb' : '#555' });
    });
  }

  private boardColumn(ctx: CanvasRenderingContext2D, x: number, title: string, sub: string, board: BoardId, showStage: boolean) {
    text(ctx, title, x, 190, { size: 15, color: COLORS.yellow });
    text(ctx, sub, x, 212, { size: 8, color: '#999' });
    const online = this.online[board];
    const list = Array.isArray(online) ? online : localBoard(this.game.records, board);
    const where = !ONLINE ? 'THIS DEVICE' : online === 'loading' ? 'LOADING ONLINE...' : Array.isArray(online) ? 'ONLINE TOP 20' : 'OFFLINE - THIS DEVICE';
    text(ctx, where, x + 500, 190, { size: 8, align: 'right', color: COLORS.blue });
    if (!list.length) text(ctx, 'NO SCORES YET', x, 260, { size: 10, color: '#666' });
    const me = this.game.records.name;
    list.slice(0, 10).forEach((e, i) => {
      const y = 250 + i * 30;
      const mine = e.name === me;
      text(ctx, `${i + 1}.`, x, y, { size: 11, color: i === 0 ? COLORS.yellow : '#aaa' });
      text(ctx, e.name, x + 50, y, { size: 11, color: mine ? COLORS.green : COLORS.white });
      if (showStage && e.stage) text(ctx, `ST ${e.stage}`, x + 270, y, { size: 9, color: '#999' });
      text(ctx, Math.round(e.score).toLocaleString('en-US'), x + 500, y, { size: 11, align: 'right', color: COLORS.white });
    });
  }

  private renderBoards(ctx: CanvasRenderingContext2D) {
    const today = todayKey();
    const d = dailySpec(today);
    this.boardColumn(ctx, 96, 'ENDLESS RUN', 'ALL TIME', 'endless', true);
    this.boardColumn(ctx, 676, 'DAILY CHALLENGE', `${today}  ${d.track.name.toUpperCase()}`, `daily-${today}`, false);
  }

  private renderStats(ctx: CanvasRenderingContext2D) {
    const r = this.game.records;
    const s = r.stats;
    const rows: [string, string][] = [
      ['RACES RIDDEN', String(s.races ?? 0)],
      ['RACES WON', String(s.wins ?? 0)],
      ['RIDERS DECKED', String(s.knockouts ?? 0)],
      ['NITRO BOOSTS FIRED', String(s.nitros ?? 0)],
      ['BEST ENDLESS SCORE', r.endlessBest.toLocaleString('en-US')],
      ['FURTHEST ENDLESS STAGE', String(r.endlessStage || '-')],
      ["TODAY'S DAILY BEST", (r.daily[todayKey()] ?? 0).toLocaleString('en-US')],
      ['WEAPONS COLLECTED', r.weapons.length ? r.weapons.join(', ').toUpperCase() : '-'],
    ];
    rows.forEach(([a, b], i) => {
      const y = 210 + i * 46;
      text(ctx, a, 140, y, { size: 13, color: '#ccc' });
      text(ctx, b, WIDTH - 140, y, { size: 14, align: 'right', color: COLORS.white });
    });
  }
}
