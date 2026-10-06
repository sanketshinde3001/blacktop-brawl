/**
 * Bike shop, two counters:
 *  - BIKES: browse the catalogue, compare stats, buy with your old bike (and its parts) traded in
 *  - PARTS: engine, tyres, brakes, armour and nitro upgrades, three stages each
 * ↓ from the bikes goes to the parts list; ↑ off the top of the list comes back.
 */
import { HEIGHT, WIDTH } from '../config';
import { bikeById, SHOP_BIKES, tradeInValue, type BikeDef } from '../data/bikes';
import { MAX_TIER, UPGRADES } from '../data/upgrades';
import type { Game } from '../engine/Game';
import { formatMoney } from '../engine/math';
import { randPick } from '../engine/Rng';
import { Scene } from '../engine/Scene';
import { bar, COLORS, cover, dialogue, drawSprite, panel, portrait, text, vignette } from '../ui/draw';

const PITCH = [
  "Step right up! Every bike here is guaranteed... to have wheels.",
  'Cash talks, friend. What is your wallet saying today?',
  "That rat bike of yours? I'll give you a fair price. Fair for me.",
  'Speed costs money. How fast do you want to go?',
  'New parts in the back. Tyres, brakes, armour... nitro, if you ask nice.',
];

export class ShopScene extends Scene {
  private index: number;
  private tab: 'bikes' | 'parts' = 'bikes';
  private part = 0;
  private confirm = false;
  private line = randPick(PITCH);
  private lineT = 0;

  constructor(game: Game) {
    super(game);
    this.index = Math.max(0, SHOP_BIKES.findIndex((b) => b.id === game.career!.s.bike));
  }

  enter() {
    this.game.audio.playMusic('music/menu');
  }

  private tradeIn(): number {
    const c = this.game.career!;
    return tradeInValue(c.bike) + c.partsValue();
  }

  private price(b: BikeDef) {
    return Math.max(0, b.price - this.tradeIn());
  }

  private say(line: string) {
    this.line = line;
    this.lineT = 0;
  }

  update(dt: number) {
    const i = this.game.input;
    const c = this.game.career!;
    this.lineT += dt;
    if (i.pressed('back') && !this.confirm) {
      this.game.go('levels');
      return;
    }
    if (this.tab === 'parts') return this.updateParts();
    const b = SHOP_BIKES[this.index];
    if (this.confirm) {
      if (i.pressed('confirm')) {
        c.pay(this.price(b));
        c.changeBike(b.id);
        this.game.saveCareer();
        this.game.audio.play('sfx/cash');
        this.game.events.emit({ type: 'buy', what: 'bike', id: b.id });
        this.say(`Pleasure doing business! Treat the ${b.name} right. Parts are in the back.`);
        this.confirm = false;
      } else if (i.pressed('back') || i.pressed('left') || i.pressed('right')) {
        this.confirm = false;
        this.say('Cold feet, huh? Take your time.');
      }
      return;
    }
    if (i.pressed('left') || i.pressed('up')) (this.index = (this.index + SHOP_BIKES.length - 1) % SHOP_BIKES.length), this.game.audio.blip(520, 0.04);
    if (i.pressed('right')) (this.index = (this.index + 1) % SHOP_BIKES.length), this.game.audio.blip(520, 0.04);
    if (i.pressed('down')) {
      this.tab = 'parts';
      this.part = 0;
      this.game.audio.blip(620, 0.05);
      this.say('Fancy some go-faster bits for that ' + c.bike.name + '?');
      return;
    }
    if (i.pressed('confirm')) {
      if (b.id === c.s.bike) this.say('You already own that one, genius. Press DOWN for parts.');
      else if (c.s.money < this.price(b)) {
        this.say(`That's ${formatMoney(this.price(b))} after trade-in. Come back when you're not broke.`);
        this.game.audio.blip(160, 0.2, 'sawtooth');
      } else {
        this.confirm = true;
        const parts = c.partsValue() ? ' Your engine, tyres and brakes go with the old bike.' : '';
        this.say(`The ${b.name}? ${formatMoney(this.price(b))} with your trade-in.${parts} ENTER to buy.`);
      }
    }
  }

  private updateParts() {
    const i = this.game.input;
    const c = this.game.career!;
    if (i.pressed('up')) {
      if (this.part === 0) {
        this.tab = 'bikes';
        this.game.audio.blip(620, 0.05);
        return;
      }
      this.part--;
      this.game.audio.blip(520, 0.04);
    }
    if (i.pressed('down')) (this.part = Math.min(UPGRADES.length - 1, this.part + 1)), this.game.audio.blip(520, 0.04);
    if (i.pressed('confirm')) {
      const u = UPGRADES[this.part];
      const price = c.nextUpgradePrice(u.id);
      if (price === null) this.say("That's maxed out. Any more and it'd explode. More than usual.");
      else if (!c.buyUpgrade(u.id)) {
        this.say(`${formatMoney(price)} for that. You're short, pal.`);
        this.game.audio.blip(160, 0.2, 'sawtooth');
      } else {
        this.game.saveCareer();
        this.game.audio.play('sfx/cash');
        this.game.events.emit({ type: 'buy', what: 'upgrade', id: u.id });
        this.say(randPick(['Bolted on. Try not to wrap it round a tree.', 'Done! Feel that? That is money leaving.', 'Installed. No refunds, no warranty, no questions.']));
      }
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    const c = this.game.career!;
    cover(ctx, this.game.assets.get('ui/shop'), 1);
    vignette(ctx, 0.6);
    text(ctx, 'BIKE SHOP', WIDTH / 2, 70, { size: 64, font: 'title', align: 'center', color: COLORS.yellow, outline: 8 });
    // tabs
    const tabs: ['bikes' | 'parts', string][] = [['bikes', 'BIKES'], ['parts', 'PARTS']];
    tabs.forEach(([id, label], k) => {
      const on = this.tab === id;
      const x = WIDTH / 2 - 120 + k * 240;
      ctx.fillStyle = on ? COLORS.yellow : 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.roundRect(x - 90, 88, 180, 30, 8);
      ctx.fill();
      text(ctx, label, x, 109, { size: 12, align: 'center', color: on ? '#1a1206' : '#ccc', shadow: false });
    });

    // wallet
    panel(ctx, 24, 110, 360, 150);
    text(ctx, 'YOUR CASH', 44, 150, { size: 10, color: '#aaa' });
    text(ctx, formatMoney(c.s.money), 44, 185, { size: 18, color: COLORS.green });
    text(ctx, `TRADE-IN: ${formatMoney(this.tradeIn())}`, 44, 222, { size: 9, color: '#ccc' });
    text(ctx, `(${c.bike.name})`, 44, 244, { size: 8, color: '#999' });

    if (this.tab === 'bikes') this.renderBikes(ctx);
    else this.renderParts(ctx);

    portrait(ctx, this.game.assets.get('portraits/salesman'), 40, HEIGHT - 200, 160);
    dialogue(ctx, 230, HEIGHT - 190, WIDTH - 270, 'Slick Rick', this.line, Math.min(1, this.lineT * 1.5));
    const hint = this.tab === 'bikes' ? '◀ ▶ BROWSE   ENTER BUY   ▼ PARTS   ESC LEAVE' : '▲ ▼ CHOOSE   ENTER BUY   ESC LEAVE';
    text(ctx, hint, WIDTH / 2, HEIGHT - 12, { size: 9, align: 'center', color: '#aaa' });
  }

  private renderBikes(ctx: CanvasRenderingContext2D) {
    const c = this.game.career!;
    const b = SHOP_BIKES[this.index];
    const img = this.game.assets.get(`bikes/${b.id}`);
    const bob = Math.sin(this.time * 2) * 4;
    if (!img.placeholder) drawSprite(ctx, img, WIDTH / 2 - 242, 150 + bob, 450);
    else text(ctx, b.name.toUpperCase(), WIDTH / 2, 300, { size: 40, font: 'title', align: 'center', color: COLORS.white, outline: 6 });
    text(ctx, '◀', WIDTH / 2 - 330, 300, { size: 40, align: 'center', color: COLORS.yellow, outline: 6 });
    text(ctx, '▶', WIDTH / 2 + 330, 300, { size: 40, align: 'center', color: COLORS.yellow, outline: 6 });
    text(ctx, `${this.index + 1} / ${SHOP_BIKES.length}`, WIDTH / 2, 440, { size: 9, align: 'center', color: '#bbb', outline: 3 });

    panel(ctx, WIDTH - 420, 130, 396, 330);
    text(ctx, b.name.toUpperCase(), WIDTH - 400, 168, { size: 14, color: COLORS.yellow });
    text(ctx, `${b.cls} CLASS   ${b.cc}CC   ${b.weight} LBS`, WIDTH - 400, 194, { size: 8, color: '#bbb' });
    const stats: [string, number][] = [
      ['TOP SPEED', (b.topSpeed - 100) / 110],
      ['ACCEL', (b.accel - 15) / 25],
      ['HANDLING', (b.handling - 0.85) / 0.25],
      ['TOUGHNESS', (b.durability - 50) / 55],
      ['OFF-ROAD', ((b.offroad ?? 0.55) - 0.4) / 0.5],
    ];
    stats.forEach(([label, v], i) => {
      text(ctx, label, WIDTH - 400, 230 + i * 30, { size: 9 });
      bar(ctx, WIDTH - 260, 218 + i * 30, 210, 15, Math.max(0.05, Math.min(1, v)), COLORS.orange);
    });
    text(ctx, `${b.topSpeed} MPH`, WIDTH - 400, 390, { size: 10, color: '#ddd' });
    const owned = b.id === c.s.bike;
    text(ctx, owned ? 'YOUR BIKE' : `PRICE ${formatMoney(b.price)}`, WIDTH - 400, 418, { size: 12, color: owned ? COLORS.green : COLORS.white });
    if (!owned) text(ctx, `YOU PAY ${formatMoney(this.price(b))}`, WIDTH - 400, 444, { size: 12, color: c.s.money >= this.price(b) ? COLORS.green : COLORS.red });
    text(ctx, `"${b.blurb}"`, WIDTH / 2, 478, { size: 10, align: 'center', color: '#eee', outline: 3 });
  }

  private renderParts(ctx: CanvasRenderingContext2D) {
    const c = this.game.career!;
    const up = c.upgrades;
    const x = 420, w = 836;
    panel(ctx, x, 130, w, 360, COLORS.yellow);
    text(ctx, `PARTS FOR YOUR ${bikeById(c.s.bike).name.toUpperCase()}`, x + 24, 166, { size: 12, color: COLORS.yellow });
    UPGRADES.forEach((u, i) => {
      const y = 214 + i * 52;
      const sel = i === this.part;
      if (sel) {
        ctx.fillStyle = 'rgba(255,210,58,0.12)';
        ctx.fillRect(x + 10, y - 26, w - 20, 46);
        text(ctx, '▶', x + 18, y + 2, { size: 13, color: COLORS.red });
      }
      text(ctx, u.name, x + 44, y + 2, { size: 13, color: sel ? COLORS.yellow : COLORS.white });
      // stage pips
      for (let t = 0; t < MAX_TIER; t++) {
        ctx.fillStyle = t < up[u.id] ? COLORS.green : '#2b2d33';
        ctx.beginPath();
        ctx.roundRect(x + 330 + t * 34, y - 12, 28, 16, 4);
        ctx.fill();
      }
      const price = c.nextUpgradePrice(u.id);
      text(ctx, price === null ? 'MAXED' : formatMoney(price), x + w - 24, y + 2, { size: 12, align: 'right', color: price === null ? COLORS.green : c.s.money >= price ? COLORS.white : COLORS.red });
      text(ctx, u.bikePart ? 'BIKE PART' : 'YOURS TO KEEP', x + 44, y + 18, { size: 7, color: '#888' });
    });
    const u = UPGRADES[this.part];
    text(ctx, u.effect.toUpperCase(), x + w / 2, 478, { size: 9, align: 'center', color: '#eee', outline: 3 });
  }
}
