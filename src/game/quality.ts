/** Graphics quality: 0 = High, 1 = Medium (fewer particles/flashes, still background), 2 = Low (Medium + DPR cap). */
export type QualityLevel = 0 | 1 | 2;
export type GraphicsSetting = 'auto' | 'high' | 'low';

export const QUALITY_NAMES = ['High', 'Medium', 'Low'] as const;
/** Canvas device-pixel-ratio cap per level. */
export const QUALITY_DPR: readonly number[] = [2, 2, 1.25];

const CHUNK = 0.5; // seconds per fps sample
const DOWN_CHUNKS = 4; // 2 s below DOWN_FPS
const UP_CHUNKS = 20; // 10 s above UP_FPS
const DOWN_FPS = 50;
const UP_FPS = 58;
/** Gaps longer than this are pauses / hidden tabs, not slow frames. */
const MAX_GAP = 0.25;

/**
 * Adaptive quality: feed it every frame timestamp (seconds). Drops one level after ~2 s under 50 fps and
 * climbs one level after ~10 s over 58 fps. A change in the opposite direction of the last one needs 10 s
 * of quiet, so it cannot flap.
 */
export class QualityGovernor {
  /** Current automatic level. */
  level: QualityLevel = 0;
  private last = -1;
  private acc = 0;
  private n = 0;
  private readonly hist = new Float32Array(UP_CHUNKS);
  private hn = 0;
  private lastChange = -1e9;
  private lastDir = 0;
  private start = -1;

  /** `warmup` seconds after the first frame are ignored (page load, sprite baking). */
  constructor(private readonly warmup = 3) {}

  /** Returns true when `level` changed. */
  frame(t: number): boolean {
    const dt = t - this.last;
    this.last = t;
    if (this.start < 0) this.start = t;
    if (dt > 1e6 || dt <= 0) return false;
    if (t - this.start < this.warmup) {
      this.acc = 0;
      this.n = 0;
      return false;
    }
    if (dt > MAX_GAP) {
      this.acc = 0;
      this.n = 0;
      this.hn = 0;
      return false;
    }
    this.acc += dt;
    this.n++;
    if (this.acc < CHUNK) return false;
    const fps = this.n / this.acc;
    this.acc = 0;
    this.n = 0;
    // History as a shifting window of the most recent chunk fps values.
    if (this.hn < UP_CHUNKS) this.hist[this.hn++] = fps;
    else {
      this.hist.copyWithin(0, 1);
      this.hist[UP_CHUNKS - 1] = fps;
    }
    return this.evaluate(t);
  }

  private evaluate(t: number): boolean {
    if (this.hn >= DOWN_CHUNKS && this.level < 2) {
      let slow = true;
      for (let i = this.hn - DOWN_CHUNKS; i < this.hn; i++) if (this.hist[i] >= DOWN_FPS) slow = false;
      if (slow && (this.lastDir <= 0 || t - this.lastChange >= 10)) return this.change(t, 1);
    }
    if (this.hn >= UP_CHUNKS && this.level > 0) {
      let fast = true;
      for (let i = 0; i < UP_CHUNKS; i++) if (this.hist[i] <= UP_FPS) fast = false;
      if (fast && t - this.lastChange >= 10) return this.change(t, -1);
    }
    return false;
  }

  private change(t: number, dir: 1 | -1): boolean {
    this.level = (this.level + dir) as QualityLevel;
    this.lastChange = t;
    this.lastDir = dir;
    this.hn = 0;
    return true;
  }
}

/** The level actually applied for a setting. */
export function effectiveQuality(setting: GraphicsSetting, auto: QualityLevel): QualityLevel {
  return setting === 'high' ? 0 : setting === 'low' ? 2 : auto;
}
