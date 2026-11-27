/**
 * Adaptive tilt (experimental): learns the steering axis, neutral and range from how the player actually moves.
 *
 * Pure maths, no DOM. Two parts:
 *  - QuickStart: a ~3 s "swing your phone left and right" capture -> initial TiltCalibration (PCA axis).
 *  - AdaptiveTilt: during play, slowly re-centres the neutral, tracks the per-side range and re-estimates the axis,
 *    so a posture change (sitting -> lying down) settles by itself.
 */
import {
  DEG,
  RAD,
  angleBetween,
  cross,
  dot,
  length,
  normalize,
  scaleVec,
  signedAngleAbout,
  sub,
  tiltAngle,
  type TiltCalibration,
  type Vec3,
} from './gravity';

export const ADAPT = {
  minRange: 8,
  maxRange: 35,
  /** Neutral follows the recent mean angle with this time constant, s. */
  neutralTau: 10,
  /** The mean angle the neutral follows is the steering angle smoothed with this time constant, s. */
  meanTau: 1.5,
  /** Neutral stops following while the paddle is deeper than this fraction of the range (held near a wall). */
  freezeFrac: 0.5,
  /** Faster re-centring used only when the player swings around a mean far from neutral (posture change), s. */
  escapeTau: 4,
  /** Rolling window for the range extremes (seconds of play) and the percentile used. */
  rangeWindow: 20,
  rangePercentile: 0.9,
  /** Range moves at most this many degrees per second. */
  rangeRate: 3,
  /** Rolling window for the axis re-estimate, s. */
  axisWindow: 10,
  /** Axis estimate this far (degrees) from the current one, for this many updates in a row, re-seeds the calibration. */
  reseedDeg: 15,
  reseedUpdates: 3,
  /** After a re-seed, neutral and ranges settle with fast constants for this long, s (and neutral uses fastTau). */
  fastSettle: 8,
  fastTau: 2.5,
  /** A re-seed keeps only this many seconds of history, s. */
  reseedWindow: 5,
  /** Weight of older samples in the axis estimate decays with this time constant, s. */
  axisRecency: 3,
  /** Blend time constant of the axis towards each new estimate, s. */
  axisTau: 4,
  /** Lateral motion needed before the axis is re-estimated, degrees of std. */
  minSwingDeg: 3,
  /** Share of the variance the main swing direction must explain. */
  minRatio: 0.6,
  /** Gravity high-pass time constant used to take slow posture drift out of the axis estimate, s. */
  hpTau: 1.5,
  sampleHz: 20,
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Rotates v by `deg` degrees right-handed about the unit axis n (Rodrigues). */
export function rotateAbout(v: Vec3, n: Vec3, deg: number): Vec3 {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  const nxv = cross(n, v);
  const k = dot(n, v) * (1 - c);
  return [v[0] * c + nxv[0] * s + n[0] * k, v[1] * c + nxv[1] * s + n[1] * k, v[2] * c + nxv[2] * s + n[2] * k];
}

/** q in [0, 1] percentile (linear interpolation) of the values. NaN for an empty list. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const a = [...values].sort((x, y) => x - y);
  const pos = clamp(q, 0, 1) * (a.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(a.length - 1, lo + 1);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

/** Largest-variance direction of a cloud of deviation vectors (power iteration on the 3x3 covariance). */
export function principalDirection(devs: readonly Vec3[], weights?: readonly number[]): { d: Vec3; var1: number; total: number } | null {
  if (devs.length < 3) return null;
  const w = (i: number): number => (weights ? weights[i] : 1);
  let n = 0;
  for (let i = 0; i < devs.length; i++) n += w(i);
  if (n <= 0) return null;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < devs.length; i++) {
    mx += devs[i][0] * w(i);
    my += devs[i][1] * w(i);
    mz += devs[i][2] * w(i);
  }
  mx /= n;
  my /= n;
  mz /= n;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  let far: Vec3 = [0, 0, 0];
  let farLen = -1;
  for (let i = 0; i < devs.length; i++) {
    const a = devs[i][0] - mx;
    const b = devs[i][1] - my;
    const c = devs[i][2] - mz;
    const k = w(i);
    xx += a * a * k;
    xy += a * b * k;
    xz += a * c * k;
    yy += b * b * k;
    yz += b * c * k;
    zz += c * c * k;
    const l = (a * a + b * b + c * c) * k;
    if (l > farLen) {
      farLen = l;
      far = [a, b, c];
    }
  }
  xx /= n;
  xy /= n;
  xz /= n;
  yy /= n;
  yz /= n;
  zz /= n;
  const total = xx + yy + zz;
  if (total < 1e-10) return null;
  // Start from the farthest sample so we cannot begin orthogonal to the main direction.
  let v = normalize(far);
  for (let i = 0; i < 40; i++) {
    v = normalize([xx * v[0] + xy * v[1] + xz * v[2], xy * v[0] + yy * v[1] + yz * v[2], xz * v[0] + yz * v[1] + zz * v[2]]);
  }
  const var1 = v[0] * (xx * v[0] + xy * v[1] + xz * v[2]) + v[1] * (xy * v[0] + yy * v[1] + yz * v[2]) + v[2] * (xz * v[0] + yz * v[1] + zz * v[2]);
  return { d: v, var1, total };
}

export interface SwingAxis {
  /** Steering axis, unit; the sign is arbitrary (the caller fixes it). */
  n: Vec3;
  /** Mean gravity, unit. */
  gbar: Vec3;
  /** Standard deviation of the motion along the swing, degrees. */
  swingDeg: number;
  /** Variance share of the main direction, 0..1. */
  ratio: number;
}

/** Steering axis n = normalize(gbar x d). `devs` default to the sample deviations from the mean. */
export function axisFromSwings(gs: readonly Vec3[], devs?: readonly Vec3[], weights?: readonly number[]): SwingAxis | null {
  if (gs.length < 3) return null;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < gs.length; i++) {
    const k = weights ? weights[i] : 1;
    sx += gs[i][0] * k;
    sy += gs[i][1] * k;
    sz += gs[i][2] * k;
  }
  const gbar = normalize([sx, sy, sz]);
  if (length(gbar) === 0) return null;
  const p = principalDirection(devs ?? gs, weights);
  if (!p) return null;
  // Only the part of the swing perpendicular to gravity can be a rotation about an axis.
  const n = normalize(cross(gbar, p.d));
  if (length(n) < 0.2) return null;
  return { n, gbar, swingDeg: Math.sqrt(p.var1) * DEG, ratio: p.var1 / p.total };
}

// ---------------------------------------------------------------------------------------------------------------
// Quick start

export type QuickPhase = 'left' | 'right' | 'done' | 'failed';

export const QUICK = {
  /** Excursion that completes a cue, degrees. */
  swingDeg: 10,
  /** Longest a single cue waits, s. */
  cueMax: 2,
  /** Shortest a cue lasts, s. */
  cueMin: 0.35,
  /** Quick start needs the swing's std to be at least this, degrees. */
  minSwingStd: 3,
} as const;

/**
 * "Swing your phone left and right": cue LEFT, then RIGHT. Collects gravity, then derives the axis by PCA, the
 * neutral (mean gravity) and the ranges (90th percentile of |angle| per side). The two cues pick the axis sign.
 */
export class QuickStart {
  phase: QuickPhase = 'left';
  /** 0..1 live meter over both cues. */
  meter = 0;
  result: TiltCalibration | null = null;
  /** Why it failed, for a friendly message. */
  failure = '';

  private samples: { g: Vec3; phase: 'left' | 'right' }[] = [];
  private cueStart = 0;
  private ref: Vec3 | null = null;
  private leftExt: Vec3 | null = null;
  private peak = 0;
  private started = false;

  reset(): void {
    this.phase = 'left';
    this.meter = 0;
    this.result = null;
    this.failure = '';
    this.samples = [];
    this.ref = null;
    this.leftExt = null;
    this.peak = 0;
    this.started = false;
  }

  /** Feed one unit gravity vector with a timestamp in ms. */
  feed(g: Vec3, nowMs: number): void {
    if (this.phase === 'done' || this.phase === 'failed') return;
    if (!this.started) {
      this.started = true;
      this.cueStart = nowMs;
      this.ref = g;
    }
    const ref = this.ref as Vec3;
    const phase = this.phase;
    this.samples.push({ g, phase });
    const elapsed = (nowMs - this.cueStart) / 1000;
    if (phase === 'left') {
      const dev = angleBetween(g, ref);
      if (dev > this.peak) {
        this.peak = dev;
        this.leftExt = g;
      }
      this.meter = Math.max(this.meter, 0.5 * Math.min(1, this.peak / QUICK.swingDeg));
      // Done once the swing went out far enough and is coming back (so the real extreme is in the data), or timed out.
      if ((this.peak >= QUICK.swingDeg && dev <= 0.75 * this.peak && elapsed >= QUICK.cueMin) || elapsed >= QUICK.cueMax) {
        this.phase = 'right';
        this.cueStart = nowMs;
        this.peak = 0;
      }
      return;
    }
    // Right cue: how far past the starting pose, away from the left extreme.
    const ext = this.leftExt ?? ref;
    const dev = angleBetween(g, ext) - angleBetween(ref, ext);
    if (dev > this.peak) this.peak = dev;
    const need = QUICK.swingDeg * 0.8;
    this.meter = Math.max(this.meter, 0.5 + 0.5 * Math.min(1, this.peak / need));
    if ((this.peak >= need && dev <= 0.75 * this.peak && elapsed >= QUICK.cueMin) || elapsed >= QUICK.cueMax) this.finish();
  }

  private fail(why: string): void {
    this.phase = 'failed';
    this.failure = why;
  }

  private finish(): void {
    const gs = this.samples.map((s) => s.g);
    const ax = axisFromSwings(gs);
    if (!ax || ax.swingDeg < QUICK.minSwingStd || ax.ratio < ADAPT.minRatio * 0.8) {
      this.fail('Not enough motion. Swing a little wider, like steering a wheel.');
      return;
    }
    let n = ax.n;
    const g0 = ax.gbar;
    // Sign: the first swing was asked for to the LEFT, so its biggest excursion must come out negative.
    let first = 0;
    for (const s of this.samples) {
      if (s.phase !== 'left') continue;
      const a = signedAngleAbout(s.g, g0, n);
      if (Math.abs(a) > Math.abs(first)) first = a;
    }
    if (Math.abs(first) < 3) {
      this.fail('Could not tell left from right. Swing left first, then right.');
      return;
    }
    if (first > 0) n = scaleVec(n, -1);
    const neg: number[] = [];
    const pos: number[] = [];
    for (const g of gs) {
      const a = signedAngleAbout(g, g0, n);
      if (a <= -3) neg.push(-a);
      else if (a >= 3) pos.push(a);
    }
    if (neg.length < 3 && pos.length < 3) {
      this.fail('Not enough motion. Swing a little wider, like steering a wheel.');
      return;
    }
    const rl = neg.length >= 3 ? percentile(neg, ADAPT.rangePercentile) : NaN;
    const rr = pos.length >= 3 ? percentile(pos, ADAPT.rangePercentile) : NaN;
    const left = clamp(Number.isNaN(rl) ? rr : rl, ADAPT.minRange, ADAPT.maxRange);
    const right = clamp(Number.isNaN(rr) ? rl : rr, ADAPT.minRange, ADAPT.maxRange);
    this.result = { g0, n, left, right };
    this.phase = 'done';
    this.meter = 1;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Adaptation during play

interface Sample {
  t: number;
  g: Vec3;
  dev: Vec3;
  th: number;
}

export class AdaptiveTilt {
  cal: TiltCalibration;
  /** Seconds of play seen so far (the adaptation clock). */
  clock = 0;
  /** True while the neutral is being pulled hard because the player is swinging far from it (posture change). */
  recentring = false;

  private hp: Vec3 | null = null;
  private samples: Sample[] = [];
  private acc = 0;
  private rangeAcc = 0;
  private axisAcc = 0;
  private meanTh = 0;
  private thSmooth: number | null = null;
  private disagree = 0;
  private fastUntil = -1;

  constructor(cal: TiltCalibration) {
    this.cal = { g0: cal.g0, n: cal.n, left: cal.left, right: cal.right };
  }

  /** Steering angle of `g` (degrees, negative = left); adapts the calibration when `inPlay`. */
  update(g: Vec3, dt: number, inPlay: boolean): number {
    const th = tiltAngle(g, this.cal);
    const d = clamp(dt, 0, 0.1);
    // High-pass reference for the axis estimate; kept running outside play so a resume does not jump.
    const k = d > 0 ? 1 - Math.exp(-d / ADAPT.hpTau) : 0;
    this.hp = this.hp ? [this.hp[0] + (g[0] - this.hp[0]) * k, this.hp[1] + (g[1] - this.hp[1]) * k, this.hp[2] + (g[2] - this.hp[2]) * k] : g;
    if (!inPlay || d <= 0) return th;

    this.clock += d;
    this.acc += d;
    if (this.acc >= 1 / ADAPT.sampleHz) {
      this.acc = 0;
      this.samples.push({ t: this.clock, g, dev: sub(g, this.hp), th });
      const cutoff = this.clock - ADAPT.rangeWindow;
      let drop = 0;
      while (drop < this.samples.length && this.samples[drop].t < cutoff) drop++;
      if (drop > 0) this.samples.splice(0, drop);
    }

    // Neutral: follow the recent mean angle (steering angle smoothed over ~1.5 s, so a swing around the centre
    // averages out), but not while that mean sits deep towards a wall: a paddle held at the wall must stay there.
    this.thSmooth = this.thSmooth === null ? th : this.thSmooth + (th - this.thSmooth) * (1 - Math.exp(-d / ADAPT.meanTau));
    const mean = this.thSmooth;
    const range = mean < 0 ? this.cal.left : this.cal.right;
    let delta = 0;
    if (this.clock < this.fastUntil) delta = mean * (1 - Math.exp(-d / ADAPT.fastTau)); // just re-seeded: settle quickly
    else if (Math.abs(mean) <= ADAPT.freezeFrac * range) delta = mean * (1 - Math.exp(-d / ADAPT.neutralTau));
    else if (this.recentring) delta = this.meanTh * (1 - Math.exp(-d / ADAPT.escapeTau));
    if (delta !== 0) this.cal.g0 = normalize(rotateAbout(this.cal.g0, this.cal.n, delta));

    this.rangeAcc += d;
    if (this.rangeAcc >= 0.25) {
      this.updateRanges(this.rangeAcc);
      this.rangeAcc = 0;
    }
    this.axisAcc += d;
    if (this.axisAcc >= 1) {
      this.updateAxis(this.axisAcc);
      this.axisAcc = 0;
    }
    return th;
  }

  private updateRanges(dt: number): void {
    const neg: number[] = [];
    const pos: number[] = [];
    for (const s of this.samples) {
      if (s.th <= -3) neg.push(-s.th);
      else if (s.th >= 3) pos.push(s.th);
    }
    const step = this.clock < this.fastUntil ? 90 : ADAPT.rangeRate * dt;
    if (neg.length >= 25) {
      const target = clamp(percentile(neg, ADAPT.rangePercentile), ADAPT.minRange, ADAPT.maxRange);
      this.cal.left = clamp(this.cal.left + clamp(target - this.cal.left, -step, step), ADAPT.minRange, ADAPT.maxRange);
    }
    if (pos.length >= 25) {
      const target = clamp(percentile(pos, ADAPT.rangePercentile), ADAPT.minRange, ADAPT.maxRange);
      this.cal.right = clamp(this.cal.right + clamp(target - this.cal.right, -step, step), ADAPT.minRange, ADAPT.maxRange);
    }
  }

  private updateAxis(dt: number): void {
    // Posture-change detector: lots of lateral motion around a mean that sits far from the neutral.
    const recent = this.samples.filter((s) => s.t >= this.clock - 6);
    if (recent.length >= 5 * ADAPT.sampleHz) {
      let m = 0;
      for (const s of recent) m += s.th;
      m /= recent.length;
      let v = 0;
      for (const s of recent) v += (s.th - m) * (s.th - m);
      const sd = Math.sqrt(v / recent.length);
      this.meanTh = m;
      this.recentring = sd >= 4 && Math.abs(m) > ADAPT.freezeFrac * (m < 0 ? this.cal.left : this.cal.right);
    } else this.recentring = false;

    const win = this.samples.filter((s) => s.t >= this.clock - ADAPT.axisWindow);
    if (win.length < 5 * ADAPT.sampleHz) return;
    // Recent motion counts most, so after a posture change the old posture fades out quickly.
    const ax = axisFromSwings(
      win.map((s) => s.g),
      win.map((s) => s.dev),
      win.map((s) => Math.exp(-(this.clock - s.t) / ADAPT.axisRecency)),
    );
    if (!ax || ax.swingDeg < ADAPT.minSwingDeg || ax.ratio < ADAPT.minRatio) return;
    let nNew = ax.n;
    if (dot(nNew, this.cal.n) < 0) nNew = scaleVec(nNew, -1);
    const off = angleBetween(nNew, this.cal.n);
    if (off > 85) return;
    // A clearly different axis, seen on several updates in a row, means the posture changed: re-seed from the
    // recent play (like a quick start made of gameplay) instead of crawling there.
    this.disagree = off > ADAPT.reseedDeg ? this.disagree + 1 : 0;
    if (this.disagree >= ADAPT.reseedUpdates) {
      this.reseed(nNew, ax.gbar);
      return;
    }
    const w = 1 - Math.exp(-dt / ADAPT.axisTau);
    const blended = normalize([
      this.cal.n[0] + (nNew[0] - this.cal.n[0]) * w,
      this.cal.n[1] + (nNew[1] - this.cal.n[1]) * w,
      this.cal.n[2] + (nNew[2] - this.cal.n[2]) * w,
    ]);
    if (length(blended) > 0) this.cal.n = blended;
  }

  private reseed(n: Vec3, gbar: Vec3): void {
    this.disagree = 0;
    this.fastUntil = this.clock + ADAPT.fastSettle;
    this.cal.n = n;
    this.cal.g0 = gbar;
    this.thSmooth = null;
    this.meanTh = 0;
    this.recentring = false;
    // Only the last few seconds belong to the new posture; their angles must be recomputed for the new axis.
    this.samples = this.samples.filter((s) => s.t >= this.clock - ADAPT.reseedWindow);
    const neg: number[] = [];
    const pos: number[] = [];
    for (const s of this.samples) {
      s.th = tiltAngle(s.g, this.cal);
      if (s.th <= -3) neg.push(-s.th);
      else if (s.th >= 3) pos.push(s.th);
    }
    const rl = neg.length >= 10 ? percentile(neg, ADAPT.rangePercentile) : NaN;
    const rr = pos.length >= 10 ? percentile(pos, ADAPT.rangePercentile) : NaN;
    // A side without enough samples borrows the other side's range; the usual slow tracking refines both later.
    const both = Number.isNaN(rl) && Number.isNaN(rr);
    if (!both) {
      this.cal.left = clamp(Number.isNaN(rl) ? rr : rl, ADAPT.minRange, ADAPT.maxRange);
      this.cal.right = clamp(Number.isNaN(rr) ? rl : rr, ADAPT.minRange, ADAPT.maxRange);
    }
  }
}
