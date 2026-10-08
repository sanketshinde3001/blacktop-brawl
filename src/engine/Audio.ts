/**
 * WebAudio wrapper.
 *  - music: streamed through <audio> elements (3-minute tracks would be huge as decoded buffers)
 *  - sfx / voice / jingles: decoded AudioBuffers
 *  - engine: synthesised in real time so pitch follows the tachometer
 * Any sound whose file is missing falls back to a small procedural synth, so nothing is silent.
 */
import type { Assets } from './Assets';
import { MUSIC_STYLES, SynthMusic } from './SynthMusic';
import { VOICE_LINES } from '../data/voices';

export interface SfxOptions {
  volume?: number;
  rate?: number;
  pan?: number;
}

export interface LoopHandle {
  setVolume(v: number): void;
  setRate(r: number): void;
  stop(): void;
}

export class AudioManager {
  readonly ctx: AudioContext;
  private master: GainNode;
  private sfxBus: GainNode;
  private musicBus: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private music: { id: string; el: HTMLAudioElement; node: MediaElementAudioSourceNode; gain: GainNode } | null = null;
  /** procedural fallback when a music file hasn't been generated yet */
  private synthMusic: { id: string; band: SynthMusic } | null = null;
  private noise: AudioBuffer;
  musicVolume = 0.6;
  sfxVolume = 0.9;

  constructor(private assets: Assets) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.noise = this.makeNoise(2);
    this.applyVolumes();
  }

  unlock() {
    if (this.ctx.state !== 'running') this.ctx.resume();
    if (this.music && this.music.el.paused) this.music.el.play().catch(() => {});
  }

  setVolumes(music: number, sfx: number) {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    this.applyVolumes();
  }
  private applyVolumes() {
    this.musicBus.gain.value = this.musicVolume;
    this.sfxBus.gain.value = this.sfxVolume;
  }

  /** Decode every non-music audio file in the manifest. */
  async loadBuffers(onProgress?: (p: number) => void): Promise<void> {
    const ids = Object.keys(this.assets.manifest.audio).filter((id) => !id.startsWith('music/') || isJingle(id));
    let done = 0;
    await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(this.assets.audioUrl(id)!);
          const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(id, buf);
        } catch {
          console.warn(`[audio] failed to load ${id}`);
        }
        onProgress?.(++done / ids.length);
      }),
    );
  }

  // --- music -----------------------------------------------------------------------------
  playMusic(id: string, { loop = true, fade = 0.8 } = {}) {
    if (this.music?.id === id || this.synthMusic?.id === id) return;
    this.stopMusic(fade);
    const url = this.assets.audioUrl(id);
    if (!url) {
      const style = MUSIC_STYLES[id.replace('music/', '')];
      if (style) {
        const band = new SynthMusic(this.ctx, this.musicBus, style);
        band.start();
        this.synthMusic = { id, band };
      }
      return;
    }
    const el = new Audio(url);
    el.loop = loop;
    el.crossOrigin = 'anonymous';
    const node = this.ctx.createMediaElementSource(el);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + fade);
    node.connect(gain).connect(this.musicBus);
    el.play().catch(() => {});
    this.music = { id, el, node, gain };
  }

  stopMusic(fade = 0.6) {
    if (this.synthMusic) {
      this.synthMusic.band.stop(fade);
      this.synthMusic = null;
    }
    const m = this.music;
    if (!m) return;
    this.music = null;
    const t = this.ctx.currentTime;
    m.gain.gain.cancelScheduledValues(t);
    m.gain.gain.setValueAtTime(m.gain.gain.value, t);
    m.gain.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => {
      m.el.pause();
      m.node.disconnect();
    }, fade * 1000 + 50);
  }

  /** Temporarily lower the music (e.g. under a jingle or voice line). */
  duck(amount = 0.25, seconds = 3) {
    const g = this.musicBus.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.musicVolume * amount, t + 0.15);
    g.setValueAtTime(this.musicVolume * amount, t + seconds);
    g.linearRampToValueAtTime(this.musicVolume, t + seconds + 0.6);
  }

  // --- one-shots ------------------------------------------------------------------------
  play(id: string, opts: SfxOptions = {}): void {
    if (this.ctx.state !== 'running') return;
    const buf = this.buffers.get(id);
    if (!buf) return this.synth(id, opts);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    src.connect(gain).connect(pan).connect(this.sfxBus);
    src.start();
  }

  /**
   * Voice lines duck the music while they play. Lines without a recording are spoken by the
   * device's built-in speech synthesis.
   */
  voice(id: string, volume = 1) {
    const buf = this.buffers.get(id);
    if (buf) {
      this.duck(0.35, buf.duration);
      this.play(id, { volume });
      return;
    }
    const line = VOICE_LINES[id];
    const speech = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!line || !speech || this.ctx.state !== 'running') return;
    try {
      speech.cancel();
      const u = new SpeechSynthesisUtterance(line.text);
      const voice = this.pickVoice(speech);
      if (voice) u.voice = voice;
      u.pitch = line.pitch;
      u.rate = line.rate;
      u.volume = Math.min(1, volume * this.sfxVolume);
      this.duck(0.35, 0.4 + line.text.length * 0.07);
      speech.speak(u);
    } catch {
      /* speech not available: stay silent */
    }
  }

  private chosenVoice: SpeechSynthesisVoice | null | undefined;
  /** Prefer a deep-ish English voice; fall back to whatever English voice exists. */
  private pickVoice(speech: SpeechSynthesis): SpeechSynthesisVoice | null {
    if (this.chosenVoice !== undefined) return this.chosenVoice;
    const voices = speech.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
    if (!voices.length) return null; // list may still be loading; try again next time
    const prefer = ['Daniel', 'Alex', 'Google UK English Male', 'Microsoft David', 'Fred', 'Google US English'];
    this.chosenVoice = prefer.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean) ?? voices[0];
    return this.chosenVoice;
  }

  jingle(id: string) {
    const buf = this.buffers.get(id);
    if (buf) this.duck(0.0, buf.duration);
    this.play(id, { volume: 0.9 });
  }

  loop(id: string, volume = 1): LoopHandle {
    const buf = this.buffers.get(id) ?? this.noise;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    let out: AudioNode = gain;
    if (!this.buffers.has(id)) {
      // fallback: filtered noise
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 600;
      src.connect(f).connect(gain);
    } else src.connect(gain);
    out.connect(this.sfxBus);
    src.start();
    return {
      setVolume: (v) => gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05),
      setRate: (r) => src.playbackRate.setTargetAtTime(r, this.ctx.currentTime, 0.05),
      stop: () => {
        gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        setTimeout(() => src.stop(), 300);
      },
    };
  }

  // --- procedural fallbacks + UI blips ---------------------------------------------------
  blip(freq = 660, dur = 0.06, type: OscillatorType = 'square', volume = 0.25) {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, volume: number, opts: SfxOptions) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = opts.rate ?? 1;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volume * (opts.volume ?? 1), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur);
  }

  private synth(id: string, opts: SfxOptions) {
    const name = id.split('/').pop();
    switch (name) {
      case 'punch': case 'kick': case 'thud': case 'grunt':
        this.burst(0.12, 900, 0.9, opts);
        this.blip(90, 0.12, 'sine', 0.6 * (opts.volume ?? 1));
        break;
      case 'club': case 'grab':
        this.burst(0.08, 3000, 0.8, opts);
        break;
      case 'crash': case 'carCrash':
        this.burst(0.9, 2500, 1, opts);
        break;
      case 'thunder':
        this.burst(0.35, 1800, 0.7, opts);
        setTimeout(() => this.burst(2.6, 240, 1, opts), 120);
        break;
      case 'nitro':
        this.burst(0.9, 1400, 0.8, opts);
        this.blip(160, 0.5, 'sawtooth', 0.12 * (opts.volume ?? 1));
        break;
      case 'chain':
        this.burst(0.05, 6000, 0.7, opts);
        setTimeout(() => this.burst(0.06, 5000, 0.6, opts), 45);
        setTimeout(() => this.burst(0.08, 4000, 0.5, opts), 95);
        break;
      case 'achievement':
        this.arpeggio([72, 76, 79, 84], 0.08, 0.7);
        break;
      case 'screech':
        this.blip(1400, 0.4, 'sawtooth', 0.12);
        break;
      case 'horn': case 'truckHorn':
        this.blip(380, 0.35, 'square', 0.18);
        this.blip(300, 0.35, 'square', 0.18);
        break;
      case 'cash':
        this.blip(1200, 0.08);
        setTimeout(() => this.blip(1800, 0.2), 80);
        break;
      // jingles: little square-wave fanfares
      case 'win':
      case 'levelup':
        this.arpeggio([64, 67, 71, 76, 79, 83, 88], 0.11, 0.9);
        break;
      case 'lose':
      case 'gameover':
        this.arpeggio([69, 67, 64, 63, 60, 57], 0.2, 1.2);
        break;
      case 'busted':
        this.arpeggio([57, 56, 55], 0.35, 0.8);
        break;
      default:
        break;
    }
  }

  private arpeggio(notes: number[], step: number, last: number) {
    notes.forEach((n, i) => {
      const f = 440 * Math.pow(2, (n - 69) / 12);
      setTimeout(() => this.blip(f, i === notes.length - 1 ? last : step * 1.4, 'square', 0.2), i * step * 1000);
    });
  }

  private makeNoise(seconds: number): AudioBuffer {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  createEngine(): EngineSound {
    return new EngineSound(this.ctx, this.sfxBus, this.noise);
  }
}

function isJingle(id: string) {
  return ['music/win', 'music/lose', 'music/busted', 'music/levelup', 'music/gameover'].includes(id);
}

/**
 * Motorcycle engine: two detuned sawtooth oscillators + a sub square, pushed through a
 * low-pass filter whose cutoff opens with throttle, plus a little exhaust noise.
 */
export class EngineSound {
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private sub: OscillatorNode;
  private filter: BiquadFilterNode;
  private gain: GainNode;
  private noiseGain: GainNode;
  private noiseSrc: AudioBufferSourceNode;
  private stopped = false;

  constructor(private ctx: AudioContext, out: AudioNode, noise: AudioBuffer) {
    this.oscA = ctx.createOscillator();
    this.oscB = ctx.createOscillator();
    this.sub = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscB.type = 'sawtooth';
    this.sub.type = 'square';
    this.oscB.detune.value = 18;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 4;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    this.oscA.connect(this.filter);
    this.oscB.connect(this.filter);
    this.sub.connect(subGain).connect(this.filter);
    this.noiseSrc = ctx.createBufferSource();
    this.noiseSrc.buffer = noise;
    this.noiseSrc.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1200;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseSrc.connect(nf).connect(this.noiseGain).connect(this.gain);
    this.filter.connect(this.gain).connect(out);
    this.oscA.start();
    this.oscB.start();
    this.sub.start();
    this.noiseSrc.start();
  }

  /** rpm ~ 1000..11000, throttle 0..1 */
  update(rpm: number, throttle: number, volume = 1) {
    if (this.stopped) return;
    const t = this.ctx.currentTime;
    const f = 22 + rpm / 34;
    this.oscA.frequency.setTargetAtTime(f, t, 0.03);
    this.oscB.frequency.setTargetAtTime(f * 1.005, t, 0.03);
    this.sub.frequency.setTargetAtTime(f / 2, t, 0.03);
    this.filter.frequency.setTargetAtTime(350 + rpm * 0.16 + throttle * 900, t, 0.05);
    this.gain.gain.setTargetAtTime((0.1 + throttle * 0.08) * volume, t, 0.06);
    this.noiseGain.gain.setTargetAtTime(0.05 + throttle * 0.25, t, 0.05);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(0, t, 0.08);
    setTimeout(() => {
      [this.oscA, this.oscB, this.sub, this.noiseSrc].forEach((n) => n.stop());
    }, 500);
  }
}
