import { createRng } from '../engine/rng';

/**
 * shard: spinning glass triangle (normal blend, gravity). spark: streak along its velocity (additive).
 * dot: little square sparkle (additive). ring: expanding shockwave circle (additive).
 */
export type ParticleKind = 'shard' | 'spark' | 'dot' | 'ring';
const KIND: Record<ParticleKind, number> = { shard: 0, spark: 1, dot: 2, ring: 3 };

export interface EmitOpts {
  color?: string;
  /** Initial speed, units/s (rings: growth speed). */
  speed?: number;
  /** Direction in radians (default: all directions). */
  angle?: number;
  /** Half-angle spread around `angle`. */
  spread?: number;
  size?: number;
  life?: number;
  gravity?: number;
}

const DEFAULTS: Record<ParticleKind, { color: string; speed: number; size: number; life: number; gravity: number }> = {
  shard: { color: '#00E5FF', speed: 280, size: 5, life: 0.8, gravity: 900 },
  spark: { color: '#FFFFFF', speed: 380, size: 10, life: 0.35, gravity: 300 },
  dot: { color: '#FFE53B', speed: 160, size: 2.4, life: 0.6, gravity: 120 },
  ring: { color: '#00E5FF', speed: 260, size: 4, life: 0.35, gravity: 0 },
};

/** Fixed-size particle pool (structure of arrays); emit/update/draw never allocate. */
export class Particles {
  /** 0..1 multiplier on emitted counts (reduced effects). */
  density = 1;
  private readonly kind: Uint8Array;
  private readonly alive: Uint8Array;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly rot: Float32Array;
  private readonly vr: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private readonly color: string[];
  private cursor = 0;
  private count = 0;
  private readonly rng = createRng(0x5eed);

  constructor(readonly cap = 400) {
    this.kind = new Uint8Array(cap);
    this.alive = new Uint8Array(cap);
    const f = (): Float32Array => new Float32Array(cap);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.rot = f();
    this.vr = f();
    this.age = f();
    this.life = f();
    this.size = f();
    this.grav = f();
    this.color = new Array<string>(cap).fill('');
  }

  get active(): number {
    return this.count;
  }

  clear(): void {
    this.alive.fill(0);
    this.count = 0;
  }

  private slot(): number {
    for (let n = 0; n < this.cap; n++) {
      const i = (this.cursor + n) % this.cap;
      if (!this.alive[i]) {
        this.cursor = (i + 1) % this.cap;
        return i;
      }
    }
    // Pool full: recycle the slot at the cursor (oldest-ish).
    const i = this.cursor;
    this.cursor = (i + 1) % this.cap;
    this.count--;
    return i;
  }

  emit(kind: ParticleKind, x: number, y: number, count: number, opts: EmitOpts = {}): void {
    const d = DEFAULTS[kind];
    const r = this.rng;
    const n0 = kind === 'ring' ? count : Math.max(count > 0 ? 1 : 0, Math.round(count * this.density));
    for (let n = 0; n < n0; n++) {
      const i = this.slot();
      const a = opts.angle === undefined ? r.range(0, Math.PI * 2) : opts.angle + r.range(-1, 1) * (opts.spread ?? 0.6);
      const sp = (opts.speed ?? d.speed) * (kind === 'ring' ? 1 : r.range(0.4, 1));
      this.alive[i] = 1;
      this.count++;
      this.kind[i] = KIND[kind];
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = kind === 'ring' ? sp : Math.cos(a) * sp;
      this.vy[i] = kind === 'ring' ? 0 : Math.sin(a) * sp;
      this.rot[i] = r.range(0, Math.PI * 2);
      this.vr[i] = r.range(-12, 12);
      this.age[i] = 0;
      this.life[i] = (opts.life ?? d.life) * (kind === 'ring' ? 1 : r.range(0.7, 1.2));
      this.size[i] = (opts.size ?? d.size) * (kind === 'ring' ? 1 : r.range(0.7, 1.3));
      this.grav[i] = opts.gravity ?? d.gravity;
      this.color[i] = opts.color ?? d.color;
    }
  }

  update(dt: number): void {
    const drag = 1 - Math.min(1, 2.4 * dt);
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.alive[i] = 0;
        this.count--;
        continue;
      }
      if (this.kind[i] === 3) {
        this.size[i] += this.vx[i] * dt;
        continue;
      }
      this.vy[i] += this.grav[i] * dt;
      this.vx[i] *= drag;
      this.vy[i] *= drag;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vr[i] * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.count === 0) return;
    // Pass 1: shards (normal blend).
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i] || this.kind[i] !== 0) continue;
      const f = this.age[i] / this.life[i];
      ctx.globalAlpha = Math.min(1, (1 - f) * 2);
      const s = this.size[i];
      const c = Math.cos(this.rot[i]) * s;
      const sn = Math.sin(this.rot[i]) * s;
      const px = this.x[i];
      const py = this.y[i];
      ctx.fillStyle = this.color[i];
      ctx.beginPath();
      ctx.moveTo(px + c, py + sn);
      ctx.lineTo(px - sn * 0.8 - c * 0.5, py + c * 0.8 - sn * 0.5);
      ctx.lineTo(px + sn * 0.6 - c * 0.7, py - c * 0.6 - sn * 0.7);
      ctx.closePath();
      ctx.fill();
    }
    // Pass 2: additive light.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      const k = this.kind[i];
      if (k === 0) continue;
      const f = this.age[i] / this.life[i];
      const px = this.x[i];
      const py = this.y[i];
      const s = this.size[i];
      if (k === 1) {
        const v = Math.hypot(this.vx[i], this.vy[i]) || 1;
        const len = s * (1 - f) * Math.min(1, v / 200);
        ctx.globalAlpha = 1 - f;
        ctx.strokeStyle = this.color[i];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - (this.vx[i] / v) * len, py - (this.vy[i] / v) * len);
        ctx.stroke();
      } else if (k === 2) {
        ctx.globalAlpha = Math.min(1, (1 - f) * 1.5) * (0.6 + 0.4 * Math.sin(this.rot[i] * 3));
        ctx.fillStyle = this.color[i];
        const q = s * (1 - f * 0.5);
        ctx.fillRect(px - q / 2, py - q / 2, q, q);
      } else {
        ctx.globalAlpha = (1 - f) * 0.9;
        ctx.strokeStyle = this.color[i];
        ctx.lineWidth = 3 * (1 - f) + 0.5;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.1, s), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
