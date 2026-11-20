import { saveSettings, type ControlSettings } from './settings';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Degrees of tilt from neutral that put the paddle at the wall. Sensitivity 1..10 -> 40..10. */
export function tiltRangeDeg(sensitivity: number): number {
  const s = clamp(sensitivity, 1, 10);
  return 40 - ((s - 1) * 30) / 9;
}

export const TILT_DEAD_ZONE_DEG = 1;

/** Maps a tilt angle to a paddle centre x, clamped so the paddle stays inside the playfield. */
export function tiltToPaddleX(
  angle: number,
  neutral: number,
  sensitivity: number,
  invert: boolean,
  playfieldW: number,
  paddleW: number,
): number {
  let d = angle - neutral;
  if (invert) d = -d;
  d = Math.abs(d) <= TILT_DEAD_ZONE_DEG ? 0 : d;
  const range = tiltRangeDeg(sensitivity);
  const half = (playfieldW - paddleW) / 2;
  const x = playfieldW / 2 + (d / range) * half;
  return clamp(x, paddleW / 2, playfieldW - paddleW / 2);
}

/** Exponential low-pass, frame-rate independent. */
export function smooth(prev: number, target: number, dt: number, timeConstant = 0.05): number {
  if (dt <= 0) return prev;
  const k = 1 - Math.exp(-dt / timeConstant);
  return prev + (target - prev) * k;
}

/** Left-right tilt for the current screen orientation (degrees). */
export function screenTiltAngle(e: { beta: number; gamma: number }, screenAngle: number): number {
  const a = ((Math.round(screenAngle) % 360) + 360) % 360;
  switch (a) {
    case 90:
      return e.beta;
    case 180:
      return -e.gamma;
    case 270:
      return -e.beta;
    default:
      return e.gamma;
  }
}

export type TiltResult = 'granted' | 'denied' | 'unsupported';

type OrientationCtor = {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

function currentScreenAngle(): number {
  if (typeof screen !== 'undefined' && screen.orientation) return screen.orientation.angle;
  const w = window as unknown as { orientation?: number };
  return typeof w.orientation === 'number' ? w.orientation : 0;
}

export class TiltInput {
  private angle: number | null = null;
  private smoothed: number | null = null;
  private listening = false;
  private readonly onEvent = (e: DeviceOrientationEvent): void => {
    if (e.gamma === null || e.gamma === undefined) return;
    this.angle = screenTiltAngle({ beta: e.beta ?? 0, gamma: e.gamma }, currentScreenAngle());
  };

  constructor(private readonly settings: ControlSettings) {}

  get active(): boolean {
    return this.listening;
  }

  /**
   * Starts listening. On iOS, DeviceOrientationEvent.requestPermission() only works when called
   * from a user gesture (click/tap handler), so call enable() directly from one.
   */
  async enable(): Promise<TiltResult> {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
    const ctor = DeviceOrientationEvent as unknown as OrientationCtor;
    if (typeof ctor.requestPermission === 'function') {
      try {
        if ((await ctor.requestPermission()) !== 'granted') return 'denied';
      } catch {
        return 'denied';
      }
    }
    if (!this.listening) {
      window.addEventListener('deviceorientation', this.onEvent);
      this.listening = true;
    }
    this.angle = null;
    this.smoothed = null;
    const ok = await new Promise<boolean>((resolve) => {
      const start = performance.now();
      const tick = (): void => {
        if (this.angle !== null) resolve(true);
        else if (performance.now() - start >= 1000) resolve(false);
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

  /** Stores the current angle as neutral and saves settings. */
  calibrate(): void {
    if (this.angle === null) return;
    this.settings.tiltNeutral = this.angle;
    this.smoothed = null;
    saveSettings(this.settings);
  }

  /** Smoothed paddle target, or null if no reading has arrived yet. */
  paddleX(dt: number, settings: ControlSettings, playfieldW: number, paddleW: number): number | null {
    if (this.angle === null) return null;
    const target = tiltToPaddleX(
      this.angle,
      settings.tiltNeutral,
      settings.tiltSensitivity,
      settings.invertTilt,
      playfieldW,
      paddleW,
    );
    this.smoothed = this.smoothed === null ? target : smooth(this.smoothed, target, dt);
    return this.smoothed;
  }

  disable(): void {
    window.removeEventListener('deviceorientation', this.onEvent);
    this.listening = false;
    this.angle = null;
    this.smoothed = null;
  }
}
