import { AdaptiveTilt } from './adaptive';
import { OneEuro, RestGate, steadinessParams } from './filter';
import {
  axisToPaddleX,
  defaultCalibration,
  dot,
  gravityFromOrientation,
  length,
  lowPassVec,
  normalize,
  rangeScale,
  tiltAngle,
  tiltAxis,
  type TiltCalibration,
  type Vec3,
} from './gravity';
import { saveSettings, type ControlSettings } from './settings';

export { tiltRangeDeg } from './gravity';

/** Exponential low-pass, frame-rate independent. */
export function smooth(prev: number, target: number, dt: number, timeConstant = 0.05): number {
  if (dt <= 0) return prev;
  const k = 1 - Math.exp(-dt / timeConstant);
  return prev + (target - prev) * k;
}

export type TiltResult = 'granted' | 'denied' | 'unsupported';

type PermissionCtor = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Current screen rotation (0/90/180/270). screen.orientation first, legacy window.orientation, then the aspect. */
export function currentScreenAngle(): number {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  const w = window as unknown as { orientation?: number };
  if (typeof w.orientation === 'number') return w.orientation;
  return window.innerWidth > window.innerHeight ? 90 : 0;
}

const isApple = (): boolean =>
  typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Steady paddle target from the phone's gravity vector; see gravity.ts for the maths. */
export class TiltInput {
  /** Called when the screen rotates while a saved calibration exists (the saved axis may no longer fit). */
  onOrientationChange: (() => void) | null = null;
  /** Adaptive mode needs a quick start (first use, or the screen rotated): the UI should run the swing overlay. */
  onQuickStartNeeded: (() => void) | null = null;

  private g: Vec3 | null = null;
  private gAt = 0;
  private motionAt = -1e9;
  private orientAt = -1e9;
  private orientUp: Vec3 | null = null;
  /** +1 when devicemotion uses the Android convention (flat face-up = +z), -1 when inverted (older iOS). */
  private sign = isApple() ? -1 : 1;
  /** Latest unfiltered unit gravity vector (steering filters the angle instead, see filter.ts). */
  private raw: Vec3 | null = null;
  /** Lightly (30 ms) smoothed gravity for the wizard and quick start, which look at peaks. */
  private gq: Vec3 | null = null;
  private readonly eur = new OneEuro(steadinessParams(1));
  private readonly gate = new RestGate();
  private adaptive: AdaptiveTilt | null = null;
  private adaptiveStale = false;
  private quickAsked = false;
  private inPlay = false;
  private listening = false;
  /** Automatic calibration (no saved one): neutral captured at serve start. */
  private auto: TiltCalibration | null = null;
  private armed = true;
  private orientTimer = 0;
  private lastAngle = 0;

  private readonly onMotion = (e: DeviceMotionEvent): void => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null || a.x === undefined || a.y === undefined || a.z === undefined) return;
    const raw: Vec3 = [a.x, a.y, a.z];
    if (length(raw) < 1) return; // free fall or garbage
    const u = normalize(raw);
    const now = performance.now();
    // Learn the platform's sign convention from deviceorientation when both are flowing.
    if (this.orientUp && now - this.orientAt < 500) {
      const d = dot(u, this.orientUp);
      if (Math.abs(d) > 0.6) this.sign = d > 0 ? 1 : -1;
    }
    this.motionAt = now;
    this.feed([u[0] * this.sign, u[1] * this.sign, u[2] * this.sign], now);
  };

  private readonly onOrientation = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null || e.beta === undefined || e.gamma === undefined) return;
    const now = performance.now();
    this.orientUp = gravityFromOrientation(e.beta, e.gamma);
    this.orientAt = now;
    // Fallback source: only when devicemotion is not delivering.
    if (now - this.motionAt > 300) this.feed(this.orientUp, now);
  };

  private readonly onRotate = (): void => {
    window.clearTimeout(this.orientTimer);
    // Let the rotation animation and the sensor settle first.
    this.orientTimer = window.setTimeout(() => {
      if (!this.listening) return;
      if (this.settings.tiltMode === 'adaptive') this.adaptiveStale = true; // re-run the quick start at the next serve
      else if (this.settings.tiltMode === 'calibrated') this.onOrientationChange?.();
      else this.armNeutral();
    }, 450);
  };

  constructor(private readonly settings: ControlSettings) {}

  get active(): boolean {
    return this.listening;
  }

  private feed(u: Vec3, now: number): void {
    const dt = this.g ? Math.min(0.1, (now - this.gAt) / 1000) : 0;
    this.g = lowPassVec(this.g, u, dt);
    this.gq = lowPassVec(this.gq, u, dt, 0.03);
    this.raw = u;
    this.gAt = now;
  }

  /** Latest low-passed unit gravity vector in device coordinates, or null before the first reading. */
  gravity(): Vec3 | null {
    return this.g ? normalize(this.g) : null;
  }

  /** Light-weight gravity (30 ms low-pass) for peak detection; null before the first reading. */
  gravityFast(): Vec3 | null {
    return this.gq ? normalize(this.gq) : null;
  }

  /**
   * Starts listening. On iOS both DeviceMotionEvent and DeviceOrientationEvent have requestPermission(), and each
   * must be called from a user gesture, so call enable() directly from a tap handler (before any await).
   */
  async enable(): Promise<TiltResult> {
    if (typeof window === 'undefined') return 'unsupported';
    const motion = typeof DeviceMotionEvent !== 'undefined' ? (DeviceMotionEvent as unknown as PermissionCtor) : null;
    const orient = typeof DeviceOrientationEvent !== 'undefined' ? (DeviceOrientationEvent as unknown as PermissionCtor) : null;
    if (!motion && !orient) return 'unsupported';
    // Both requests are fired synchronously from the gesture; iOS shows one shared prompt.
    const asks: Promise<string>[] = [];
    for (const c of [motion, orient]) {
      if (c && typeof c.requestPermission === 'function') {
        try {
          asks.push(c.requestPermission().catch(() => 'denied'));
        } catch {
          asks.push(Promise.resolve('denied'));
        }
      }
    }
    if (asks.length > 0) {
      const results = await Promise.all(asks);
      if (!results.includes('granted')) return 'denied';
    }
    if (!this.listening) {
      window.addEventListener('devicemotion', this.onMotion);
      window.addEventListener('deviceorientation', this.onOrientation);
      window.addEventListener('orientationchange', this.onRotate);
      screen.orientation?.addEventListener?.('change', this.onRotate);
      this.listening = true;
    }
    this.g = null;
    this.gq = null;
    this.raw = null;
    this.resetFilter();
    this.auto = null;
    this.armed = true;
    const ok = await new Promise<boolean>((resolve) => {
      const start = performance.now();
      const tick = (): void => {
        if (this.g !== null) resolve(true);
        else if (performance.now() - start >= 1200) resolve(false);
        else setTimeout(tick, 50);
      };
      tick();
    });
    if (!ok) {
      this.disable();
      return 'unsupported';
    }
    return 'granted';
  }

  private resetFilter(): void {
    this.eur.reset();
    this.gate.reset();
  }

  /** Re-capture the automatic neutral on the next reading (level start, screen rotation). No-op in other modes. */
  armNeutral(): void {
    this.armed = true;
    this.resetFilter();
  }

  /** Stores (or clears, with null) the saved 3-point calibration; a calibration switches to calibrated mode. */
  setCalibration(cal: TiltCalibration | null): void {
    this.settings.tiltCal = cal;
    if (cal) this.settings.tiltMode = 'calibrated';
    else if (this.settings.tiltMode === 'calibrated') this.settings.tiltMode = 'auto';
    this.resetFilter();
    saveSettings(this.settings);
  }

  /** The ball is in play: the adaptive mode only learns during play. */
  setInPlay(on: boolean): void {
    this.inPlay = on;
  }

  /** Adaptive mode has no usable calibration yet (never started this session, or the screen rotated). */
  needsQuickStart(): boolean {
    return this.settings.tiltMode === 'adaptive' && (this.adaptive === null || this.adaptiveStale);
  }

  /** Call every step with whether the game is at a serve: asks the UI for the quick start once when it is needed. */
  pollServe(atServe: boolean): void {
    if (!atServe || !this.listening || !this.raw || this.quickAsked || !this.needsQuickStart()) return;
    this.quickAsked = true;
    this.onQuickStartNeeded?.();
  }

  /** Result of the quick start: the learned calibration, or null to fall back to the screen axes (still adapting). */
  startAdaptive(cal: TiltCalibration | null): void {
    this.quickAsked = false;
    this.adaptiveStale = false;
    const base = cal ?? (this.gravity() ? defaultCalibration(this.gravity() as Vec3, currentScreenAngle()) : null);
    this.adaptive = base ? new AdaptiveTilt(base) : null;
    this.resetFilter();
  }

  /** Forget the adaptive state (mode switched away, or tilt disabled). */
  clearAdaptive(): void {
    this.adaptive = null;
    this.adaptiveStale = false;
    this.quickAsked = false;
  }

  /** The calibration in use right now (saved, else automatic), or null before the first reading. */
  private current(): TiltCalibration | null {
    if (this.settings.tiltMode === 'calibrated' && this.settings.tiltCal) return this.settings.tiltCal;
    const g = this.gravity();
    if (!g) return null;
    if (this.armed || !this.auto) {
      this.auto = defaultCalibration(g, currentScreenAngle());
      this.armed = false;
    }
    return this.auto;
  }

  /** Filtered paddle target, or null if no reading (or, in adaptive mode, no quick start) has arrived yet. */
  paddleX(dt: number, settings: ControlSettings, playfieldW: number, paddleW: number): number | null {
    const raw = this.raw;
    if (!raw) return null;
    let cal: TiltCalibration | null;
    let angle: number;
    if (settings.tiltMode === 'adaptive') {
      if (!this.adaptive) return null;
      angle = this.adaptive.update(raw, dt, this.inPlay);
      cal = this.adaptive.cal;
    } else {
      cal = this.current();
      if (!cal) return null;
      angle = tiltAngle(raw, cal);
    }
    this.eur.params = steadinessParams(settings.tiltSteadiness);
    this.lastAngle = this.eur.filter(angle, Math.min(dt, 0.05));
    const axis = tiltAxis(this.gate.apply(this.lastAngle), cal, rangeScale(settings.tiltSensitivity), settings.invertTilt);
    return axisToPaddleX(axis, playfieldW, paddleW);
  }

  /** The adaptive calibration as learned so far (debug / UI), or null. */
  adaptiveCal(): TiltCalibration | null {
    return this.adaptive ? { ...this.adaptive.cal } : null;
  }

  /** Last steering angle in degrees (debug / UI). */
  angle(): number {
    return this.lastAngle;
  }

  disable(): void {
    window.removeEventListener('devicemotion', this.onMotion);
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.removeEventListener('orientationchange', this.onRotate);
    screen.orientation?.removeEventListener?.('change', this.onRotate);
    window.clearTimeout(this.orientTimer);
    this.listening = false;
    this.g = null;
    this.gq = null;
    this.raw = null;
    this.resetFilter();
    this.auto = null;
    this.armed = true;
    this.clearAdaptive();
  }
}
