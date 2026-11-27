import {
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
  /** How long the phone must stay steady for the neutral capture (or for a held left/right), ms. */
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
 * The 3-step tilt calibration as a pure state machine. Feed it gravity samples. Neutral needs a short, roughly
 * steady hold (0.4 s, a few degrees of wobble allowed). Left and right do NOT need a hold: the player swings out
 * and back, and the extreme reached (the peak) is captured as soon as the phone starts coming back. Holding a pose
 * steadily still works too. The result is validated and progress is exposed for the UI.
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
  /** Left/right: the most extreme pose of the current swing and how far from neutral it is (degrees). */
  private peak: Vec3 | null = null;
  private peakScore = 0;
  private readonly holdMs: number;
  private readonly tol: number;
  private readonly minDev: number;

  constructor(opts: CalibratorOptions = {}) {
    this.holdMs = opts.holdMs ?? 400;
    this.tol = opts.steadyTol ?? 4;
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
    this.peak = null;
    this.peakScore = 0;
  }

  private next(step: CalStep, nowMs: number): void {
    this.step = step;
    this.samples = [];
    this.progress = 0;
    this.since = nowMs;
    this.peak = null;
    this.peakScore = 0;
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
    // How far out the phone is on the side being asked for (left: any side away from neutral; right: past neutral,
    // away from the left capture).
    let score = 0;
    let eligible = true;
    if (this.step === 'left' || this.step === 'right') {
      const g0 = this.g0;
      if (!g0) return;
      score = angleBetween(g, g0);
      if (this.step === 'right' && this.gL) score = Math.min(score, angleBetween(g, this.gL) - angleBetween(g0, this.gL));
      eligible = score >= this.minDev;
    }
    if (this.peak && this.peakScore >= this.minDev) {
      // Left / right: the swing reached a peak. Capture it once the phone turns back.
      if (angleBetween(g, this.peak) >= Math.max(3.5, 0.3 * this.peakScore)) {
        this.capture(this.peak, nowMs);
        return;
      }
    }
    if (!eligible) {
      // Between poses: no nagging, just wait. Restart the steady window when they arrive.
      this.samples = this.samples.slice(-1);
      this.progress = this.step === 'neutral' ? 0 : Math.min(0.9, Math.max(0, score) / this.minDev) * 0.5;
      if (this.step === 'right' && this.deviation >= this.minDev && this.gL) {
        this.message = 'Now tilt the other way.';
      } else if (nowMs - this.since > 4000) this.message = 'Swing out, then come back a little.';
      return;
    }
    if (this.step === 'neutral') {
      this.progress = Math.min(1, steady.durationMs / this.holdMs);
      if (steady.durationMs >= this.holdMs && steady.count >= 5) {
        this.capture(mean, nowMs);
        return;
      }
      // Wobbling for a while: say so kindly.
      if (nowMs - this.since > 2500 && steady.durationMs < this.holdMs * 0.4) this.message = 'Hold steady for a moment.';
      else if (steady.durationMs > 250) this.message = '';
      return;
    }
    // Left / right: remember the peak (captured above once the phone turns back) or capture a steady hold.
    if (!this.peak || score > this.peakScore) {
      this.peak = g;
      this.peakScore = score;
    }
    this.progress = Math.min(1, 0.5 + 0.5 * Math.min(1, this.peakScore / (this.minDev * 1.6)));
    if (steady.durationMs >= this.holdMs && steady.count >= 5) {
      this.capture(mean, nowMs);
      return;
    }
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
