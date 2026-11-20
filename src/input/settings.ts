import { readStore, writeStore } from '../ui/storage';

export interface ControlSettings {
  mode: 'tilt' | 'drag';
  /** 1..10 */
  tiltSensitivity: number;
  /** 0.5..3 */
  dragSensitivity: number;
  /** Degrees. */
  tiltNeutral: number;
  invertTilt: boolean;
}

export const CONTROLS_KEY = 'shatter.controls';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function defaultSettings(touch: boolean): ControlSettings {
  return { mode: touch ? 'tilt' : 'drag', tiltSensitivity: 5, dragSensitivity: 1.5, tiltNeutral: 0, invertTilt: false };
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
    mode: r.mode === 'tilt' || r.mode === 'drag' ? r.mode : d.mode,
    tiltSensitivity: num(r.tiltSensitivity, 1, 10, d.tiltSensitivity),
    dragSensitivity: num(r.dragSensitivity, 0.5, 3, d.dragSensitivity),
    tiltNeutral: num(r.tiltNeutral, -180, 180, d.tiltNeutral),
    invertTilt: typeof r.invertTilt === 'boolean' ? r.invertTilt : d.invertTilt,
  };
}

export function hasTouch(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function loadSettings(): ControlSettings {
  return parseSettings(readStore(CONTROLS_KEY), hasTouch());
}

export function saveSettings(s: ControlSettings): void {
  writeStore(CONTROLS_KEY, JSON.stringify(s));
}
