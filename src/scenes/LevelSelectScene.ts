/**
 * The career hub: a map of the five roads for the current level. Pick a road to race, visit the
 * bike shop, or quit. Shows cash, bike, qualified tracks and the password.
 */
import { HEIGHT, QUALIFY_PLACE, WIDTH } from '../config';
import { levelDef } from '../data/levels';
import { TRACKS } from '../data/tracks';
import { careerWeather, WEATHER } from '../data/weather';
import type { Game } from '../engine/Game';
import { formatMoney, ordinal } from '../engine/math';
import { Scene } from '../engine/Scene';
import { encodePassword } from '../game/Password';
import { COLORS, drawSprite, panel, text, vignette } from '../ui/draw';
import { Menu } from '../ui/Menu';

const MAP_X = 215;

export class LevelSelectScene extends Scene {
  private menu: Menu;

  constructor(game: Game) {
    super(game);
    const c = game.career!;
    this.menu = new Menu(
      [
        ...TRACKS.map((t, i) => ({
          label: t.name.toUpperCase(),
          value: () => (c.s.qualified[i] ? 'QUALIFIED' : ''),
          onSelect: () => this.game.go('prerace', { track: t.id }),
        })),
        { label: 'BIKE SHOP', onSelect: () => this.game.go('shop') },
        { label: 'OPTIONS', onSelect: () => this.game.go('options', { back: 'levels' }) },
        { label: 'SAVE & QUIT', onSelect: () => (this.game.saveCareer(), this.game.go('title')) },
      ],
      game,
    );
    // start on the first un-qualified road
    const next = c.s.qualified.findIndex((q) => !q);
    this.menu.index = next >= 0 ? next : 0;
  }

  enter() {
    this.game.audio.playMusic('music/menu');
    this.game.saveCareer();
  }

  update() {
    this.menu.update();
    if (this.game.input.pressed('back')) this.game.go('menu');
  }

  render(ctx: CanvasRenderingContext2D) {
    const c = this.game.career!;
    const lv = levelDef(c.s.level);
    // The map is shifted right so all five regions sit clear of the menu panel.
    ctx.fillStyle = '#1a1410';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(this.game.assets.get('ui/map').img, MAP_X, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    vignette(ctx, 0.6);

    // markers
    TRACKS.forEach((t, i) => {
      const x = MAP_X + t.map.x * WIDTH, y = t.map.y * HEIGHT;
      const sel = this.menu.index === i;
      const q = c.s.qualified[i];
      const pulse = sel ? 6 + Math.sin(this.time * 8) * 3 : 0;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x, y, 18 + pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = q ? COLORS.green : sel ? COLORS.yellow : COLORS.red;
      ctx.beginPath();
      ctx.arc(x, y, 13 + pulse * 0.5, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, q ? '✓' : String(i + 1), x, y + 6, { size: 14, align: 'center', color: '#000', shadow: false });
      text(ctx, t.name.toUpperCase(), x, y - 28, { size: sel ? 13 : 10, align: 'center', color: sel ? COLORS.yellow : COLORS.white, outline: 4 });
    });

    // left panel
    panel(ctx, 24, 24, 400, 672);
    text(ctx, `LEVEL ${c.s.level}`, 224, 90, { size: 60, font: 'title', align: 'center', color: COLORS.yellow });
    text(ctx, `${c.qualifiedCount()} / 5 QUALIFIED`, 224, 124, { size: 11, align: 'center', color: '#bbb' });
    this.menu.render(ctx, 60, 180, { time: this.time, spacing: 38, size: 13, align: 'left', width: 0 });
    TRACKS.forEach((_, i) => {
      if (c.s.qualified[i]) text(ctx, '✓', 400, 180 + i * 38, { size: 13, color: COLORS.green, align: 'right' });
    });

    const sel = TRACKS[this.menu.index];
    if (sel) {
      const miles = (lv.miles * sel.lengthFactor).toFixed(1);
      const bx = 448;
      panel(ctx, bx, HEIGHT - 190, 406, 166, COLORS.yellow);
      text(ctx, sel.name.toUpperCase(), bx + 20, HEIGHT - 150, { size: 16, color: COLORS.yellow });
      const wx = careerWeather(c.s.level, this.menu.index);
      text(ctx, `${miles} MILES   ${ordinal(QUALIFY_PLACE)} OR BETTER`, bx + 20, HEIGHT - 120, { size: 9, color: '#ccc' });
      text(ctx, WEATHER[wx].label, bx + 386, HEIGHT - 150, { size: 12, align: 'right', color: wx === 'night' ? '#8fa8ff' : wx === 'rain' ? '#9fd0ff' : wx === 'dusk' ? COLORS.orange : COLORS.yellow });
      const words = sel.blurb.split(' ');
      let line = '', y = HEIGHT - 90;
      for (const w of words) {
        if ((line + w).length > 36) {
          text(ctx, line, bx + 20, y, { size: 9 });
          (line = ''), (y += 20);
        }
        line += w + ' ';
      }
      text(ctx, line, bx + 20, y, { size: 9 });
    }

    // wallet + bike
    const bike = c.bike;
    text(ctx, `CASH  ${formatMoney(c.s.money)}`, 60, 540, { size: 14, color: COLORS.green });
    text(ctx, `BIKE  ${bike.name.toUpperCase()}`, 60, 570, { size: 10 });
    const img = this.game.assets.get(`bikes/${bike.id}`);
    if (!img.placeholder) drawSprite(ctx, img, 250, 580, 150);
    text(ctx, 'PASSWORD', 60, 610, { size: 9, color: '#999' });
    text(ctx, encodePassword(c.s), 60, 640, { size: 14, color: COLORS.orange });
    text(ctx, c.s.name, 60, 675, { size: 10, color: '#999' });
  }
}
