/** Fixed simulation step in seconds (120 Hz). */
export const STEP = 1 / 120;
const MAX_FRAME = 0.25;

/** Fixed-timestep rAF loop: update(STEP) zero or more times, then render(alpha) once per frame. */
export class Loop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private readonly onVisibility = (): void => {
    if (!this.running) return;
    if (document.visibilityState === 'hidden') {
      this.cancel();
    } else if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.acc = 0;
    document.addEventListener('visibilitychange', this.onVisibility);
    if (document.visibilityState !== 'hidden') {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  stop(): void {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.cancel();
  }

  private cancel(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly frame = (now: number): void => {
    let elapsed = (now - this.last) / 1000;
    this.last = now;
    elapsed = Math.min(Math.max(elapsed, 0), MAX_FRAME);

    // Schedule first so one thrown frame can never stop the loop.
    this.raf = requestAnimationFrame(this.frame);
    this.acc += elapsed;
    while (this.acc >= STEP) {
      this.update(STEP);
      this.acc -= STEP;
    }
    this.render(this.acc / STEP);
  };
}
