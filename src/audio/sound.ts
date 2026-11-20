import { processSample, pickVariant } from './dsp';
import { PlayLimiter } from './limiter';

export interface PlayOpts {
  /** 0..1 multiplier on the per-id base volume. */
  volume?: number;
  /** playbackRate; default is 1 +/- 4% jitter. */
  pitch?: number;
  /** -1..1; use panFromX for positions. */
  pan?: number;
}

export const SOUND_IDS = [
  'paddle', 'wall', 'brick', 'break', 'steel', 'explode', 'launch', 'powerup', 'powerdown', 'laser',
  'eraser', 'lifelost', 'won', 'gameover', 'regen', 'reveal', 'net', 'click', 'shred',
] as const;

/** Bounces are quieter than breaks. */
export const BASE_VOLUME: Record<string, number> = {
  wall: 0.35, brick: 0.45, paddle: 0.6, break: 0.8, steel: 0.55, explode: 1, launch: 0.5, powerup: 0.8,
  powerdown: 0.8, laser: 0.45, eraser: 0.7, lifelost: 1, won: 1, gameover: 1, regen: 0.5, reveal: 0.5,
  net: 0.7, click: 0.5, shred: 0.5,
};

/** Synth building blocks writing into a destination node (the per-voice gain/pan chain). */
interface Synth {
  tone(t: number, freq: number, dur: number, type: OscillatorType, gain: number, freqEnd?: number): void;
  noise(t: number, dur: number, freq: number, gain: number, q?: number): void;
}

/** Fallback recipes (TriLine-style tone/noise), used when no sample is loaded for an id. */
const RECIPES: Record<string, { dur: number; run: (s: Synth) => void }> = {
  paddle: { dur: 0.15, run: (s) => { s.tone(0, 200, 0.12, 'sine', 0.9, 80); s.noise(0, 0.03, 1500, 0.3, 2); } },
  wall: { dur: 0.07, run: (s) => { s.tone(0, 700, 0.05, 'triangle', 0.5, 450); s.noise(0, 0.02, 3000, 0.2, 2); } },
  brick: { dur: 0.09, run: (s) => { s.tone(0, 420, 0.07, 'triangle', 0.6, 300); s.noise(0, 0.03, 2200, 0.25, 2); } },
  break: { dur: 0.22, run: (s) => { s.noise(0, 0.2, 2600, 0.7, 0.7); s.tone(0, 300, 0.1, 'triangle', 0.3, 120); } },
  steel: { dur: 0.25, run: (s) => { s.tone(0, 1800, 0.22, 'sine', 0.5); s.tone(0, 2700, 0.15, 'sine', 0.25); } },
  explode: { dur: 0.45, run: (s) => { s.noise(0, 0.4, 500, 1, 0.6); s.tone(0, 120, 0.35, 'sine', 0.9, 40); } },
  launch: { dur: 0.2, run: (s) => { s.noise(0, 0.18, 1400, 0.4, 0.8); s.tone(0, 300, 0.15, 'sine', 0.2, 700); } },
  powerup: { dur: 0.35, run: (s) => { s.tone(0, 523.25, 0.18, 'triangle', 0.5); s.tone(0.09, 783.99, 0.25, 'triangle', 0.5); } },
  powerdown: { dur: 0.4, run: (s) => { s.tone(0, 330, 0.18, 'square', 0.18, 220); s.tone(0.1, 196, 0.3, 'sine', 0.6, 110); } },
  laser: { dur: 0.15, run: (s) => { s.tone(0, 1400, 0.12, 'sawtooth', 0.15, 300); s.noise(0, 0.08, 3500, 0.15, 1.5); } },
  eraser: { dur: 0.45, run: (s) => { s.noise(0, 0.4, 1100, 0.45, 0.6); } },
  lifelost: { dur: 0.6, run: (s) => { s.tone(0, 220, 0.5, 'sine', 0.7, 60); s.noise(0, 0.3, 700, 0.4, 0.8); } },
  won: { dur: 0.7, run: (s) => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => s.tone(i * 0.13, f, 0.4, 'triangle', 0.45)); } },
  gameover: { dur: 0.85, run: (s) => { [392, 349.23, 311.13, 261.63].forEach((f, i) => s.tone(i * 0.16, f, 0.45, 'sine', 0.5)); } },
  regen: { dur: 0.3, run: (s) => { s.noise(0, 0.12, 2500, 0.25, 1.5); s.noise(0.14, 0.12, 2800, 0.25, 1.5); } },
  reveal: { dur: 0.25, run: (s) => { s.noise(0, 0.22, 1800, 0.35, 0.7); } },
  net: { dur: 0.2, run: (s) => { s.noise(0, 0.18, 1200, 0.3, 1); s.tone(0, 500, 0.12, 'sine', 0.3, 800); } },
  click: { dur: 0.05, run: (s) => { s.tone(0, 1200, 0.03, 'square', 0.25, 800); s.noise(0, 0.015, 3000, 0.2, 2); } },
  shred: { dur: 0.12, run: (s) => { s.noise(0, 0.1, 3200, 0.4, 0.8); } },
};

type Manifest = Record<string, string[]>;

export class SoundManager {
  muted: boolean;
  volume: number;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer[]>();
  private raw = new Map<string, ArrayBuffer[]>();
  private lastVariant = new Map<string, number>();
  private limiter = new PlayLimiter(() => performance.now(), 35, 12);
  private suspended = false;

  constructor(init: { muted?: boolean; volume?: number } = {}) {
    this.muted = init.muted ?? false;
    this.volume = clamp01(init.volume ?? 0.8);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    this.applyGain();
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.8;
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.applyGain();
      } catch {
        return null;
      }
    }
    return this.ctx;
  }

  /** Call from a user gesture (the start tap): creates/resumes the context and plays a silent buffer (iOS). */
  unlock(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.suspended = false;
    void ctx.resume().catch(() => undefined);
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
    void this.decodePending();
  }

  /** Suspend/resume with the game (pause overlay, hidden tab). */
  suspend(): void {
    this.suspended = true;
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    this.suspended = false;
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  /** Fetches manifest.json and the files it lists. Never throws; anything missing means synth fallback. */
  async load(base = './assets/sfx/'): Promise<void> {
    try {
      const res = await fetch(base + 'manifest.json');
      if (!res.ok) return;
      const manifest = (await res.json()) as Manifest;
      if (!manifest || typeof manifest !== 'object') return;
      await Promise.all(
        Object.entries(manifest).map(async ([id, files]) => {
          if (!Array.isArray(files)) return;
          const got: ArrayBuffer[] = [];
          for (const f of files) {
            if (typeof f !== 'string') continue;
            try {
              const r = await fetch(base + f);
              if (r.ok) got.push(await r.arrayBuffer());
            } catch {
              /* missing file: skip */
            }
          }
          if (got.length) this.raw.set(id, got);
        }),
      );
      // Decoding needs a context; if none exists yet (no tap so far) unlock() decodes later.
      if (this.ctx) await this.decodePending();
    } catch {
      /* no samples: synth fallback */
    }
  }

  private async decodePending(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.raw.size === 0) return;
    const pending = [...this.raw.entries()];
    this.raw.clear();
    await Promise.all(
      pending.map(async ([id, datas]) => {
        const out: AudioBuffer[] = [];
        for (const d of datas) {
          try {
            out.push(this.process(ctx, await decode(ctx, d)));
          } catch {
            /* undecodable: skip */
          }
        }
        if (out.length) this.buffers.set(id, out);
      }),
    );
  }

  private process(ctx: AudioContext, buf: AudioBuffer): AudioBuffer {
    const chs: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c).slice());
    const out = processSample(chs, buf.sampleRate);
    const len = Math.max(1, out[0]?.length ?? 1);
    const nb = ctx.createBuffer(out.length || 1, len, buf.sampleRate);
    out.forEach((ch, c) => nb.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
    return nb;
  }

  hasSample(id: string): boolean {
    return (this.buffers.get(id)?.length ?? 0) > 0;
  }

  play(id: string, opts: PlayOpts = {}): void {
    if (this.muted || this.volume <= 0 || this.suspended) return;
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const variants = this.buffers.get(id);
    const recipe = RECIPES[id];
    if (!variants?.length && !recipe) return;
    const pitch = opts.pitch ?? 1 + (Math.random() * 2 - 1) * 0.04;
    let buf: AudioBuffer | null = null;
    let durMs = (recipe?.dur ?? 0.3) * 1000;
    if (variants?.length) {
      const i = pickVariant(variants.length, this.lastVariant.get(id) ?? -1);
      buf = variants[i];
      durMs = (buf.duration / pitch) * 1000;
      if (!this.limiter.tryStart(id, durMs)) return;
      this.lastVariant.set(id, i);
    } else if (!this.limiter.tryStart(id, durMs)) {
      return;
    }

    const t0 = ctx.currentTime + 0.003;
    const g = ctx.createGain();
    g.gain.value = (BASE_VOLUME[id] ?? 0.7) * (opts.volume ?? 1);
    let tail: AudioNode = g;
    if (typeof ctx.createStereoPanner === 'function' && opts.pan !== undefined && opts.pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(p);
      tail = p;
    }
    tail.connect(this.master);

    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = pitch;
      src.connect(g);
      src.start(t0);
    } else if (recipe) {
      recipe.run(makeSynth(ctx, g, t0, pitch));
    }
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // Callback form for older Safari, promise form elsewhere.
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

function makeSynth(ctx: AudioContext, dest: AudioNode, t0: number, pitch: number): Synth {
  return {
    tone(t, freq, dur, type, gain, freqEnd) {
      const s = t0 + t;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * pitch, s);
      if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(freqEnd * pitch, s + dur);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(gain, s + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      osc.connect(g).connect(dest);
      osc.start(s);
      osc.stop(s + dur + 0.02);
    },
    noise(t, dur, freq, gain, q = 1) {
      const s = t0 + t;
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq;
      filter.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, s);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      src.connect(filter).connect(g).connect(dest);
      src.start(s);
    },
  };
}
