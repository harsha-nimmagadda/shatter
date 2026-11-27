/**
 * Anti-jitter for tilt steering: a One Euro filter (Casiez et al. 2012) plus a rest gate with hysteresis.
 *
 * The One Euro filter is a first-order low-pass whose cutoff rises with the (filtered) speed of the signal: slow
 * drift and hand tremor are smoothed heavily, a fast deliberate tilt passes through almost unchanged.
 */

export interface OneEuroParams {
  /** Cutoff at rest, Hz. Lower = steadier. */
  minCutoff: number;
  /** Cutoff increase per unit of speed (Hz per deg/s). Higher = snappier on fast tilts. */
  beta: number;
  /** Cutoff of the speed estimate, Hz. */
  dCutoff: number;
}

/** Steadiness presets for the settings slider (0 = Low, 1 = Medium, 2 = High smoothing). */
export const STEADINESS: readonly OneEuroParams[] = [
  { minCutoff: 1.2, beta: 0.03, dCutoff: 1 },
  { minCutoff: 0.6, beta: 0.02, dCutoff: 1 },
  { minCutoff: 0.3, beta: 0.012, dCutoff: 1 },
];
export const STEADINESS_LABELS = ['Low', 'Medium', 'High'] as const;
export const DEFAULT_STEADINESS = 1;

export function steadinessParams(level: number): OneEuroParams {
  const i = Number.isFinite(level) ? Math.max(0, Math.min(STEADINESS.length - 1, Math.round(level))) : DEFAULT_STEADINESS;
  return STEADINESS[i];
}

const alphaFor = (cutoffHz: number, dt: number): number => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  private x: number | null = null;
  private dx = 0;

  constructor(public params: OneEuroParams) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  /** Filters one sample taken `dt` seconds after the previous one. */
  filter(value: number, dt: number): number {
    if (this.x === null || !(dt > 0)) {
      if (this.x === null) this.x = value;
      return this.x;
    }
    const p = this.params;
    const rawDx = (value - this.x) / dt;
    this.dx += alphaFor(p.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = p.minCutoff + p.beta * Math.abs(this.dx);
    this.x += alphaFor(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** Degrees of tilt the player has to move away from neutral before the paddle starts to follow. */
export const REST_ENTER_DEG = 1.3;
/** Back inside this many degrees the paddle snaps back to rest (equals the dead zone in tiltAxis). */
export const REST_EXIT_DEG = 1;

/**
 * Rest gate with hysteresis: a hand that is trying to hold still stays inside REST_ENTER_DEG and the paddle does
 * not move at all; once the player really tilts, steering follows until they come back inside REST_EXIT_DEG.
 */
export class RestGate {
  private active = false;

  reset(): void {
    this.active = false;
  }

  /** Returns the angle to steer with (0 while resting). */
  apply(angle: number): number {
    const mag = Math.abs(angle);
    if (this.active) {
      if (mag <= REST_EXIT_DEG) this.active = false;
    } else if (mag > REST_ENTER_DEG) this.active = true;
    return this.active ? angle : 0;
  }
}
