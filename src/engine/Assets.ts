/**
 * Loads everything listed in public/assets/manifest.json (written by `npm run assets:manifest`).
 * Any image that is missing is replaced by a generated placeholder so the game always runs.
 */

export interface SpriteInfo {
  file: string;
  w: number;
  h: number;
  /** anchor (ground contact point) in pixels, usually bottom-centre */
  ax: number;
  ay: number;
  /** backgrounds: horizon line as a fraction of the image height */
  horizon?: number;
}

export interface Manifest {
  images: Record<string, SpriteInfo>;
  audio: Record<string, string>;
}

export type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface Sprite {
  id: string;
  img: Drawable;
  w: number;
  h: number;
  ax: number;
  ay: number;
  horizon?: number;
  placeholder?: boolean;
}

const BASE = import.meta.env.BASE_URL + 'assets/';

export class Assets {
  manifest: Manifest = { images: {}, audio: {} };
  private sprites = new Map<string, Sprite>();
  private tints = new Map<string, Sprite>();
  private flips = new Map<string, Sprite>();
  private mips = new WeakMap<Sprite, HTMLCanvasElement[]>();
  private shades = new WeakMap<Sprite, Sprite>();
  private weapons = new WeakMap<Sprite, Map<string, Sprite>>();

  async loadManifest(): Promise<void> {
    try {
      const res = await fetch(BASE + 'manifest.json', { cache: 'no-cache' });
      if (res.ok) this.manifest = await res.json();
    } catch {
      console.warn('[assets] manifest.json missing - using placeholders');
    }
  }

  /** Loads all images; `onProgress` gets 0..1. */
  async loadImages(onProgress: (p: number) => void): Promise<void> {
    const entries = Object.entries(this.manifest.images);
    let done = 0;
    await Promise.all(
      entries.map(async ([id, info]) => {
        try {
          const img = new Image();
          img.decoding = 'async';
          const loaded = new Promise<void>((ok, fail) => {
            img.onload = () => ok();
            img.onerror = () => fail(new Error(info.file));
          });
          img.src = BASE + info.file;
          // decode() can stall in a hidden / background tab: the load event is enough to draw it
          await Promise.race([img.decode().catch(() => loaded), loaded]);
          this.sprites.set(id, { id, img, w: info.w, h: info.h, ax: info.ax, ay: info.ay, horizon: info.horizon });
        } catch {
          console.warn(`[assets] failed to load ${info.file}`);
        }
        onProgress(++done / Math.max(1, entries.length));
      }),
    );
  }

  /**
   * Fills gaps in the generated art so a partially generated asset set still plays well:
   *  - rival attack poses are built from the player's pose frames (the extended limb is grafted
   *    onto the rival's own riding frame)
   *  - missing crash frames borrow the player's; missing 2nd run frames mirror the 1st
   */
  deriveMissing(): string[] {
    const derived: string[] = [];
    const designs = ['brawler', 'racer', 'punk', 'yellow', 'bomber', 'rebel', 'cop'];
    const poses = ['punchL', 'punchR', 'kickL', 'kickR', 'clubL', 'clubR'];
    let mask: Uint8Array | null = null;
    for (const d of designs) {
      if (!this.has(`riders/${d}/ride`)) continue;
      for (const pose of poses) {
        const id = `riders/${d}/${pose}`;
        if (this.has(id) || !this.has(`riders/player/${pose}`) || !this.has('riders/player/ride')) continue;
        mask ??= silhouette(this.get('riders/player/ride'), 4);
        this.sprites.set(id, graftPose(this.get(`riders/${d}/ride`), this.get('riders/player/ride'), mask, this.get(`riders/player/${pose}`), id));
        derived.push(id);
      }
      for (const f of ['tumble', 'bikeDown']) {
        const id = `riders/${d}/${f}`;
        if (!this.has(id) && this.has(`riders/player/${f}`)) {
          this.sprites.set(id, { ...this.get(`riders/player/${f}`), id });
          derived.push(id);
        }
      }
    }
    for (const [a, b] of [['riders/player/runBack2', 'riders/player/runBack1'], ['riders/player/runFront2', 'riders/player/runFront1']]) {
      if (!this.has(a) && this.has(b)) {
        this.sprites.set(a, { ...this.flipped(b), id: a });
        derived.push(a);
      }
    }
    if (!this.has('props/flagmanDown') && this.has('props/flagmanUp')) {
      this.sprites.set('props/flagmanDown', { ...this.flipped('props/flagmanUp'), id: 'props/flagmanDown' });
      derived.push('props/flagmanDown');
    }
    return derived;
  }

  has(id: string): boolean {
    return this.sprites.has(id);
  }

  audioUrl(id: string): string | undefined {
    const f = this.manifest.audio[id];
    return f ? BASE + f : undefined;
  }

  get(id: string): Sprite {
    let s = this.sprites.get(id);
    if (!s) {
      s = placeholder(id);
      this.sprites.set(id, s);
    }
    return s;
  }

  /**
   * Mipmapped version of a sprite for drawing at `destW` pixels wide: returns a pre-shrunk copy no
   * smaller than the destination, plus its scale relative to the original. Drawing from a copy
   * close to the final size keeps distant sprites from shimmering and is much cheaper to scale.
   */
  mip(s: Sprite, destW: number): { img: Drawable; k: number } {
    let level = 0;
    while (level < 5 && (s.w >> (level + 1)) >= destW && (s.w >> (level + 1)) >= 8) level++;
    if (level === 0) return { img: s.img, k: 1 };
    let chain = this.mips.get(s);
    if (!chain) this.mips.set(s, (chain = []));
    for (let l = chain.length + 1; l <= level; l++) {
      const src = l === 1 ? s.img : chain[l - 2];
      const c = canvas(Math.max(1, Math.ceil(s.w / 2 ** l)), Math.max(1, Math.ceil(s.h / 2 ** l)));
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, c.width, c.height);
      chain.push(c);
    }
    const img = chain[level - 1];
    return { img, k: img.width / s.w };
  }

  /**
   * A chain or crowbar version of a club-swing frame: the club pixels (in the swing frame but not
   * in the rider's riding or punching silhouettes, and wood-coloured) are repainted as steel, or
   * as a thinner run of silver links for a chain. Cached per source sprite.
   */
  weaponFrame(club: Sprite, ride: Sprite, punch: Sprite, kind: 'chain' | 'crowbar'): Sprite {
    let byKind = this.weapons.get(club);
    if (!byKind) this.weapons.set(club, (byKind = new Map()));
    let out = byKind.get(kind);
    if (out) return out;
    if (club.placeholder || ride.placeholder) return club;
    const c = canvas(club.w, club.h);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(club.img, 0, 0);
    const img = g.getImageData(0, 0, club.w, club.h);
    const d = img.data;
    const rm = silhouette(ride, 3), pm = silhouette(punch, 5);
    const at = (o: Sprite, mask: Uint8Array, x: number, y: number) => {
      const xx = Math.round(x - club.ax + o.ax), yy = Math.round(y - club.ay + o.ay);
      return xx >= 0 && yy >= 0 && xx < o.w && yy < o.h && mask[yy * o.w + xx] === 1;
    };
    const region = new Uint8Array(club.w * club.h);
    for (let y = 0; y < club.h; y++)
      for (let x = 0; x < club.w; x++) {
        const i = (y * club.w + x) * 4;
        if (d[i + 3] < 30 || at(ride, rm, x, y) || at(punch, pm, x, y)) continue;
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        const max = Math.max(r, gg, b), min = Math.min(r, gg, b), sat = max ? (max - min) / max : 0, v = max / 255;
        let h = 0;
        if (max !== min) {
          if (max === r) h = ((gg - b) / (max - min)) % 6;
          else if (max === gg) h = (b - r) / (max - min) + 2;
          else h = (r - gg) / (max - min) + 4;
          h *= 60;
          if (h < 0) h += 360;
        }
        if ((h <= 42 || h >= 340) && sat >= 0.3 && v >= 0.12 && v <= 0.92) region[y * club.w + x] = 1;
      }
    // grow the region by a pixel or two over the club's anti-aliased fringe
    for (let pass = 0; pass < 2; pass++) {
      const grow: number[] = [];
      for (let y = 1; y < club.h - 1; y++)
        for (let x = 1; x < club.w - 1; x++) {
          const k = y * club.w + x;
          if (region[k] || d[k * 4 + 3] < 30 || at(ride, rm, x, y) || at(punch, pm, x, y)) continue;
          if (region[k - 1] || region[k + 1] || region[k - club.w] || region[k + club.w]) grow.push(k);
        }
      for (const k of grow) region[k] = 1;
    }
    for (let y = 0; y < club.h; y++)
      for (let x = 0; x < club.w; x++) {
        const k = y * club.w + x;
        if (!region[k]) continue;
        const i = k * 4;
        const lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        if (kind === 'crowbar') {
          d[i] = Math.min(255, lum * 0.85 + 38);
          d[i + 1] = Math.min(255, lum * 0.9 + 42);
          d[i + 2] = Math.min(255, lum * 0.95 + 54);
        } else {
          // thinner than the club: drop the outer pixel, then silver links with dark gaps
          const edge = !region[k - 1] || !region[k + 1] || !region[k - club.w] || !region[k + club.w];
          if (edge) {
            d[i + 3] = 0;
            continue;
          }
          const gap = ((x >> 1) + (y >> 1)) % 3 === 0;
          const l = gap ? lum * 0.35 + 20 : lum * 0.7 + 90;
          d[i] = Math.min(255, l);
          d[i + 1] = Math.min(255, l + 4);
          d[i + 2] = Math.min(255, l + 12);
        }
      }
    g.putImageData(img, 0, 0);
    out = { ...club, id: `${club.id}#${kind}`, img: c };
    byKind.set(kind, out);
    return out;
  }

  /** Darkened copy (a backlit silhouette), cached per sprite. */
  shaded(s: Sprite, brightness = 0.42): Sprite {
    let out = this.shades.get(s);
    if (!out) {
      const c = canvas(s.w, s.h);
      const g = c.getContext('2d')!;
      g.drawImage(s.img, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgba(8,10,20,${1 - brightness})`;
      g.fillRect(0, 0, s.w, s.h);
      out = { ...s, img: c };
      this.shades.set(s, out);
    }
    return out;
  }

  /** Horizontally mirrored copy (cached). */
  flipped(id: string): Sprite {
    let f = this.flips.get(id);
    if (!f) {
      const s = this.get(id);
      const c = canvas(s.w, s.h);
      const g = c.getContext('2d')!;
      g.translate(s.w, 0);
      g.scale(-1, 1);
      g.drawImage(s.img, 0, 0);
      f = { ...s, img: c, ax: s.w - s.ax };
      this.flips.set(id, f);
    }
    return f;
  }

  /**
   * Hue-rotated copy used to give riders who share a sprite design their own colours.
   * Skin-like pixels are left alone so faces and arms don't turn green.
   */
  tinted(id: string, hueDeg: number): Sprite {
    if (!hueDeg) return this.get(id);
    const key = `${id}@${hueDeg}`;
    let t = this.tints.get(key);
    if (!t) {
      const s = this.get(id);
      const c = canvas(s.w, s.h);
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(s.img, 0, 0);
      if (!s.placeholder) {
        const data = g.getImageData(0, 0, s.w, s.h);
        hueRotate(data.data, hueDeg);
        g.putImageData(data, 0, 0);
      }
      t = { ...s, img: c };
      this.tints.set(key, t);
    }
    return t;
  }
}

/**
 * Builds `target` rider's version of a pose: take the pixels of the player's pose frame that lie
 * outside the player's riding silhouette (the extended arm / leg / club), scale them to the target
 * design and paste them onto the target's riding frame, aligned on the rear-wheel anchor.
 */
function graftPose(target: Sprite, pRide: Sprite, rideMask: Uint8Array, pPose: Sprite, id: string): Sprite {
  const pose = canvas(pPose.w, pPose.h);
  const pg = pose.getContext('2d', { willReadFrequently: true })!;
  pg.drawImage(pPose.img, 0, 0);
  const pd = pg.getImageData(0, 0, pPose.w, pPose.h);
  for (let y = 0; y < pPose.h; y++) {
    for (let x = 0; x < pPose.w; x++) {
      const rx = Math.round(x - pPose.ax + pRide.ax), ry = Math.round(y - pPose.ay + pRide.ay);
      const inside = rx >= 0 && ry >= 0 && rx < pRide.w && ry < pRide.h && rideMask[ry * pRide.w + rx];
      if (inside) pd.data[(y * pPose.w + x) * 4 + 3] = 0;
    }
  }
  pg.putImageData(pd, 0, 0);
  const s = target.h / pRide.h;
  const ox = target.ax - pPose.ax * s, oy = target.ay - pPose.ay * s;
  const ow = pPose.w * s, oh = pPose.h * s;
  const minX = Math.min(0, ox), minY = Math.min(0, oy);
  const maxX = Math.max(target.w, ox + ow), maxY = Math.max(target.h, oy + oh);
  const out = canvas(Math.ceil(maxX - minX), Math.ceil(maxY - minY));
  const og = out.getContext('2d')!;
  og.drawImage(target.img, -minX, -minY);
  og.drawImage(pose, ox - minX, oy - minY, ow, oh);
  return { id, img: out, w: out.width, h: out.height, ax: target.ax - minX, ay: target.ay - minY };
}

/** Opaque-pixel mask of a sprite, grown by `radius` pixels (separable max filter). */
function silhouette(s: Sprite, radius: number): Uint8Array {
  const c = canvas(s.w, s.h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(s.img, 0, 0);
  const d = g.getImageData(0, 0, s.w, s.h).data;
  const a = new Uint8Array(s.w * s.h), b = new Uint8Array(s.w * s.h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] > 30 ? 1 : 0;
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      let v = 0;
      for (let k = -radius; k <= radius && !v; k++) v = a[y * s.w + Math.min(s.w - 1, Math.max(0, x + k))];
      b[y * s.w + x] = v;
    }
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      let v = 0;
      for (let k = -radius; k <= radius && !v; k++) v = b[Math.min(s.h - 1, Math.max(0, y + k)) * s.w + x];
      a[y * s.w + x] = v;
    }
  return a;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function hueRotate(px: Uint8ClampedArray, deg: number) {
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  // Same matrix as the CSS hue-rotate() filter.
  const m = [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ];
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.18) continue; // greys, blacks, chrome, white
    // skin-ish: red > green > blue, warm, moderate saturation
    if (r > g && g > b && r > 90 && sat < 0.62 && r - b > 30 && g - b > 12 && max > 110) continue;
    px[i] = r * m[0] + g * m[1] + b * m[2];
    px[i + 1] = r * m[3] + g * m[4] + b * m[5];
    px[i + 2] = r * m[6] + g * m[7] + b * m[8];
  }
}

/** Magenta-ish labelled box for missing art; riders/cars get a rough silhouette. */
function placeholder(id: string): Sprite {
  const isBg = id.startsWith('bg/') || id.startsWith('ui/') || id.startsWith('portraits/');
  const w = isBg ? 640 : 200, h = isBg ? 360 : 240;
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  if (isBg) {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#2a3b8f');
    grd.addColorStop(1, '#0b0f24');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  } else if (id.startsWith('riders/')) {
    g.fillStyle = '#222';
    g.fillRect(85, 120, 30, 115); // wheel
    g.fillStyle = '#b33';
    g.fillRect(60, 110, 80, 50); // bike
    g.fillStyle = '#333';
    g.fillRect(65, 40, 70, 80); // torso
    g.fillStyle = '#d22';
    g.beginPath();
    g.arc(100, 30, 26, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillStyle = 'rgba(200,40,160,0.85)';
    g.fillRect(10, 10, w - 20, h - 20);
  }
  g.fillStyle = '#fff';
  g.font = '12px monospace';
  g.fillText(id.slice(-24), 8, h - 8);
  return { id, img: c, w, h, ax: w / 2, ay: h, placeholder: true, horizon: isBg ? 0.6 : undefined };
}
