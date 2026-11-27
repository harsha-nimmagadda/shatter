/** Resume countdown: a big 3-2-1 (0.6 s per number) before play continues after the pause menu closes. */

export const COUNT_FROM = 3;
export const COUNT_STEP = 0.6;

/** Pure: only a ball in play needs the countdown; a serve (ball still on the paddle) and finished games resume at once. */
export function needsCountdown(status: 'serve' | 'playing' | 'won' | 'gameover'): boolean {
  return status === 'playing';
}

export interface CountUpdate {
  /** The shown number changed (also true on the first update after start()). */
  changed: boolean;
  /** The countdown just ended: play resumes now. */
  finished: boolean;
}

export class Countdown {
  private t = -1;
  private shown = 0;

  get active(): boolean {
    return this.t >= 0;
  }

  /** 3, 2, 1 while running, else 0. */
  get value(): number {
    return this.t < 0 ? 0 : Math.max(1, COUNT_FROM - Math.floor(this.t / COUNT_STEP));
  }

  /** Seconds into the current number, 0..COUNT_STEP (for the pop animation). */
  get phase(): number {
    return this.t < 0 ? 0 : this.t % COUNT_STEP;
  }

  start(): void {
    this.t = 0;
    this.shown = 0;
  }

  cancel(): void {
    this.t = -1;
    this.shown = 0;
  }

  update(dt: number): CountUpdate {
    if (this.t < 0) return { changed: false, finished: false };
    this.t += Math.max(0, dt);
    if (this.t >= COUNT_FROM * COUNT_STEP) {
      this.cancel();
      return { changed: false, finished: true };
    }
    const v = this.value;
    const changed = v !== this.shown;
    this.shown = v;
    return { changed, finished: false };
  }
}
