import { readStore, writeStore } from '../ui/storage';

export interface ControlSettings {
  mode: 'tilt' | 'drag' | 'stick';
  /** 1..10 */
  tiltSensitivity: number;
  /** 0.5..3 */
  dragSensitivity: number;
  /** Stick speed multiplier 0.6..1.6 (1 = full deflection crosses the playfield in ~0.55 s). */
  stickSpeed: number;
  /** Degrees. */
  tiltNeutral: number;
  invertTilt: boolean;
  /** Screen shake effect. */
  shake: boolean;
  /** Sound muted. */
  muted: boolean;
  /** Master volume 0..1. */
  volume: number;
  /** Background music on/off. */
  music: boolean;
  /** Music volume 0..1 (under the master volume). */
  musicVolume: number;
  /** Reduced effects: fewer particles, no flashes, still background. */
  reducedFx: boolean;
  /** Vibration on hits (phones that support it). */
  haptics: boolean;
  /** Graphics quality: Auto adapts to the frame rate. */
  graphics: 'auto' | 'high' | 'low';
}

export const CONTROLS_KEY = 'shatter.controls';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function defaultSettings(touch: boolean): ControlSettings {
  return { mode: touch ? 'tilt' : 'drag', tiltSensitivity: 5, dragSensitivity: 1.5, stickSpeed: 1, tiltNeutral: 0, invertTilt: false, shake: true, muted: false, volume: 0.8, music: true, musicVolume: 0.5, reducedFx: false, haptics: true, graphics: 'auto' };
}

/** Pure: parses stored JSON, falling back to defaults per field. */
export function parseSettings(raw: string | null, touch: boolean): ControlSettings {
  const d = defaultSettings(touch);
  if (!raw) return d;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return d;
  }
  if (typeof o !== 'object' || o === null) return d;
  const r = o as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, def: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : def;
  return {
    mode: r.mode === 'tilt' || r.mode === 'drag' || r.mode === 'stick' ? r.mode : d.mode,
    tiltSensitivity: num(r.tiltSensitivity, 1, 10, d.tiltSensitivity),
    dragSensitivity: num(r.dragSensitivity, 0.5, 3, d.dragSensitivity),
    stickSpeed: num(r.stickSpeed, 0.6, 1.6, d.stickSpeed),
    tiltNeutral: num(r.tiltNeutral, -180, 180, d.tiltNeutral),
    invertTilt: typeof r.invertTilt === 'boolean' ? r.invertTilt : d.invertTilt,
    shake: typeof r.shake === 'boolean' ? r.shake : d.shake,
    muted: typeof r.muted === 'boolean' ? r.muted : d.muted,
    volume: num(r.volume, 0, 1, d.volume),
    music: typeof r.music === 'boolean' ? r.music : d.music,
    musicVolume: num(r.musicVolume, 0, 1, d.musicVolume),
    reducedFx: typeof r.reducedFx === 'boolean' ? r.reducedFx : d.reducedFx,
    haptics: typeof r.haptics === 'boolean' ? r.haptics : d.haptics,
    graphics: r.graphics === 'auto' || r.graphics === 'high' || r.graphics === 'low' ? r.graphics : d.graphics,
  };
}

export function hasTouch(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** True when nothing has been saved yet (the very first launch). */
export function hasSavedSettings(): boolean {
  return readStore(CONTROLS_KEY) !== null;
}

export function loadSettings(): ControlSettings {
  return parseSettings(readStore(CONTROLS_KEY), hasTouch());
}

export function saveSettings(s: ControlSettings): void {
  writeStore(CONTROLS_KEY, JSON.stringify(s));
}
