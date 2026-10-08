/**
 * Procedural 16-bit style rock band used whenever a generated music file is missing:
 * drums, bass, distorted power-chord guitar and a square-wave lead, sequenced in real time.
 */

export interface MusicStyle {
  bpm: number;
  /** MIDI note of the key's root (bass register) */
  root: number;
  /** chord roots per bar, in semitones from `root` */
  bars: number[];
  /** 16-step kick pattern */
  kick: number[];
  /** 'straight' 8ths or 'shuffle' */
  feel: 'straight' | 'shuffle';
  lead: number[];
  /** minor or major third for the lead arpeggio */
  minor: boolean;
}

const K = (s: string) => s.split('').map((c) => (c === 'x' ? 1 : 0));

export const MUSIC_STYLES: Record<string, MusicStyle> = {
  title: { bpm: 132, root: 40, bars: [0, 0, 3, 5, 0, 0, 7, 5], kick: K('x.....x.x.......'), feel: 'straight', lead: [0, 3, 7, 12, 10, 7, 3, 7], minor: true },
  menu: { bpm: 104, root: 45, bars: [0, 0, 5, 0, 7, 5, 0, 7], kick: K('x.......x.......'), feel: 'shuffle', lead: [0, 3, 5, 6, 7, 10, 7, 5], minor: true },
  race_sierra: { bpm: 168, root: 40, bars: [0, 0, 1, 0, 0, 0, 3, 1], kick: K('x.x.x.x.x.x.x.x.'), feel: 'straight', lead: [0, 7, 12, 7, 0, 3, 7, 3], minor: true },
  race_pacific: { bpm: 176, root: 43, bars: [0, 5, 7, 5, 0, 5, 7, 7], kick: K('x...x.x.x...x.x.'), feel: 'straight', lead: [0, 4, 7, 12, 7, 4, 0, 4], minor: false },
  race_redwood: { bpm: 144, root: 38, bars: [0, 0, 3, 2, 0, 0, 5, 3], kick: K('x..x..x.x..x....'), feel: 'straight', lead: [0, 3, 5, 3, 7, 5, 3, 0], minor: true },
  race_desert: { bpm: 128, root: 36, bars: [0, 0, 0, 3, 0, 0, 5, 3], kick: K('x.....x...x.....'), feel: 'straight', lead: [0, 3, 0, 5, 0, 6, 5, 3], minor: true },
  race_grass: { bpm: 156, root: 45, bars: [0, 5, 0, 7, 0, 5, 7, 7], kick: K('x...x...x...x...'), feel: 'shuffle', lead: [0, 4, 7, 9, 12, 9, 7, 4], minor: false },
  ending: { bpm: 120, root: 40, bars: [0, 5, 7, 5, 0, 5, 7, 7], kick: K('x.......x.x.....'), feel: 'straight', lead: [0, 4, 7, 12, 11, 7, 4, 7], minor: false },
};

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class SynthMusic {
  private out: GainNode;
  private drive: WaveShaperNode;
  private guitarBus: GainNode;
  private noise: AudioBuffer;
  private timer = 0;
  private step = 0;
  private next = 0;

  constructor(private ctx: AudioContext, dest: AudioNode, private style: MusicStyle) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.out.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 0.8);
    // distortion for the guitar
    this.drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 6);
    }
    this.drive.curve = curve;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    this.guitarBus = ctx.createGain();
    this.guitarBus.gain.value = 0.16;
    this.drive.connect(tone).connect(this.guitarBus).connect(this.out);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  start() {
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(fade = 0.6) {
    window.clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => this.out.disconnect(), fade * 1000 + 100);
  }

  private schedule() {
    const st = this.style;
    const sixteenth = 60 / st.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.15) {
      let t = this.next;
      const s = this.step % 16;
      if (st.feel === 'shuffle' && s % 2 === 1) t += sixteenth * 0.33;
      this.play(s, Math.floor(this.step / 16), t, sixteenth);
      this.next += sixteenth;
      this.step++;
    }
  }

  private play(s: number, bar: number, t: number, len: number) {
    const st = this.style;
    const chord = st.root + st.bars[bar % st.bars.length];
    if (st.kick[s]) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 2 === 0) this.hat(t, s % 4 === 0 ? 0.05 : 0.03);
    // bass: 8ths with an octave pop on the offbeat of beat 4
    if (s % 2 === 0) this.tone('sawtooth', freq(s === 14 ? chord + 12 : chord), t, len * 1.8, 0.18, 900);
    // guitar: palm-muted chug, open accents on the downbeats of odd bars
    if (s % 2 === 0) {
      const open = s === 0 && bar % 2 === 0;
      this.power(chord + 12, t, open ? len * 7 : len * 1.4, open ? 1 : 0.6);
    }
    // lead arpeggio on the second half of each 4-bar phrase
    if (bar % 4 >= 2 && s % 2 === 0) {
      const n = st.lead[(s / 2) % st.lead.length];
      this.tone('square', freq(chord + 24 + n), t, len * 1.6, 0.05, 3500);
    }
  }

  private tone(type: OscillatorType, f: number, t: number, dur: number, vol: number, cutoff: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    o.type = type;
    o.frequency.value = f;
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(lp).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private power(root: number, t: number, dur: number, vol: number) {
    for (const [n, det] of [[0, -6], [7, 5], [12, 0]] as const) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = freq(root + n);
      o.detune.value = det;
      g.gain.setValueAtTime(vol * 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.drive);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.32);
  }

  private snare(t: number) {
    this.noiseHit(t, 0.18, 'bandpass', 1800, 0.45);
    this.tone('triangle', 190, t, 0.1, 0.25, 2000);
  }

  private hat(t: number, vol: number) {
    this.noiseHit(t, 0.04, 'highpass', 7000, vol * 4);
  }

  private noiseHit(t: number, dur: number, type: BiquadFilterType, f: number, vol: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
