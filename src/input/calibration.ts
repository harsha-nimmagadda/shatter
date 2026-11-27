import {
  MIN_RANGE_DEG,
  angleBetween,
  computeCalibration,
  steadySuffix,
  type CalibrationError,
  type GSample,
  type TiltCalibration,
  type Vec3,
} from './gravity';

export type CalStep = 'neutral' | 'left' | 'right' | 'done';

export interface CalibratorOptions {
  /** How long the phone must stay steady for a capture, ms. */
  holdMs?: number;
  /** Max wobble (degrees) while holding. */
  steadyTol?: number;
  /** Minimum tilt away from neutral for the left/right captures, degrees. */
  minDeviation?: number;
}

/** Friendly retry text per failure. */
export const CAL_MESSAGES: Record<CalibrationError, string> = {
  tooClose: 'Those two tilts were too close together. Tilt a bit further each way.',
  degenerate: 'That did not work. Let us try the tilts again.',
  neutralOutside: 'Start from the middle: hold it the way you like to play, between the two tilts.',
};

/**
 * The 3-step tilt calibration as a pure state machine. Feed it gravity samples; it waits for the phone to hold
 * steady, captures neutral / full-left / full-right in turn, validates the result and exposes progress for the UI.
 */
export class Calibrator {
  step: CalStep = 'neutral';
  /** Neutral only starts capturing once the player taps READY. */
  armed = false;
  /** 0..1 of the current hold. */
  progress = 0;
  /** Degrees between the live gravity and neutral (0 before neutral exists). */
  deviation = 0;
  /** Friendly message to show (retry or "hold still"); empty when all is well. */
  message = '';
  result: TiltCalibration | null = null;
  g0: Vec3 | null = null;
  gL: Vec3 | null = null;

  private samples: GSample[] = [];
  private since = 0;
  private readonly holdMs: number;
  private readonly tol: number;
  private readonly minDev: number;

  constructor(opts: CalibratorOptions = {}) {
    this.holdMs = opts.holdMs ?? 500;
    this.tol = opts.steadyTol ?? 2.5;
    this.minDev = opts.minDeviation ?? 8;
  }

  /** Player is ready: start capturing neutral. */
  arm(nowMs: number): void {
    if (this.step !== 'neutral') return;
    this.armed = true;
    this.since = nowMs;
    this.samples = [];
    this.progress = 0;
    this.message = '';
  }

  /** Back to the very beginning. */
  reset(): void {
    this.step = 'neutral';
    this.armed = false;
    this.progress = 0;
    this.deviation = 0;
    this.message = '';
    this.result = null;
    this.g0 = null;
    this.gL = null;
    this.samples = [];
  }

  private next(step: CalStep, nowMs: number): void {
    this.step = step;
    this.samples = [];
    this.progress = 0;
    this.since = nowMs;
  }

  /** Feed one (low-passed) unit gravity vector. */
  feed(g: Vec3, nowMs: number): void {
    if (this.step === 'done') return;
    this.deviation = this.g0 ? angleBetween(g, this.g0) : 0;
    if (this.step === 'neutral' && !this.armed) return;
    this.samples.push({ g, t: nowMs });
    // Keep about a second of history.
    while (this.samples.length > 2 && nowMs - this.samples[0].t > 1200) this.samples.shift();

    const steady = steadySuffix(this.samples, this.tol);
    const mean = steady.mean;
    let eligible = true;
    if (this.step === 'left') eligible = !!this.g0 && angleBetween(g, this.g0) >= this.minDev;
    else if (this.step === 'right') eligible = !!this.g0 && !!this.gL && angleBetween(g, this.g0) >= this.minDev && angleBetween(g, this.gL) >= 2 * MIN_RANGE_DEG;
    if (!eligible) {
      this.progress = 0;
      // Moving to the target pose: no nagging yet, just wait. Restart the steady window when they arrive.
      this.samples = this.samples.slice(-1);
      if (this.step === 'right' && this.deviation >= this.minDev && this.gL && angleBetween(g, this.gL) < 2 * MIN_RANGE_DEG) {
        this.message = 'Now tilt the other way.';
      } else if (this.message === 'Hold steady for a moment.') this.message = '';
      return;
    }
    this.progress = Math.min(1, steady.durationMs / this.holdMs);
    if (steady.durationMs >= this.holdMs && steady.count >= 5) {
      this.capture(mean, nowMs);
      return;
    }
    // Eligible but wobbling for a while: say so kindly.
    if (nowMs - this.since > 2500 && steady.durationMs < this.holdMs * 0.4) this.message = 'Hold steady for a moment.';
    else if (steady.durationMs > 250) this.message = '';
  }

  private capture(mean: Vec3, nowMs: number): void {
    this.message = '';
    if (this.step === 'neutral') {
      this.g0 = mean;
      this.next('left', nowMs);
    } else if (this.step === 'left') {
      this.gL = mean;
      this.next('right', nowMs);
    } else if (this.step === 'right' && this.g0 && this.gL) {
      const r = computeCalibration(this.g0, this.gL, mean);
      if (r.ok) {
        this.result = r.cal;
        this.next('done', nowMs);
        this.progress = 1;
      } else {
        this.message = CAL_MESSAGES[r.error];
        this.gL = null;
        if (r.error === 'neutralOutside') {
          this.g0 = null;
          this.armed = false;
          this.next('neutral', nowMs);
        } else this.next('left', nowMs);
      }
    }
  }
}
