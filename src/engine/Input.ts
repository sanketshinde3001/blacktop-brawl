/**
 * Action-based input. Scenes ask for actions ("throttle", "attackL"), never raw keys, so
 * remapping or adding a device only touches this file.
 */

export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'throttle'
  | 'brake'
  | 'attackL'
  | 'attackR'
  | 'kick'
  | 'confirm'
  | 'back'
  | 'pause'
  | 'camera'
  | 'lookBack'
  | 'nitro'
  | 'debug';

/**
 * One-player keyboard: drive with the arrows (right hand), fight with the left hand resting on
 * Q W E / A S D. Z / X / C / N / V from earlier builds still work but aren't advertised.
 */
export const KEY_BINDINGS: Record<string, Action[]> = {
  ArrowUp: ['up', 'throttle'],
  ArrowDown: ['down', 'brake'],
  ArrowLeft: ['left'],
  ArrowRight: ['right'],
  KeyA: ['attackL'],
  KeyS: ['kick'],
  KeyD: ['attackR'],
  Space: ['confirm', 'nitro'],
  KeyQ: ['lookBack'],
  KeyE: ['camera'],
  // older layout, still accepted
  KeyZ: ['attackL'],
  KeyX: ['attackR'],
  KeyC: ['kick'],
  KeyN: ['nitro'],
  KeyV: ['camera'],
  Enter: ['confirm'],
  NumpadEnter: ['confirm'],
  Escape: ['back', 'pause'],
  Backspace: ['back'],
  KeyP: ['pause'],
  Backquote: ['debug'],
  F1: ['debug'],
};

/** Standard-mapping gamepad buttons. */
const PAD_BUTTONS: Record<number, Action[]> = {
  0: ['confirm', 'throttle'], // A / Cross
  1: ['back', 'brake'], // B / Circle
  2: ['attackL'], // X / Square
  3: ['attackR'], // Y / Triangle
  4: ['kick'], // LB
  5: ['kick'], // RB
  6: ['brake'], // LT
  7: ['throttle'], // RT
  8: ['camera'], // Select / Back
  9: ['pause'], // Start
  10: ['nitro'], // left stick click
  11: ['lookBack'], // right stick click
  12: ['up'],
  13: ['down'],
  14: ['left'],
  15: ['right'],
};

/** Two players on one keyboard (split screen): each seat has its own keys and its own gamepad. */
export const SEAT_KEYS: Record<string, Action[]>[] = [
  { KeyW: ['throttle', 'up'], KeyS: ['brake', 'down'], KeyA: ['left'], KeyD: ['right'], KeyQ: ['attackL'], KeyE: ['attackR'], KeyR: ['kick'], ShiftLeft: ['nitro'] },
  {
    KeyI: ['throttle', 'up'], KeyK: ['brake', 'down'], KeyJ: ['left'], KeyL: ['right'], KeyU: ['attackL'], KeyO: ['attackR'], KeyH: ['kick'], KeyN: ['nitro'],
    ArrowUp: ['throttle', 'up'], ArrowDown: ['brake', 'down'], ArrowLeft: ['left'], ArrowRight: ['right'], ShiftRight: ['nitro'],
  },
];

/** One player's view of the controls in split screen. */
export interface Seat {
  isDown(a: Action): boolean;
  pressed(a: Action): boolean;
  axisX(): number;
}

export class Input {
  private keys = new Set<string>();
  /** keys pressed since the last poll, so taps shorter than a frame still count */
  private tapped = new Set<string>();
  private prevKeys = new Set<string>();
  private padActions = new Set<Action>();
  /** actions per gamepad slot (for split screen) */
  private padSlots: Set<Action>[] = [];
  private seatDown: Set<Action>[] = [new Set(), new Set()];
  private seatPrev: Set<Action>[] = [new Set(), new Set()];
  /** actions held by on-screen touch buttons (see TouchControls) */
  readonly virtual = new Set<Action>();
  private down = new Set<Action>();
  private prev = new Set<Action>();
  /** Characters typed since last frame (for name / password entry). */
  typed: string[] = [];
  anyKeyPressed = false;
  private anyKeyLatch = false;
  onFirstGesture: (() => void) | null = null;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace', 'F1'].includes(e.code)) e.preventDefault();
      this.gesture();
      if (!e.repeat) this.anyKeyLatch = true;
      this.keys.add(e.code);
      this.tapped.add(e.code);
      if (e.key.length === 1) this.typed.push(e.key);
      else if (e.key === 'Backspace') this.typed.push('\b');
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
    target.addEventListener('pointerdown', () => {
      this.gesture();
      this.anyKeyLatch = true;
    });
  }

  private gesture() {
    if (this.onFirstGesture) {
      const f = this.onFirstGesture;
      this.onFirstGesture = null;
      f();
    }
  }

  /** Call once per update tick, before scenes read input. */
  poll() {
    this.prevKeysSnapshot();
    this.prev = this.down;
    this.down = new Set();
    for (const code of this.keys) for (const a of KEY_BINDINGS[code] ?? []) this.down.add(a);
    for (const code of this.tapped) for (const a of KEY_BINDINGS[code] ?? []) this.down.add(a);
    this.pollGamepads();
    for (const a of this.padActions) this.down.add(a);
    for (const a of this.virtual) this.down.add(a);
    // split-screen seats: own keys + own gamepad
    for (let n = 0; n < 2; n++) {
      this.seatPrev[n] = this.seatDown[n];
      const d = new Set<Action>();
      for (const code of [...this.keys, ...this.tapped]) for (const a of SEAT_KEYS[n][code] ?? []) d.add(a);
      for (const a of this.padSlots[n] ?? []) d.add(a);
      this.seatDown[n] = d;
    }
    this.anyKeyPressed = this.anyKeyLatch || (this.padActions.size > 0 && this.prevPadCount === 0);
    this.prevPadCount = this.padActions.size;
    this.anyKeyLatch = false;
    this.tapped.clear();
  }
  private prevPadCount = 0;

  private prevKeysSnapshot() {
    this.prevKeys = this.currentKeys;
    this.currentKeys = new Set([...this.keys, ...this.tapped]);
  }
  private currentKeys = new Set<string>();

  /** Raw key edge (for debug shortcuts that aren't game actions). */
  keyPressed(code: string): boolean {
    return this.currentKeys.has(code) && !this.prevKeys.has(code);
  }

  /** Clear typed characters after a scene consumed them. */
  endFrame() {
    this.typed = [];
  }

  private pollGamepads() {
    this.padActions.clear();
    this.padSlots = [];
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const slot = new Set<Action>();
      pad.buttons.forEach((b, i) => {
        if (b.pressed || b.value > 0.5) for (const a of PAD_BUTTONS[i] ?? []) slot.add(a);
      });
      const [ax, ay] = pad.axes;
      if (ax < -0.45) slot.add('left');
      if (ax > 0.45) slot.add('right');
      if (ay < -0.5) slot.add('up');
      if (ay > 0.5) slot.add('down');
      this.padSlots.push(slot);
      for (const a of slot) this.padActions.add(a);
    }
  }

  /** Player `n`'s controls in split screen (0 = left keys / pad 1, 1 = right keys / pad 2). */
  seat(n: 0 | 1): Seat {
    const down = () => this.seatDown[n], prev = () => this.seatPrev[n];
    return {
      isDown: (a) => down().has(a),
      pressed: (a) => down().has(a) && !prev().has(a),
      axisX: () => (down().has('right') ? 1 : 0) - (down().has('left') ? 1 : 0),
    };
  }

  isDown(a: Action): boolean {
    return this.down.has(a);
  }
  pressed(a: Action): boolean {
    return this.down.has(a) && !this.prev.has(a);
  }
  released(a: Action): boolean {
    return !this.down.has(a) && this.prev.has(a);
  }
  /** -1 / 0 / +1 */
  axisX(): number {
    return (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
  }
  axisY(): number {
    return (this.isDown('down') ? 1 : 0) - (this.isDown('up') ? 1 : 0);
  }
}
