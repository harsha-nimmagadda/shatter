/**
 * Pure gravity-vector maths for tilt steering.
 *
 * Everything works on the unit "up" vector in DEVICE coordinates (x right, y towards the top edge, z out of the
 * screen). That is what an Android accelerometer reads at rest (flat face-up = [0, 0, 1]), so it never depends on
 * the screen orientation: portrait, landscape, upside down or lying in bed all give consistent angles.
 *
 * Steering = the signed angle of the current vector about a steering axis `n`, relative to a neutral vector `g0`.
 * `n` comes from a 3-point calibration (neutral, full left, full right) or, without one, from the screen angle.
 */

export type Vec3 = readonly [number, number, number];

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scaleVec = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** Unit vector, or the zero vector when the input is (nearly) zero. */
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l < 1e-9 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

export const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c));

/** Unsigned angle between two vectors in degrees (0 when either is degenerate). */
export function angleBetween(a: Vec3, b: Vec3): number {
  if (length(a) < 1e-9 || length(b) < 1e-9) return 0;
  return Math.atan2(length(cross(a, b)), dot(a, b)) * DEG;
}

/** Component of `v` perpendicular to the unit axis `n`. */
export function projectOffAxis(v: Vec3, n: Vec3): Vec3 {
  return sub(v, scaleVec(n, dot(v, n)));
}

/**
 * Signed angle (degrees, right-handed about `n`) that takes `g0` to `g`, both projected onto the plane perpendicular
 * to `n`. 0 when either projection is degenerate (the phone's gravity is parallel to the axis).
 */
export function signedAngleAbout(g: Vec3, g0: Vec3, n: Vec3): number {
  const a = projectOffAxis(g0, n);
  const b = projectOffAxis(g, n);
  if (length(a) < 1e-3 || length(b) < 1e-3) return 0;
  return Math.atan2(dot(cross(a, b), n), dot(a, b)) * DEG;
}

/** Up vector in device coordinates from deviceorientation beta/gamma (degrees). */
export function gravityFromOrientation(betaDeg: number, gammaDeg: number): Vec3 {
  const b = betaDeg * RAD;
  const g = gammaDeg * RAD;
  return [-Math.sin(g) * Math.cos(b), Math.sin(b), Math.cos(g) * Math.cos(b)];
}

/** Exponential low-pass of a vector (frame-rate independent). Returns the new smoothed value. */
export function lowPassVec(prev: Vec3 | null, sample: Vec3, dt: number, timeConstant = 0.08): Vec3 {
  if (!prev) return sample;
  if (dt <= 0) return prev;
  const k = 1 - Math.exp(-dt / timeConstant);
  return [prev[0] + (sample[0] - prev[0]) * k, prev[1] + (sample[1] - prev[1]) * k, prev[2] + (sample[2] - prev[2]) * k];
}

/** Screen rotation snapped to 0 / 90 / 180 / 270 (accepts window.orientation's negative angles). */
export function normalizeScreenAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  return ((Math.round(a / 90) * 90) % 360 + 360) % 360;
}

/** Device-coordinate unit vector that points to the TOP of the screen for a given screen rotation angle. */
export function screenUp(angle: number): Vec3 {
  switch (normalizeScreenAngle(angle)) {
    case 90:
      return [1, 0, 0];
    case 180:
      return [0, -1, 0];
    case 270:
      return [-1, 0, 0];
    default:
      return [0, 1, 0];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Calibration

export interface TiltCalibration {
  /** Neutral up-vector (unit). */
  g0: Vec3;
  /** Steering axis (unit). Positive rotation about it = steer right. */
  n: Vec3;
  /** Degrees of tilt from neutral that mean "full left" (positive number). */
  left: number;
  /** Degrees of tilt from neutral that mean "full right" (positive number). */
  right: number;
}

/** Smallest range we accept per side, degrees. */
export const MIN_RANGE_DEG = 6;
export const MAX_RANGE_DEG = 90;
/** Range of the automatic calibration; the sensitivity slider scales it (see tiltRangeDeg). */
export const DEFAULT_RANGE_DEG = 40 - (4 * 30) / 9;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Degrees of tilt from neutral that put the paddle at the wall. Sensitivity 1..10 -> 40..10. */
export function tiltRangeDeg(sensitivity: number): number {
  const s = clamp(sensitivity, 1, 10);
  return 40 - ((s - 1) * 30) / 9;
}

/** The slider scales the captured range: 1 at the default sensitivity, below 1 for a more sensitive setting. */
export function rangeScale(sensitivity: number): number {
  return tiltRangeDeg(sensitivity) / DEFAULT_RANGE_DEG;
}

/** No saved calibration: steer about the screen's vertical axis, neutral = wherever the phone is held right now. */
export function defaultCalibration(g0: Vec3, screenAngle: number): TiltCalibration {
  const up = screenUp(screenAngle);
  // Tilting the right side of the screen down moves the up-vector along -right, i.e. a positive turn about -up.
  return { g0: normalize(g0), n: [-up[0], -up[1], -up[2]], left: DEFAULT_RANGE_DEG, right: DEFAULT_RANGE_DEG };
}

export type CalibrationError = 'degenerate' | 'tooClose' | 'neutralOutside';
export type CalibrationResult = { ok: true; cal: TiltCalibration } | { ok: false; error: CalibrationError };

/**
 * Builds a calibration from the three captured up-vectors. The steering axis is perpendicular to the plane through
 * left and right (n = L x R, so going left -> right is a positive turn). Left/right ranges are the signed angles of
 * the captures about n relative to neutral, so an asymmetric hold works.
 */
export function computeCalibration(g0In: Vec3, gLIn: Vec3, gRIn: Vec3): CalibrationResult {
  const g0 = normalize(g0In);
  const gL = normalize(gLIn);
  const gR = normalize(gRIn);
  if (length(g0) === 0 || length(gL) === 0 || length(gR) === 0) return { ok: false, error: 'degenerate' };
  const span = angleBetween(gL, gR);
  if (span > 170) return { ok: false, error: 'degenerate' };
  if (span < 2 * MIN_RANGE_DEG) return { ok: false, error: 'tooClose' };
  const n = normalize(cross(gL, gR));
  const thetaL = signedAngleAbout(gL, g0, n);
  const thetaR = signedAngleAbout(gR, g0, n);
  // Neutral must sit between the two extremes (a degree of slack for hand wobble).
  if (thetaL > 1 || thetaR < -1) return { ok: false, error: 'neutralOutside' };
  return {
    ok: true,
    cal: { g0, n, left: clamp(-thetaL, MIN_RANGE_DEG, MAX_RANGE_DEG), right: clamp(thetaR, MIN_RANGE_DEG, MAX_RANGE_DEG) },
  };
}

/** Signed steering angle (degrees, negative = left) of the current up-vector. */
export function tiltAngle(g: Vec3, cal: TiltCalibration): number {
  return signedAngleAbout(g, cal.g0, cal.n);
}

export const TILT_DEAD_ZONE_DEG = 1;

/** Maps a steering angle to [-1, 1] with a dead zone, separate left/right ranges, scale and invert. */
export function tiltAxis(angle: number, cal: TiltCalibration, scale = 1, invert = false): number {
  const range = Math.max(MIN_RANGE_DEG * 0.4, (angle < 0 ? cal.left : cal.right) * scale);
  const dz = Math.min(TILT_DEAD_ZONE_DEG, range * 0.25);
  const mag = Math.abs(angle);
  if (mag <= dz) return 0;
  const v = Math.sign(angle) * Math.min(1, (mag - dz) / (range - dz));
  return invert ? -v : v;
}

/** Maps an axis in [-1, 1] to a paddle centre x, clamped so the paddle stays inside the playfield. */
export function axisToPaddleX(axis: number, playfieldW: number, paddleW: number): number {
  const half = (playfieldW - paddleW) / 2;
  return clamp(playfieldW / 2 + clamp(axis, -1, 1) * half, paddleW / 2, playfieldW - paddleW / 2);
}

/** Parses a stored calibration, or null when it is missing or malformed. */
export function parseCalibration(v: unknown): TiltCalibration | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!isVec3(r.g0) || !isVec3(r.n)) return null;
  const g0 = normalize(r.g0);
  const n = normalize(r.n);
  if (length(g0) === 0 || length(n) === 0) return null;
  if (typeof r.left !== 'number' || typeof r.right !== 'number' || !Number.isFinite(r.left) || !Number.isFinite(r.right)) return null;
  return { g0, n, left: clamp(r.left, MIN_RANGE_DEG, MAX_RANGE_DEG), right: clamp(r.right, MIN_RANGE_DEG, MAX_RANGE_DEG) };
}

// ---------------------------------------------------------------------------------------------------------------
// Steadiness (used by the calibration wizard)

export interface GSample {
  g: Vec3;
  /** ms */
  t: number;
}

/**
 * Longest run of the most recent samples that all stay within `tolDeg` of the newest one.
 * Returns how long that run has lasted and its mean direction.
 */
export function steadySuffix(samples: readonly GSample[], tolDeg: number): { durationMs: number; count: number; mean: Vec3 } {
  const n = samples.length;
  if (n === 0) return { durationMs: 0, count: 0, mean: [0, 0, 0] };
  const last = samples[n - 1];
  let start = n - 1;
  while (start > 0 && angleBetween(samples[start - 1].g, last.g) <= tolDeg) start--;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = start; i < n; i++) {
    sx += samples[i].g[0];
    sy += samples[i].g[1];
    sz += samples[i].g[2];
  }
  return { durationMs: last.t - samples[start].t, count: n - start, mean: normalize([sx, sy, sz]) };
}
