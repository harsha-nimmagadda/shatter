import { readStore, writeStore } from '../ui/storage';
import { parseCalibration, type TiltCalibration } from './gravity';

export interface ControlSettings {
  mode: 'tilt' | 'drag' | 'stick';
  /** 1..10 */
  tiltSensitivity: number;
  /** 0.5..3 */
  dragSensitivity: number;
  /** Stick speed multiplier 0.6..1.6 (1 = full deflection crosses the playfield in ~0.55 s). */
  stickSpeed: number;
  /** 3-point tilt calibration (gravity vectors); null = automatic from the screen orientation. */
  tiltCal: TiltCalibration | null;
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
  /** Reduce motion: no menu animations, wipes, title demo, screen shake or slow-motion. Defaults ON with the OS preference. */
  reduceMotion: boolean;
  /** In-game teaching callouts (power-up names, first hazard, new bricks). */
  tips: boolean;
  /** Vibration on hits (phones that support it). */
  haptics: boolean;
  /** Graphics quality: Auto adapts to the frame rate. */
  graphics: 'auto' | 'high' | 'low';
}

export const CONTROLS_KEY = 'shatter.controls';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function defaultSettings(touch: boolean, osReduceMotion = false): ControlSettings {
  return { mode: touch ? 'tilt' : 'drag', tiltSensitivity: 5, dragSensitivity: 1.5, stickSpeed: 1, tiltCal: null, invertTilt: false, shake: true, muted: false, volume: 0.8, music: true, musicVolume: 0.5, reducedFx: false, reduceMotion: osReduceMotion, tips: true, haptics: true, graphics: 'auto' };
}

/** Pure: parses stored JSON, falling back to defaults per field. */
export function parseSettings(raw: string | null, touch: boolean, osReduceMotion = false): ControlSettings {
  const d = defaultSettings(touch, osReduceMotion);
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
    tiltCal: parseCalibration(r.tiltCal),
    invertTilt: typeof r.invertTilt === 'boolean' ? r.invertTilt : d.invertTilt,
    shake: typeof r.shake === 'boolean' ? r.shake : d.shake,
    muted: typeof r.muted === 'boolean' ? r.muted : d.muted,
    volume: num(r.volume, 0, 1, d.volume),
    music: typeof r.music === 'boolean' ? r.music : d.music,
    musicVolume: num(r.musicVolume, 0, 1, d.musicVolume),
    reducedFx: typeof r.reducedFx === 'boolean' ? r.reducedFx : d.reducedFx,
    reduceMotion: typeof r.reduceMotion === 'boolean' ? r.reduceMotion : d.reduceMotion,
    tips: typeof r.tips === 'boolean' ? r.tips : d.tips,
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
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function hasSavedSettings(): boolean {
  return readStore(CONTROLS_KEY) !== null;
}

export function loadSettings(): ControlSettings {
  return parseSettings(readStore(CONTROLS_KEY), hasTouch(), prefersReducedMotion());
}

export function saveSettings(s: ControlSettings): void {
  writeStore(CONTROLS_KEY, JSON.stringify(s));
}
