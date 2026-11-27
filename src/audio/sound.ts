import { PlayLimiter } from './limiter';
import { SFX, SONGS, renderSfx, renderSong, songSeconds } from './synth';

export interface PlayOpts {
  /** 0..1 multiplier on the per-id base volume. */
  volume?: number;
  /** playbackRate; default is 1 +/- 3% jitter. */
  pitch?: number;
  /** -1..1; use panFromX for positions. */
  pan?: number;
}

export const SOUND_IDS = [
  'paddle', 'wall', 'brick', 'break', 'steel', 'explode', 'launch', 'powerup', 'powerdown', 'laser',
  'eraser', 'lifelost', 'won', 'gameover', 'regen', 'reveal', 'net', 'click', 'shred',
  'staple', 'cliploose', 'clippop', 'snip', 'splash', 'paperclip', 'goldstar', 'redpen', 'combo',
] as const;

/** Bounces are quieter than breaks. */
export const BASE_VOLUME: Record<string, number> = {
  wall: 0.3, brick: 0.4, paddle: 0.55, break: 0.6, steel: 0.45, explode: 0.9, launch: 0.45, powerup: 0.7,
  powerdown: 0.7, laser: 0.4, eraser: 0.6, lifelost: 0.85, won: 0.8, gameover: 0.8, regen: 0.4, reveal: 0.45,
  net: 0.6, click: 0.35, shred: 0.4,
  staple: 0.22, cliploose: 0.45, clippop: 0.6, snip: 0.65, splash: 0.5, paperclip: 0.6, goldstar: 0.8, redpen: 0.7,
  combo: 0.55,
};

const SFX_RATE = 44100;
const MUSIC_RATE = 32000;
/** Music sits well under the effects. */
const MUSIC_LEVEL = 0.45;

interface SynthResult {
  sfx: Record<string, Float32Array>;
  songs: [Float32Array, Float32Array][];
}

/**
 * All audio is synthesized on the device (see synth.ts): rendered in a worker at page load, turned into
 * AudioBuffers on the first tap (which also unlocks iOS audio). Music is a looping chiptune track on its own
 * gain under the master volume.
 */
export class SoundManager {
  muted: boolean;
  volume: number;
  musicOn: boolean;
  musicVolume: number;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private songBufs: AudioBuffer[] = [];
  private raw: SynthResult = { sfx: {}, songs: [] };
  private limiter = new PlayLimiter(() => performance.now(), 35, 14);
  private suspended = false;
  private song = 0;
  private songSrc: AudioBufferSourceNode | null = null;
  private songStart = 0;
  private wantMusic = false;
  private duck = 1;

  constructor(init: { muted?: boolean; volume?: number; music?: boolean; musicVolume?: number } = {}) {
    this.muted = init.muted ?? false;
    this.volume = clamp01(init.volume ?? 0.8);
    this.musicOn = init.music ?? true;
    this.musicVolume = clamp01(init.musicVolume ?? 0.5);
    this.synthesize();
  }

  /** Starts rendering every sound (worker if available, else main thread in small slices). */
  private synthesize(): void {
    if (typeof window === 'undefined') return;
    try {
      const w = new Worker(new URL('./synthWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent) => {
        const d = e.data as { kind: string; sfx?: Record<string, Float32Array>; index?: number; l?: Float32Array; r?: Float32Array };
        if (d.kind === 'sfx' && d.sfx) this.raw.sfx = d.sfx;
        else if (d.kind === 'song' && d.l && d.r && d.index !== undefined) this.raw.songs[d.index] = [d.l, d.r];
        if (d.kind === 'song' && d.index === SONGS.length - 1) w.terminate();
        this.adopt();
      };
      w.onerror = () => {
        w.terminate();
        this.synthesizeInline();
      };
      w.postMessage({ sfxRate: SFX_RATE, musicRate: MUSIC_RATE });
    } catch {
      this.synthesizeInline();
    }
  }

  private synthesizeInline(): void {
    const ids = Object.keys(SFX);
    let i = 0;
    const tick = (): void => {
      if (i < ids.length) {
        for (let k = 0; k < 6 && i < ids.length; k++, i++) this.raw.sfx[ids[i]] = renderSfx(SFX[ids[i]].tones, SFX_RATE, SFX[ids[i]].fx);
      } else {
        const s = i - ids.length;
        if (s >= SONGS.length) return;
        this.raw.songs[s] = renderSong(SONGS[s], MUSIC_RATE);
        i++;
      }
      this.adopt();
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }

  /** Copies rendered data into AudioBuffers once a context exists. */
  private adopt(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const id of Object.keys(this.raw.sfx)) {
      const data = this.raw.sfx[id];
      const b = ctx.createBuffer(1, data.length, SFX_RATE);
      b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(id, b);
    }
    this.raw.sfx = {};
    this.raw.songs.forEach((pair, i) => {
      if (!pair || this.songBufs[i]) return;
      const b = ctx.createBuffer(2, pair[0].length, MUSIC_RATE);
      b.copyToChannel(pair[0] as Float32Array<ArrayBuffer>, 0);
      b.copyToChannel(pair[1] as Float32Array<ArrayBuffer>, 1);
      this.songBufs[i] = b;
    });
    if (this.wantMusic && !this.songSrc) this.startSong();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    this.applyGain();
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    this.applyGain();
  }

  setMusicVolume(v: number): void {
    this.musicVolume = clamp01(v);
    this.applyGain();
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    if (this.musicGain && this.ctx) {
      const g = this.musicOn ? this.musicVolume * MUSIC_LEVEL * this.duck : 0;
      this.musicGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.08);
    }
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.ratio.value = 4;
        comp.connect(this.ctx.destination);
        this.master = this.ctx.createGain();
        this.master.connect(comp);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0;
        this.musicGain.connect(this.master);
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
    this.adopt();
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

  hasSample(id: string): boolean {
    return this.buffers.has(id);
  }

  /** Starts (or switches to) background track `index` (wraps). */
  playMusic(index = this.song): void {
    this.song = ((index % SONGS.length) + SONGS.length) % SONGS.length;
    this.wantMusic = true;
    this.stopSong();
    this.startSong();
  }

  /** Next track (called on every new game). */
  nextTrack(): void {
    this.playMusic(this.song + 1);
  }

  /** Lowers the music (end screens) or restores it. */
  duckMusic(on: boolean): void {
    this.duck = on ? 0.35 : 1;
    this.applyGain();
  }

  private startSong(): void {
    const ctx = this.ctx;
    const buf = this.songBufs[this.song];
    if (!ctx || !buf || !this.musicGain) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicGain);
    this.songStart = ctx.currentTime + 0.05;
    src.start(this.songStart);
    this.songSrc = src;
  }

  private stopSong(): void {
    if (!this.songSrc) return;
    try {
      this.songSrc.stop();
    } catch {
      /* already stopped */
    }
    this.songSrc.disconnect();
    this.songSrc = null;
  }

  /** Visual beat pulse 0..1 (1 on each beat, decaying), 0 when no music is audible. */
  beat(): number {
    const ctx = this.ctx;
    if (!ctx || !this.songSrc || !this.musicOn || this.muted || this.musicVolume <= 0 || ctx.state !== 'running') return 0;
    const s = SONGS[this.song];
    const t = ctx.currentTime - this.songStart;
    if (t < 0) return 0;
    const ph = ((t % songSeconds(s)) * s.bpm) / 60;
    const f = ph - Math.floor(ph);
    return (1 - f) * (1 - f) * (1 - f);
  }

  play(id: string, opts: PlayOpts = {}): void {
    if (this.muted || this.volume <= 0 || this.suspended) return;
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const buf = this.buffers.get(id);
    if (!buf) return;
    const pitch = opts.pitch ?? 1 + (Math.random() * 2 - 1) * 0.03;
    if (!this.limiter.tryStart(id, (buf.duration / pitch) * 1000)) return;
    const g = ctx.createGain();
    g.gain.value = (BASE_VOLUME[id] ?? 0.6) * (opts.volume ?? 1);
    let tail: AudioNode = g;
    if (typeof ctx.createStereoPanner === 'function' && opts.pan !== undefined && opts.pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(p);
      tail = p;
    }
    tail.connect(this.master);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    src.connect(g);
    src.start(ctx.currentTime + 0.002);
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}
