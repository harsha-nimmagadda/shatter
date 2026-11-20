/** Voice limiter: per-id minimum spacing and a global voice cap. Clock is injected for tests. */
export class PlayLimiter {
  private last = new Map<string, number>();
  private ends: number[] = [];

  constructor(
    private now: () => number,
    private minGapMs = 35,
    private maxVoices = 12,
  ) {}

  /** Returns true (and records the voice) when the sound may start; durationMs is how long it will sound. */
  tryStart(id: string, durationMs: number): boolean {
    const t = this.now();
    this.ends = this.ends.filter((e) => e > t);
    const prev = this.last.get(id);
    if (prev !== undefined && t - prev < this.minGapMs) return false;
    if (this.ends.length >= this.maxVoices) return false;
    this.last.set(id, t);
    this.ends.push(t + durationMs);
    return true;
  }

  get voices(): number {
    const t = this.now();
    return this.ends.filter((e) => e > t).length;
  }
}
