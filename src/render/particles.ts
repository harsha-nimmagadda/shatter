import { createRng } from '../engine/rng';

export type ParticleKind = 'shred' | 'speck' | 'crumb' | 'tick';
const KIND: Record<ParticleKind, number> = { shred: 0, speck: 1, crumb: 2, tick: 3 };

export interface EmitOpts {
  color?: string;
  /** Initial speed, units/s. */
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
  shred: { color: '#e26f6f', speed: 260, size: 6, life: 0.9, gravity: 700 },
  speck: { color: '#4a4a4f', speed: 160, size: 1.8, life: 0.5, gravity: 250 },
  crumb: { color: '#e9a3a0', speed: 120, size: 2.6, life: 0.7, gravity: 600 },
  tick: { color: '#2b2b2b', speed: 150, size: 9, life: 0.28, gravity: 0 },
};

/** Fixed-size particle pool (structure of arrays); emit/update/draw never allocate. */
export class Particles {
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
  private readonly jit: Float32Array;
  private readonly color: string[];
  private cursor = 0;
  private count = 0;
  private readonly rng = createRng(0x5eed);

  constructor(readonly cap = 400) {
    this.kind = new Uint8Array(cap);
    this.alive = new Uint8Array(cap);
    const f = (n = 1): Float32Array => new Float32Array(cap * n);
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
    this.jit = f(8);
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
    for (let n = 0; n < count; n++) {
      const i = this.slot();
      const a = opts.angle === undefined ? r.range(0, Math.PI * 2) : opts.angle + r.range(-1, 1) * (opts.spread ?? 0.6);
      const sp = (opts.speed ?? d.speed) * r.range(0.4, 1);
      this.alive[i] = 1;
      this.count++;
      this.kind[i] = KIND[kind];
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = Math.cos(a) * sp;
      this.vy[i] = Math.sin(a) * sp;
      this.rot[i] = kind === 'tick' ? a : r.range(0, Math.PI * 2);
      this.vr[i] = kind === 'tick' ? 0 : r.range(-9, 9);
      this.age[i] = 0;
      this.life[i] = (opts.life ?? d.life) * r.range(0.7, 1.2);
      this.size[i] = (opts.size ?? d.size) * r.range(0.7, 1.3);
      this.grav[i] = opts.gravity ?? d.gravity;
      this.color[i] = opts.color ?? d.color;
      for (let j = 0; j < 8; j++) this.jit[i * 8 + j] = r.range(-0.35, 0.35);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.alive[i] = 0;
        this.count--;
        continue;
      }
      this.vy[i] += this.grav[i] * dt;
      const drag = 1 - Math.min(1, 2.2 * dt);
      this.vx[i] *= drag;
      this.vy[i] *= this.kind[i] === 0 ? drag : 1;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vr[i] * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = 'round';
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      const f = this.age[i] / this.life[i];
      ctx.globalAlpha = Math.min(1, (1 - f) * 1.6) * 0.92;
      const s = this.size[i];
      const px = this.x[i];
      const py = this.y[i];
      const k = this.kind[i];
      if (k === 0) {
        const c = Math.cos(this.rot[i]);
        const sn = Math.sin(this.rot[i]);
        const j = i * 8;
        ctx.fillStyle = this.color[i];
        ctx.beginPath();
        for (let q = 0; q < 4; q++) {
          const lx = (q === 0 || q === 3 ? -1 : 1) * s * (1 + this.jit[j + q * 2]);
          const ly = (q < 2 ? -1 : 1) * s * 0.7 * (1 + this.jit[j + q * 2 + 1]);
          const qx = px + lx * c - ly * sn;
          const qy = py + lx * sn + ly * c;
          if (q === 0) ctx.moveTo(qx, qy);
          else ctx.lineTo(qx, qy);
        }
        ctx.closePath();
        ctx.fill();
      } else if (k === 3) {
        const c = Math.cos(this.rot[i]) * s * (1 - f * 0.5);
        const sn = Math.sin(this.rot[i]) * s * (1 - f * 0.5);
        ctx.strokeStyle = this.color[i];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + c, py + sn);
        ctx.stroke();
      } else {
        ctx.fillStyle = this.color[i];
        ctx.beginPath();
        ctx.arc(px, py, s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
