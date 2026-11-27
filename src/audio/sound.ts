import { PlayLimiter } from './limiter';
import { GAME_SONGS, MENU_SONG, SFX, SONGS, SONG_ORDER, renderSfx, renderSong, songSeconds } from './synth';

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
  'staple', 'cliploose', 'clippop', 'snip', 'splash', 'paperclip', 'goldstar', 'redpen', 'combo', 'star',
  'ui_tap', 'ui_confirm', 'ui_back', 'ui_toggle', 'ui_tab', 'ui_locked', 'ui_whoosh', 'ui_tick', 'ui_count', 'ui_go', 'ui_total',
] as const;

/** Bounces are quieter than breaks. */
export const BASE_VOLUME: Record<string, number> = {
  wall: 0.3, brick: 0.4, paddle: 0.55, break: 0.6, steel: 0.45, explode: 0.9, launch: 0.45, powerup: 0.7,
  powerdown: 0.7, laser: 0.4, eraser: 0.6, lifelost: 0.85, won: 0.8, gameover: 0.8, regen: 0.4, reveal: 0.45,
  net: 0.6, click: 0.35, shred: 0.4,
  staple: 0.22, cliploose: 0.45, clippop: 0.6, snip: 0.65, splash: 0.5, paperclip: 0.6, goldstar: 0.8, redpen: 0.7,
  combo: 0.55, star: 0.6,
  ui_tap: 0.5, ui_confirm: 0.55, ui_back: 0.5, ui_toggle: 0.5, ui_tab: 0.45, ui_locked: 0.55, ui_whoosh: 0.4, ui_tick: 0.4,
  ui_count: 0.7, ui_go: 0.7, ui_total: 0.7,
};

/** Seconds for the menu <-> gameplay music crossfade. */
export const MUSIC_FADE = 0.6;
export type MusicScene = 'menu' | 'game';

/** Pure: which song plays in a scene (menus use the calm loop; gameplay cycles the other tracks). */
export function songForScene(scene: MusicScene, gameTrack: number): number {
  return scene === 'menu' ? MENU_SONG : ((gameTrack % GAME_SONGS) + GAME_SONGS) % GAME_SONGS;
}

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
  private paused = false;
  /** Song index currently playing (or wanted). */
  private song = MENU_SONG;
  private scene: MusicScene = 'menu';
  private gameTrack = 0;
  private songSrc: AudioBufferSourceNode | null = null;
  private songGain: GainNode | null = null;
  /** Song index the current source plays. */
  private playing = -1;
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
        if (d.kind === 'song' && this.raw.songs.filter(Boolean).length >= SONGS.length) w.terminate();
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
        if (s >= SONG_ORDER.length) return;
        const idx = SONG_ORDER[s];
        this.raw.songs[idx] = renderSong(SONGS[idx], MUSIC_RATE);
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
    if (this.wantMusic && this.playing !== this.song) this.switchSong();
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
      const g = this.musicOn ? this.musicVolume * MUSIC_LEVEL * this.duck * (this.paused ? 0.3 : 1) : 0;
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

  /** Game paused (pause overlay): gameplay sounds stop and the music drops to a murmur; UI sounds still play. */
  setPaused(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    this.applyGain();
  }

  hasSample(id: string): boolean {
    return this.buffers.has(id);
  }

  /** Which music plays: the calm menu loop or the gameplay track. Crossfades (MUSIC_FADE) when it changes. */
  setScene(scene: MusicScene): void {
    this.wantMusic = true;
    if (scene === 'menu') this.duckMusic(false);
    const was = this.scene;
    this.scene = scene;
    const want = songForScene(scene, this.gameTrack);
    if (this.songSrc && this.playing === want && was === scene) return;
    this.song = want;
    this.switchSong();
  }

  get musicScene(): MusicScene {
    return this.scene;
  }

  /** Next gameplay track (called on every new level); crossfades when the game scene is playing. */
  nextTrack(): void {
    this.gameTrack = (this.gameTrack + 1) % GAME_SONGS;
    if (this.scene !== 'game') return;
    this.song = songForScene('game', this.gameTrack);
    this.switchSong();
  }

  /** Lowers the music (end screens) or restores it. */
  duckMusic(on: boolean): void {
    const d = on ? 0.35 : 1;
    if (d === this.duck) return;
    this.duck = d;
    this.applyGain();
  }

  /** Fades the current source out and the wanted song in. A no-op until the song is rendered (adopt retries). */
  private switchSong(): void {
    const ctx = this.ctx;
    const buf = this.songBufs[this.song];
    if (!ctx || !buf || !this.musicGain) return;
    const t = ctx.currentTime;
    const old = this.songSrc;
    const oldGain = this.songGain;
    if (old && oldGain) {
      oldGain.gain.cancelScheduledValues(t);
      oldGain.gain.setValueAtTime(oldGain.gain.value, t);
      oldGain.gain.linearRampToValueAtTime(0, t + MUSIC_FADE);
      try {
        old.stop(t + MUSIC_FADE + 0.05);
      } catch {
        /* already stopped */
      }
      old.onended = () => {
        old.disconnect();
        oldGain.disconnect();
      };
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + MUSIC_FADE);
    src.connect(g);
    g.connect(this.musicGain);
    this.songStart = t + 0.05;
    src.start(this.songStart);
    this.songSrc = src;
    this.songGain = g;
    this.playing = this.song;
  }

  /** Visual beat pulse 0..1 (1 on each beat, decaying), 0 when no music is audible. */
  beat(): number {
    const ctx = this.ctx;
    if (!ctx || !this.songSrc || !this.musicOn || this.muted || this.musicVolume <= 0 || ctx.state !== 'running') return 0;
    const s = SONGS[this.playing];
    if (!s) return 0;
    const t = ctx.currentTime - this.songStart;
    if (t < 0) return 0;
    const ph = ((t % songSeconds(s)) * s.bpm) / 60;
    const f = ph - Math.floor(ph);
    return (1 - f) * (1 - f) * (1 - f);
  }

  play(id: string, opts: PlayOpts = {}): void {
    if (this.muted || this.volume <= 0 || this.suspended) return;
    if (this.paused && !id.startsWith('ui_')) return;
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
