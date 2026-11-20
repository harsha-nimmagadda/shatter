/** Trauma-based screen shake: offset = trauma^2 * maxOffset, driven by smooth noise (sum of sines). */
export class Shake {
  enabled = true;
  trauma = 0;
  x = 0;
  y = 0;
  private t = 0;

  constructor(
    private readonly maxOffset = 14,
    private readonly decay = 1.4,
  ) {}

  add(amount: number): void {
    if (!this.enabled) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
    if (!this.enabled || this.trauma <= 0) {
      this.trauma = this.enabled ? this.trauma : 0;
      this.x = 0;
      this.y = 0;
      return;
    }
    const k = this.trauma * this.trauma * this.maxOffset;
    const t = this.t;
    this.x = k * 0.5 * (Math.sin(t * 41.3) + Math.sin(t * 23.7 + 1.3));
    this.y = k * 0.5 * (Math.sin(t * 37.1 + 2.1) + Math.sin(t * 19.9 + 4.2));
  }
}
