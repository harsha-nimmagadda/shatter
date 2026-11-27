/**
 * Tiny offline chiptune synthesizer (pure JS, no Web Audio), so every sound in the game is generated on the
 * device in a few milliseconds and nothing is downloaded. Unit tested in Node.
 */

export type Wave = 'sq50' | 'sq25' | 'sq12' | 'tri' | 'saw' | 'sine' | 'noise' | 'hiss';

export interface Tone {
  /** Start offset, seconds. */
  t?: number;
  dur: number;
  wave: Wave;
  /** Start / end frequency (exponential glide). For noise: lowpass cutoff start / end. */
  f0: number;
  f1?: number;
  vol?: number;
  /** Attack seconds (default 3 ms). */
  attack?: number;
  /** Decay shape: amplitude = (1 - x)^curve over the note (default 1.6). 0 = flat (gate) with a short release. */
  curve?: number;
  /** Semitone offsets cycled at arpRate Hz (classic chip arpeggio). */
  arp?: readonly number[];
  arpRate?: number;
  /** Vibrato depth (semitones) and rate (Hz). */
  vib?: readonly [number, number];
  /** -1..1 stereo position (music only). */
  pan?: number;
}

export interface FxOpts {
  /** Feedback echo: delay seconds, feedback 0..1, wet mix. */
  echo?: readonly [number, number, number];
  /** Bit-crush levels (e.g. 16 = 4-bit). */
  crush?: number;
}

const TAU = Math.PI * 2;

/** Deterministic noise so renders are reproducible (tests, and identical sounds each session). */
function noiseGen(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Adds one tone into `out` (stereo when `right` is given) starting at sample offset; wraps if `wrap`. */
export function addTone(out: Float32Array, right: Float32Array | null, sr: number, tone: Tone, wrap = false, seed = 7): void {
  const start = Math.round((tone.t ?? 0) * sr);
  const n = Math.max(1, Math.round(tone.dur * sr));
  const vol = tone.vol ?? 0.5;
  const att = Math.max(1, Math.round((tone.attack ?? 0.003) * sr));
  const curve = tone.curve ?? 1.6;
  const rel = Math.min(n, Math.round(0.012 * sr));
  const f0 = tone.f0;
  const ratio = (tone.f1 ?? f0) / f0;
  const rnd = noiseGen(seed + start);
  const panL = right ? Math.min(1, 1 - (tone.pan ?? 0)) : 1;
  const panR = right ? Math.min(1, 1 + (tone.pan ?? 0)) : 0;
  const glide = ratio !== 1;
  let arpStep = -1;
  let arpMul = 1;
  let phase = 0;
  let lp = 0;
  let held = 0;
  let holdCount = 0;
  const len = out.length;
  for (let i = 0; i < n; i++) {
    let idx = start + i;
    if (idx >= len) {
      if (!wrap) break;
      idx %= len;
    }
    const x = i / n;
    let f = glide ? f0 * Math.pow(ratio, x) : f0;
    if (tone.arp && tone.arp.length) {
      const step = Math.floor((i / sr) * (tone.arpRate ?? 30)) % tone.arp.length;
      if (step !== arpStep) {
        arpStep = step;
        arpMul = Math.pow(2, tone.arp[step] / 12);
      }
      f *= arpMul;
    }
    if (tone.vib) f *= Math.pow(2, (tone.vib[0] * Math.sin(TAU * tone.vib[1] * (i / sr))) / 12);
    phase += f / sr;
    phase -= Math.floor(phase);
    let s: number;
    switch (tone.wave) {
      case 'sq50':
        s = phase < 0.5 ? 1 : -1;
        break;
      case 'sq25':
        s = phase < 0.25 ? 1 : -1;
        break;
      case 'sq12':
        s = phase < 0.125 ? 1 : -1;
        break;
      case 'tri':
        s = 4 * Math.abs(phase - 0.5) - 1;
        break;
      case 'saw':
        s = 2 * phase - 1;
        break;
      case 'sine':
        s = Math.sin(TAU * phase);
        break;
      case 'noise': {
        // Chip-style sample-and-hold noise: f controls the hold rate (pitch of the noise).
        const hold = Math.max(1, Math.round(sr / Math.max(50, f)));
        if (holdCount <= 0) {
          held = rnd();
          holdCount = hold;
        }
        holdCount--;
        s = held;
        break;
      }
      default: {
        // 'hiss': white noise through a one-pole lowpass at f.
        const a = 1 - Math.exp((-TAU * Math.min(f, sr * 0.45)) / sr);
        lp += a * (rnd() - lp);
        s = lp * 1.8;
      }
    }
    let env = i < att ? i / att : curve > 0 ? (curve === 1 ? 1 - x : Math.pow(1 - x, curve)) : 1;
    if (i > n - rel) env *= (n - i) / rel;
    const v = s * env * vol;
    out[idx] += v * panL;
    if (right) right[idx] += v * panR;
  }
}

/** Renders a sound effect (mono). */
export function renderSfx(tones: readonly Tone[], sr: number, fx: FxOpts = {}): Float32Array {
  let end = 0;
  for (const t of tones) end = Math.max(end, (t.t ?? 0) + t.dur);
  const tail = fx.echo ? fx.echo[0] * 4 : 0;
  const out = new Float32Array(Math.max(1, Math.ceil((end + tail + 0.01) * sr)));
  tones.forEach((t, k) => addTone(out, null, sr, t, false, 11 + k * 101));
  if (fx.crush) crush(out, fx.crush);
  if (fx.echo) echo(out, sr, fx.echo[0], fx.echo[1], fx.echo[2]);
  normalize(out, 0.9);
  return out;
}

export function crush(buf: Float32Array, levels: number): void {
  for (let i = 0; i < buf.length; i++) buf[i] = Math.round(buf[i] * levels) / levels;
}

export function echo(buf: Float32Array, sr: number, delay: number, fb: number, wet: number, wrap = false): void {
  const d = Math.max(1, Math.round(delay * sr));
  const n = buf.length;
  const line = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i - d;
    const prev = j >= 0 ? line[j] : wrap ? line[(j + n) % n] : 0;
    line[i] = buf[i] + prev * fb;
  }
  for (let i = 0; i < n; i++) {
    const j = i - d;
    buf[i] += (j >= 0 ? line[j] : wrap ? line[(j + n) % n] : 0) * wet;
  }
}

/** Scales so the peak is `target` (silent buffers are left alone). */
export function normalize(buf: Float32Array, target: number): void {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
  if (p < 1e-6) return;
  const g = target / p;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
}

/** Note name ("A4", "C#5", "Bb3") -> Hz. */
export function noteHz(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const base: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const semi = base[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, semi / 12);
}

const N = noteHz;

/** Every game sound as a recipe. Names match SOUND_IDS in sound.ts. */
export const SFX: Record<string, { tones: Tone[]; fx?: FxOpts }> = {
  paddle: {
    tones: [
      { dur: 0.09, wave: 'sq25', f0: 520, f1: 300, vol: 0.5, curve: 2 },
      { dur: 0.12, wave: 'tri', f0: 160, f1: 90, vol: 0.7 },
    ],
  },
  wall: { tones: [{ dur: 0.045, wave: 'tri', f0: 900, f1: 700, vol: 0.6, curve: 2.5 }] },
  brick: {
    tones: [
      { dur: 0.08, wave: 'sine', f0: 1568, vol: 0.6, curve: 3 },
      { dur: 0.06, wave: 'sq12', f0: 2350, vol: 0.2, curve: 3 },
    ],
  },
  break: {
    tones: [
      { dur: 0.16, wave: 'hiss', f0: 9000, f1: 2500, vol: 0.5, curve: 3 },
      { dur: 0.14, wave: 'sq25', f0: N('E5'), vol: 0.35, arp: [0, 7, 12, 19], arpRate: 40, curve: 1.4 },
      { dur: 0.1, wave: 'sine', f0: N('E6'), vol: 0.3, curve: 2 },
    ],
  },
  shred: { tones: [{ dur: 0.1, wave: 'hiss', f0: 7000, f1: 2000, vol: 0.6, curve: 2.5 }] },
  steel: {
    tones: [
      { dur: 0.22, wave: 'sq50', f0: 1810, vol: 0.18, curve: 3 },
      { dur: 0.25, wave: 'sine', f0: 2690, vol: 0.3, curve: 2.5 },
      { dur: 0.03, wave: 'noise', f0: 6000, vol: 0.4 },
    ],
  },
  explode: {
    tones: [
      { dur: 0.55, wave: 'noise', f0: 2200, f1: 180, vol: 0.9, curve: 1.8 },
      { dur: 0.35, wave: 'sine', f0: 150, f1: 38, vol: 1, curve: 1.2 },
    ],
    fx: { crush: 24 },
  },
  launch: { tones: [{ dur: 0.16, wave: 'sq25', f0: 260, f1: 1040, vol: 0.45, curve: 1 }, { dur: 0.12, wave: 'hiss', f0: 3000, f1: 8000, vol: 0.2 }] },
  powerup: {
    tones: [{ dur: 0.34, wave: 'sq25', f0: N('C5'), vol: 0.45, arp: [0, 4, 7, 12, 16, 19, 24], arpRate: 22, curve: 0.8 }],
    fx: { echo: [0.09, 0.35, 0.4] },
  },
  powerdown: {
    tones: [
      { dur: 0.4, wave: 'sq50', f0: 520, f1: 130, vol: 0.32, vib: [0.6, 14], curve: 1 },
      { dur: 0.4, wave: 'tri', f0: 260, f1: 65, vol: 0.5, curve: 1 },
    ],
  },
  laser: { tones: [{ dur: 0.12, wave: 'saw', f0: 1600, f1: 300, vol: 0.4 }] },
  eraser: {
    tones: [
      { dur: 0.45, wave: 'hiss', f0: 600, f1: 9000, vol: 0.6, curve: 1.2 },
      { dur: 0.4, wave: 'saw', f0: 180, f1: 1500, vol: 0.25, curve: 1.2 },
    ],
  },
  lifelost: {
    tones: [
      { dur: 0.75, wave: 'sq50', f0: 440, f1: 98, vol: 0.4, vib: [0.8, 9], curve: 0.9 },
      { dur: 0.3, wave: 'noise', f0: 1200, f1: 200, vol: 0.5 },
    ],
    fx: { crush: 16 },
  },
  won: {
    tones: [
      ...['C5', 'E5', 'G5', 'C6'].map((n, i) => ({ t: i * 0.1, dur: 0.12, wave: 'sq25' as const, f0: N(n), vol: 0.45, curve: 0.6 })),
      ...['A5', 'B5'].map((n, i) => ({ t: 0.45 + i * 0.1, dur: 0.12, wave: 'sq25' as const, f0: N(n), vol: 0.45, curve: 0.6 })),
      { t: 0.65, dur: 0.7, wave: 'sq25', f0: N('C6'), vol: 0.5, vib: [0.25, 6], curve: 1 },
      { t: 0.65, dur: 0.7, wave: 'tri', f0: N('C4'), vol: 0.6, curve: 1 },
      { t: 0.65, dur: 0.7, wave: 'sq12', f0: N('E5'), vol: 0.2, arp: [0, 3, 7], arpRate: 30, curve: 1 },
    ],
    fx: { echo: [0.12, 0.3, 0.3] },
  },
  gameover: {
    tones: [
      ...['G4', 'Eb4', 'C4'].map((n, i) => ({ t: i * 0.22, dur: 0.22, wave: 'sq50' as const, f0: N(n), vol: 0.35, curve: 0.8 })),
      { t: 0.66, dur: 0.9, wave: 'sq50', f0: N('B3'), f1: N('A3'), vol: 0.35, vib: [0.5, 5], curve: 1.2 },
      { t: 0.66, dur: 0.9, wave: 'tri', f0: N('G2'), vol: 0.6, curve: 1.2 },
    ],
    fx: { echo: [0.15, 0.25, 0.25] },
  },
  regen: { tones: [{ dur: 0.3, wave: 'tri', f0: 400, f1: 900, vol: 0.5, arp: [0, 5, 10], arpRate: 30, curve: 1 }] },
  reveal: {
    tones: [
      { dur: 0.1, wave: 'sine', f0: N('A6'), vol: 0.4, curve: 2 },
      { t: 0.06, dur: 0.14, wave: 'sine', f0: N('E7'), vol: 0.35, curve: 2 },
      { dur: 0.12, wave: 'hiss', f0: 8000, vol: 0.15 },
    ],
  },
  net: {
    tones: [
      { dur: 0.22, wave: 'sine', f0: 180, f1: 520, vol: 0.7, curve: 1.4 },
      { dur: 0.2, wave: 'sq12', f0: 360, f1: 1040, vol: 0.2, curve: 1.4 },
    ],
  },
  click: { tones: [{ dur: 0.035, wave: 'sq25', f0: 1320, vol: 0.4, curve: 2 }] },
  // ---- UI: same chip palette, short and soft so menus never fight the music ----
  ui_tap: {
    tones: [
      { dur: 0.06, wave: 'sq25', f0: N('G5'), f1: N('C6'), vol: 0.45, curve: 1.5 },
      { t: 0.03, dur: 0.05, wave: 'sine', f0: N('C7'), vol: 0.18, curve: 2 },
    ],
  },
  ui_confirm: {
    tones: [
      { dur: 0.07, wave: 'sq25', f0: N('C6'), vol: 0.42, curve: 1.2 },
      { t: 0.06, dur: 0.16, wave: 'sq25', f0: N('G6'), vol: 0.42, curve: 1.2 },
      { t: 0.06, dur: 0.12, wave: 'sine', f0: N('C7'), vol: 0.2, curve: 2 },
    ],
    fx: { echo: [0.07, 0.3, 0.25] },
  },
  ui_back: {
    tones: [
      { dur: 0.06, wave: 'sq25', f0: N('G5'), vol: 0.4, curve: 1.3 },
      { t: 0.055, dur: 0.11, wave: 'sq25', f0: N('C5'), vol: 0.4, curve: 1.4 },
    ],
  },
  ui_toggle: {
    tones: [
      { dur: 0.045, wave: 'sq50', f0: 880, f1: 1320, vol: 0.32, curve: 1.5 },
      { t: 0.04, dur: 0.05, wave: 'sine', f0: 1760, vol: 0.22, curve: 2 },
    ],
  },
  ui_tab: { tones: [{ dur: 0.045, wave: 'tri', f0: 1046, f1: 784, vol: 0.55, curve: 2.2 }] },
  ui_locked: {
    tones: [
      { dur: 0.17, wave: 'sq50', f0: 130, vol: 0.28, vib: [0.5, 28], curve: 0.8 },
      { dur: 0.14, wave: 'tri', f0: 196, f1: 110, vol: 0.35, curve: 1 },
    ],
    fx: { crush: 20 },
  },
  ui_whoosh: {
    tones: [
      { dur: 0.3, wave: 'hiss', f0: 500, f1: 6500, vol: 0.32, curve: 1.1, attack: 0.09 },
      { dur: 0.26, wave: 'sine', f0: 220, f1: 880, vol: 0.14, curve: 1.2, attack: 0.07 },
    ],
  },
  ui_tick: { tones: [{ dur: 0.03, wave: 'sq12', f0: N('A6'), vol: 0.4, curve: 2 }] },
  ui_count: {
    tones: [
      { dur: 0.12, wave: 'sq25', f0: N('A5'), vol: 0.5, curve: 1.2 },
      { dur: 0.14, wave: 'tri', f0: N('A3'), vol: 0.6, curve: 1.3 },
    ],
  },
  ui_go: {
    tones: [
      { dur: 0.09, wave: 'sq25', f0: N('E6'), vol: 0.45, curve: 1 },
      { t: 0.08, dur: 0.26, wave: 'sq25', f0: N('A6'), vol: 0.45, curve: 1 },
      { t: 0.08, dur: 0.2, wave: 'tri', f0: N('A3'), vol: 0.5, curve: 1 },
    ],
    fx: { echo: [0.09, 0.3, 0.3] },
  },
  ui_total: {
    tones: [
      { dur: 0.42, wave: 'sq25', f0: N('C6'), vol: 0.45, arp: [0, 7, 12], arpRate: 22, curve: 0.8 },
      { dur: 0.4, wave: 'tri', f0: N('C3'), vol: 0.6, curve: 1 },
    ],
    fx: { echo: [0.1, 0.3, 0.3] },
  },
  staple: { tones: [{ dur: 0.08, wave: 'sq25', f0: 1700, f1: 420, vol: 0.35, curve: 1.2 }] },
  cliploose: {
    tones: [
      { dur: 0.04, wave: 'sq12', f0: 1500, vol: 0.4, curve: 2 },
      { t: 0.07, dur: 0.04, wave: 'sq12', f0: 1300, vol: 0.35, curve: 2 },
    ],
  },
  clippop: {
    tones: [
      { dur: 0.12, wave: 'sine', f0: 300, f1: 1400, vol: 0.7, curve: 1.2 },
      { t: 0.08, dur: 0.12, wave: 'sq25', f0: N('G6'), vol: 0.2, curve: 2 },
    ],
  },
  snip: {
    tones: [
      { dur: 0.22, wave: 'saw', f0: 1400, f1: 120, vol: 0.45, curve: 1 },
      { dur: 0.08, wave: 'noise', f0: 5000, vol: 0.35 },
    ],
    fx: { crush: 12 },
  },
  splash: { tones: [{ dur: 0.22, wave: 'sine', f0: 500, f1: 1200, vol: 0.45, arp: [0, 7, 3, 10], arpRate: 45, curve: 1.6 }, { dur: 0.15, wave: 'hiss', f0: 2500, vol: 0.2 }] },
  paperclip: {
    tones: [{ dur: 0.35, wave: 'tri', f0: 220, f1: 880, vol: 0.6, vib: [0.8, 18], curve: 1 }],
    fx: { echo: [0.07, 0.3, 0.3] },
  },
  goldstar: {
    tones: [
      { dur: 0.55, wave: 'sq25', f0: N('G5'), vol: 0.42, arp: [0, 4, 7, 12, 16, 19, 24, 28], arpRate: 16, curve: 0.5 },
      { dur: 0.55, wave: 'tri', f0: N('G3'), vol: 0.5, curve: 0.8 },
    ],
    fx: { echo: [0.1, 0.35, 0.35] },
  },
  redpen: {
    tones: [
      { dur: 0.42, wave: 'saw', f0: 90, f1: 720, vol: 0.45, vib: [0.4, 25], curve: 0.6 },
      { dur: 0.42, wave: 'sq50', f0: 45, f1: 360, vol: 0.25, curve: 0.6 },
    ],
    fx: { crush: 20 },
  },
  star: {
    tones: [
      { dur: 0.32, wave: 'sine', f0: N('C6'), vol: 0.5, curve: 1.4 },
      { dur: 0.22, wave: 'sq25', f0: N('G6'), vol: 0.22, curve: 1.8 },
      { t: 0.02, dur: 0.16, wave: 'sine', f0: N('C7'), vol: 0.25, curve: 2 },
    ],
    fx: { echo: [0.09, 0.3, 0.3] },
  },
  combo: {
    tones: [
      { dur: 0.1, wave: 'sq25', f0: N('E6'), vol: 0.4, curve: 1 },
      { t: 0.07, dur: 0.18, wave: 'sq25', f0: N('B6'), vol: 0.4, curve: 1.2 },
    ],
    fx: { echo: [0.08, 0.3, 0.3] },
  },
};

// ------------------------------------------------------------------ music

export interface Song {
  name: string;
  bpm: number;
  /** One chord per bar: bass root note name and chord tones (semitones above the root). */
  chords: readonly (readonly [string, readonly number[]])[];
  /** Lead melody per bar: "E5:4 A5:2 R:2 ..." (durations in 16ths, R = rest). */
  lead: readonly string[];
  /** Calm arrangement (menus): held bass, soft 8th arpeggio, no kick/snare, sine-ish lead. */
  calm?: boolean;
}

/** Original tunes written for Shatter. */
export const SONGS: readonly Song[] = [
  {
    name: 'Neon Drive',
    bpm: 132,
    chords: [
      ['A2', [0, 3, 7]], ['F2', [0, 4, 7]], ['C3', [0, 4, 7]], ['G2', [0, 4, 7]],
      ['A2', [0, 3, 7]], ['F2', [0, 4, 7]], ['C3', [0, 4, 7]], ['G2', [0, 4, 7]],
      ['F2', [0, 4, 7]], ['G2', [0, 4, 7]], ['E2', [0, 3, 7]], ['A2', [0, 3, 7]],
      ['F2', [0, 4, 7]], ['G2', [0, 4, 7]], ['E2', [0, 4, 7]], ['E2', [0, 4, 7]],
    ],
    lead: [
      'E5:4 A5:2 G5:2 E5:4 D5:2 C5:2',
      'C5:4 F5:4 E5:2 D5:2 C5:4',
      'G5:6 E5:2 C5:4 E5:4',
      'D5:4 B4:4 G4:4 B4:2 D5:2',
      'E5:2 E5:2 A5:4 B5:2 C6:2 B5:2 A5:2',
      'A5:4 G5:2 F5:2 E5:4 C5:4',
      'E5:2 G5:2 C6:4 B5:2 G5:2 E5:4',
      'D5:4 G5:4 B5:6 R:2',
      'A5:2 C6:2 A5:2 F5:2 A5:4 C6:4',
      'B5:2 D6:2 B5:2 G5:2 B5:4 D6:4',
      'E6:4 D6:2 B5:2 G5:4 B5:4',
      'C6:6 B5:2 A5:8',
      'F5:2 A5:2 C6:2 F6:2 E6:4 C6:4',
      'D6:2 B5:2 G5:2 D6:2 C6:4 B5:4',
      'G#5:4 B5:4 E6:4 D6:4',
      'E6:8 R:4 E5:2 G#5:2',
    ],
  },
  {
    name: 'Pixel Rush',
    bpm: 150,
    chords: [
      ['E2', [0, 3, 7]], ['C2', [0, 4, 7]], ['D2', [0, 4, 7]], ['B1', [0, 4, 7]],
      ['E2', [0, 3, 7]], ['C2', [0, 4, 7]], ['D2', [0, 4, 7]], ['B1', [0, 4, 7]],
    ],
    lead: [
      'B4:2 E5:2 G5:2 B5:2 A5:2 G5:2 F#5:2 G5:2',
      'E5:4 G5:2 E5:2 C5:4 E5:4',
      'F#5:2 A5:2 D6:4 C6:2 A5:2 F#5:4',
      'D#5:4 F#5:4 B5:6 R:2',
      'G5:2 F#5:2 E5:2 B4:2 E5:2 G5:2 B5:4',
      'C6:4 B5:2 A5:2 G5:4 E5:4',
      'A5:2 F#5:2 D5:2 F#5:2 A5:2 D6:2 C6:2 A5:2',
      'B5:8 D#6:4 F#6:4',
    ],
  },
  {
    name: 'Neon Lounge',
    bpm: 88,
    calm: true,
    chords: [
      ['D3', [0, 3, 7, 10]], ['A#2', [0, 4, 7, 11]], ['F3', [0, 4, 7, 11]], ['C3', [0, 4, 7, 14]],
      ['G2', [0, 3, 7, 10]], ['D3', [0, 3, 7, 10]], ['A2', [0, 4, 7, 10]], ['D3', [0, 3, 7, 14]],
    ],
    lead: [
      'A4:6 C5:2 D5:8',
      'D5:4 F5:4 A4:8',
      'C5:6 A4:2 F4:4 A4:4',
      'G4:4 C5:4 E5:8',
      'D5:6 A#4:2 G4:8',
      'A4:4 D5:4 F5:4 E5:4',
      'E5:6 C#5:2 A4:4 R:4',
      'D5:8 A4:4 R:4',
    ],
  },
];

/** The menu loop is the last song; gameplay tracks are the ones before it. */
export const MENU_SONG = SONGS.length - 1;
export const GAME_SONGS = MENU_SONG;
/** Render order: the menu loop first (it is heard first), then the gameplay tracks. */
export const SONG_ORDER: readonly number[] = [MENU_SONG, ...Array.from({ length: GAME_SONGS }, (_, i) => i)];

/** Parses a lead bar into [noteName | null, sixteenths] pairs; throws unless it fills exactly 16. */
export function parseBar(bar: string): [string | null, number][] {
  const out: [string | null, number][] = [];
  let total = 0;
  for (const tok of bar.trim().split(/\s+/)) {
    const [n, d] = tok.split(':');
    const len = Number(d);
    if (!Number.isInteger(len) || len <= 0) throw new Error(`bad token ${tok}`);
    out.push([n === 'R' ? null : n, len]);
    total += len;
  }
  if (total !== 16) throw new Error(`bar "${bar}" has ${total} sixteenths`);
  return out;
}

/** Song length in seconds. */
export const songSeconds = (s: Song): number => (s.chords.length * 16 * 60) / (s.bpm * 4);

/**
 * Renders a song as a seamless stereo loop: lead (25% square + echo), chip arpeggio, triangle bass and
 * noise drums. Tails that run past the end wrap to the start so the loop has no click.
 */
export function renderSong(song: Song, sr: number): [Float32Array, Float32Array] {
  const step = 60 / (song.bpm * 4);
  const len = Math.round(songSeconds(song) * sr);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const lead = new Float32Array(len);
  const add = (t: Tone, ch: Float32Array = L, ch2: Float32Array | null = R): void => addTone(ch, ch2, sr, t, true, 3 + Math.round(t.t ?? 0) * 7);
  song.chords.forEach(([root, tones], bar) => {
    const t0 = bar * 16 * step;
    const rootHz = noteHz(root);
    if (song.calm) {
      // Held triangle bass (root, then the fifth), a soft sine pad on the chord, gentle 8th arpeggio, ghost hats only.
      add({ t: t0, dur: step * 7.6, wave: 'tri', f0: rootHz, vol: 0.5, curve: 0.5 });
      add({ t: t0 + step * 8, dur: step * 7.6, wave: 'tri', f0: rootHz * Math.pow(2, 7 / 12), vol: 0.42, curve: 0.5 });
      for (const semi of tones) add({ t: t0, dur: step * 15.5, wave: 'sine', f0: rootHz * Math.pow(2, (semi + 12) / 12), vol: 0.07, curve: 0.2, attack: 0.25, pan: semi % 2 ? 0.4 : -0.4 });
      for (let k = 0; k < 8; k++) {
        const semi = tones[(k * 3) % tones.length] + 24 + (k % 4 === 3 ? 12 : 0);
        add({ t: t0 + k * 2 * step, dur: step * 2.2, wave: 'tri', f0: rootHz * Math.pow(2, semi / 12), vol: 0.1, curve: 1.1, pan: k % 2 ? 0.45 : -0.45 });
      }
      for (let k = 2; k < 16; k += 4) add({ t: t0 + k * step, dur: 0.03, wave: 'hiss', f0: 9000, vol: 0.06, curve: 2, pan: 0.3 });
      let cs = 0;
      for (const [note, d] of parseBar(song.lead[bar])) {
        if (note) addTone(lead, null, sr, { t: t0 + cs * step, dur: d * step * 0.97, wave: 'sine', f0: noteHz(note), vol: 0.26, curve: 0.5, vib: [0.14, 5], attack: 0.03 }, true, 5);
        cs += d;
      }
      return;
    }
    // Bass: driving 8ths, root / octave / fifth.
    const bassPat = [0, 0, 12, 0, 0, 12, 7, 12];
    bassPat.forEach((semi, k) => add({ t: t0 + k * 2 * step, dur: step * 1.8, wave: 'tri', f0: rootHz * Math.pow(2, semi / 12), vol: 0.5, curve: 0.4 }));
    // Arp: chord tones in 16ths, two octaves up, quiet, alternating sides.
    for (let k = 0; k < 16; k++) {
      const semi = tones[k % tones.length] + 24 + (k % 8 >= 4 ? 12 : 0);
      add({ t: t0 + k * step, dur: step * 0.9, wave: 'sq12', f0: rootHz * Math.pow(2, semi / 12), vol: 0.09, curve: 1.2, pan: k % 2 ? 0.5 : -0.5 });
    }
    // Drums.
    for (let k = 0; k < 16; k++) {
      const t = t0 + k * step;
      if (k === 0 || k === 8 || (k === 10 && bar % 2 === 1)) add({ t, dur: 0.12, wave: 'sine', f0: 160, f1: 42, vol: 0.75, curve: 1.2 });
      if (k === 4 || k === 12) add({ t, dur: 0.12, wave: 'noise', f0: 5200, f1: 2600, vol: 0.32, curve: 1.6 });
      if (k % 2 === 1) add({ t, dur: 0.03, wave: 'hiss', f0: 11000, vol: 0.12, curve: 2, pan: 0.3 });
    }
    // Lead.
    let s = 0;
    for (const [note, d] of parseBar(song.lead[bar])) {
      if (note) addTone(lead, null, sr, { t: t0 + s * step, dur: d * step * 0.92, wave: 'sq25', f0: noteHz(note), vol: 0.2, curve: 0.35, vib: d >= 6 ? [0.18, 5.5] : undefined, attack: 0.006 }, true, 5);
      s += d;
    }
  });
  echo(lead, sr, step * 3, 0.32, 0.35, true);
  for (let i = 0; i < len; i++) {
    L[i] += lead[i] * 0.95;
    R[i] += lead[i] * 0.85;
  }
  let p = 0;
  for (let i = 0; i < len; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
  if (p > 1e-6) {
    const g = 0.85 / p;
    for (let i = 0; i < len; i++) {
      L[i] *= g;
      R[i] *= g;
    }
  }
  return [L, R];
}
