import { CONFIG } from '../engine';
import { FLOAT_LIFE, floatTextState } from './powerVisuals';
import type { Sprite } from './boil';
import type { Skin } from './skin';

const W = CONFIG.width;
const H = CONFIG.height;
const MAX_FLOATS = 6;
const MAX_BLASTS = 4;
const MAX_ERASERS = 3;
const MAX_POPS = 12;
const STAR_PTS = 12;
export const BLAST_LIFE = 0.42;
export const ERASER_LIFE = 0.35;
export const POP_LIFE = 0.3;
const SPEED_LIFE = 0.5;

/** Live-drawn, short-lived effects held in small fixed pools (nothing allocates after construction). */
export class PowerFx {
  private readonly fText: string[] = new Array<string>(MAX_FLOATS).fill('');
  private readonly fColor: string[] = new Array<string>(MAX_FLOATS).fill('');
  private readonly fx = new Float32Array(MAX_FLOATS);
  private readonly fy = new Float32Array(MAX_FLOATS);
  private readonly fAge = new Float32Array(MAX_FLOATS).fill(-1);
  private fCursor = 0;

  private readonly bx = new Float32Array(MAX_BLASTS);
  private readonly by = new Float32Array(MAX_BLASTS);
  private readonly bAge = new Float32Array(MAX_BLASTS).fill(-1);
  private readonly bRad = new Float32Array(MAX_BLASTS * STAR_PTS);
  private bCursor = 0;

  private readonly ey = new Float32Array(MAX_ERASERS);
  private readonly eAge = new Float32Array(MAX_ERASERS).fill(-1);
  private eCursor = 0;

  private readonly popId = new Int32Array(MAX_POPS);
  private readonly popAge = new Float32Array(MAX_POPS).fill(-1);
  private pCursor = 0;
  private popCount = 0;

  private speedT = 0;
  private speedDir = 1;
  private seed = 12345;

  clear(): void {
    this.fAge.fill(-1);
    this.bAge.fill(-1);
    this.eAge.fill(-1);
    this.popAge.fill(-1);
    this.popCount = 0;
    this.speedT = 0;
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  addFloat(text: string, x: number, y: number, color: string): void {
    const i = this.fCursor;
    this.fCursor = (i + 1) % MAX_FLOATS;
    this.fText[i] = text;
    this.fColor[i] = color;
    this.fx[i] = Math.max(60, Math.min(W - 60, x));
    this.fy[i] = y;
    this.fAge[i] = 0;
  }

  addBlast(x: number, y: number): void {
    const i = this.bCursor;
    this.bCursor = (i + 1) % MAX_BLASTS;
    this.bx[i] = x;
    this.by[i] = y;
    this.bAge[i] = 0;
    for (let k = 0; k < STAR_PTS; k++) this.bRad[i * STAR_PTS + k] = 0.75 + this.rnd() * 0.45;
  }

  addEraser(y: number): void {
    const i = this.eCursor;
    this.eCursor = (i + 1) % MAX_ERASERS;
    this.ey[i] = y;
    this.eAge[i] = 0;
  }

  addPop(brickId: number): void {
    const i = this.pCursor;
    this.pCursor = (i + 1) % MAX_POPS;
    this.popId[i] = brickId;
    this.popAge[i] = 0;
  }

  addSpeed(dir: 1 | -1): void {
    this.speedT = SPEED_LIFE;
    this.speedDir = dir;
  }

  /** Age of the pop for this brick id, or -1 when none is running. */
  popAgeOf(id: number): number {
    if (this.popCount === 0) return -1;
    for (let i = 0; i < MAX_POPS; i++) if (this.popAge[i] >= 0 && this.popId[i] === id) return this.popAge[i];
    return -1;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_FLOATS; i++) if (this.fAge[i] >= 0) this.fAge[i] = this.fAge[i] + dt >= FLOAT_LIFE ? -1 : this.fAge[i] + dt;
    for (let i = 0; i < MAX_BLASTS; i++) if (this.bAge[i] >= 0) this.bAge[i] = this.bAge[i] + dt >= BLAST_LIFE ? -1 : this.bAge[i] + dt;
    for (let i = 0; i < MAX_ERASERS; i++) if (this.eAge[i] >= 0) this.eAge[i] = this.eAge[i] + dt >= ERASER_LIFE ? -1 : this.eAge[i] + dt;
    let pops = 0;
    for (let i = 0; i < MAX_POPS; i++) {
      if (this.popAge[i] < 0) continue;
      this.popAge[i] = this.popAge[i] + dt >= POP_LIFE ? -1 : this.popAge[i] + dt;
      if (this.popAge[i] >= 0) pops++;
    }
    this.popCount = pops;
    this.speedT = Math.max(0, this.speedT - dt);
  }

  /** Draws active eraser sweeps; onCrumb is called with the eraser's leading edge so crumbs can be emitted. */
  drawErasers(ctx: CanvasRenderingContext2D, sprite: Sprite, w: number, h: number, time: number, onCrumb: (x: number, y: number) => void): void {
    for (let i = 0; i < MAX_ERASERS; i++) {
      const a = this.eAge[i];
      if (a < 0) continue;
      const t = a / ERASER_LIFE;
      const x = -w + (W + w * 2) * t;
      ctx.globalAlpha = Math.min(1, (1 - t) * 4);
      sprite.draw(ctx, x - w / 2, this.ey[i] - h / 2, time, i + 3);
      ctx.globalAlpha = 1;
      onCrumb(x + w * 0.2, this.ey[i] + h * 0.35);
    }
  }

  drawBlasts(ctx: CanvasRenderingContext2D, skin: Skin): void {
    const rx = CONFIG.explosionRx;
    const ry = CONFIG.explosionRy;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < MAX_BLASTS; i++) {
      const a = this.bAge[i];
      if (a < 0) continue;
      const t = a / BLAST_LIFE;
      const grow = 0.45 + 0.55 * (1 - (1 - Math.min(1, t * 2.5)) ** 2);
      const alpha = Math.min(1, (1 - t) * 1.8);
      const cx = this.bx[i];
      const cy = this.by[i];
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        const rot = pass * 0.26 + t * 0.4;
        const sc = pass === 0 ? 1 : 0.82;
        for (let k = 0; k < STAR_PTS; k++) {
          const ang = (k / STAR_PTS) * Math.PI * 2 + rot;
          const rr = (k % 2 === 0 ? 1 : 0.5) * this.bRad[i * STAR_PTS + k] * grow * sc;
          const px = cx + Math.cos(ang) * rx * rr * 0.9;
          const py = cy + Math.sin(ang) * ry * rr * 0.9;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        if (pass === 0) {
          ctx.globalAlpha = alpha * 0.55;
          ctx.fillStyle = '#ffd23f';
          ctx.fill();
        }
        ctx.globalAlpha = alpha * (pass === 0 ? 0.95 : 0.6);
        ctx.strokeStyle = pass === 0 ? '#e8431f' : skin.ink;
        ctx.lineWidth = pass === 0 ? 2.6 : 1.4;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawFloats(ctx: CanvasRenderingContext2D, skin: Skin): void {
    ctx.font = `26px ${skin.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = skin.paper;
    for (let i = 0; i < MAX_FLOATS; i++) {
      const a = this.fAge[i];
      if (a < 0) continue;
      const st = floatTextState(a);
      const y = this.fy[i] - 14 - st.rise;
      ctx.globalAlpha = st.alpha;
      ctx.strokeText(this.fText[i], this.fx[i], y);
      ctx.fillStyle = this.fColor[i];
      ctx.fillText(this.fText[i], this.fx[i], y);
    }
    ctx.globalAlpha = 1;
  }

  drawSpeed(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.speedT <= 0) return;
    const f = this.speedT / SPEED_LIFE;
    const up = this.speedDir > 0;
    ctx.strokeStyle = up ? '#2b2b2b' : '#5b8fd0';
    ctx.lineWidth = up ? 1.6 : 2;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.2 * Math.min(1, f * 2);
    ctx.beginPath();
    const len = up ? 90 : 26;
    const spd = up ? 1500 : 260;
    for (let i = 0; i < 12; i++) {
      const x = ((i * 0.618034 + 0.07) % 1) * (W - 40) + 20;
      const y = (((time * spd + i * 211) % (H + len)) + H + len) % (H + len) - len;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (up ? 0 : Math.sin(i + time * 6) * 4), y + len);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
