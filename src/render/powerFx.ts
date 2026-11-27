import { CONFIG } from '../engine';
import { FLOAT_LIFE, floatTextState } from './powerVisuals';
import { C, font } from './palette';

const W = CONFIG.width;
const H = CONFIG.height;
const MAX_FLOATS = 8;
const MAX_WOBBLES = 6;
const MAX_FLYERS = 4;
const MAX_BLASTS = 4;
const MAX_ERASERS = 3;
const MAX_POPS = 12;
const STAR_PTS = 12;
export const BLAST_LIFE = 0.42;
export const ERASER_LIFE = 0.35;
export const POP_LIFE = 0.3;
const SPEED_LIFE = 0.5;
export const WOBBLE_LIFE = 0.4;
const FLYER_LIFE = 0.7;

/** Live-drawn, short-lived effects held in small fixed pools (nothing allocates after construction). */
export class PowerFx {
  private readonly fText: string[] = new Array<string>(MAX_FLOATS).fill('');
  private readonly fColor: string[] = new Array<string>(MAX_FLOATS).fill('');
  private readonly fSize = new Float32Array(MAX_FLOATS);
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

  private readonly wId = new Int32Array(MAX_WOBBLES);
  private readonly wAge = new Float32Array(MAX_WOBBLES).fill(-1);
  private wCursor = 0;
  private wCount = 0;

  private readonly flX = new Float32Array(MAX_FLYERS);
  private readonly flY = new Float32Array(MAX_FLYERS);
  private readonly flVx = new Float32Array(MAX_FLYERS);
  private readonly flVy = new Float32Array(MAX_FLYERS);
  private readonly flW = new Float32Array(MAX_FLYERS);
  private readonly flH = new Float32Array(MAX_FLYERS);
  private readonly flRot = new Float32Array(MAX_FLYERS);
  private readonly flAge = new Float32Array(MAX_FLYERS).fill(-1);
  private flCursor = 0;

  private speedT = 0;
  private speedDir = 1;
  private seed = 12345;

  clear(): void {
    this.fAge.fill(-1);
    this.bAge.fill(-1);
    this.eAge.fill(-1);
    this.popAge.fill(-1);
    this.wAge.fill(-1);
    this.flAge.fill(-1);
    this.wCount = 0;
    this.popCount = 0;
    this.speedT = 0;
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  addFloat(text: string, x: number, y: number, color: string, size = 26): void {
    const i = this.fCursor;
    this.fCursor = (i + 1) % MAX_FLOATS;
    this.fText[i] = text;
    this.fColor[i] = color;
    this.fSize[i] = size;
    this.fx[i] = Math.max(text.length * size * 0.36, Math.min(W - text.length * size * 0.36, x));
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

  /** A loose clip rattling in place. */
  addWobble(brickId: number): void {
    const i = this.wCursor;
    this.wCursor = (i + 1) % MAX_WOBBLES;
    this.wId[i] = brickId;
    this.wAge[i] = 0;
  }

  /** Rotation offset (radians) of a rattling clip, 0 when none is running. */
  wobbleOf(id: number): number {
    if (this.wCount === 0) return 0;
    for (let i = 0; i < MAX_WOBBLES; i++) {
      if (this.wAge[i] >= 0 && this.wId[i] === id) return Math.sin(this.wAge[i] * 70) * 0.1 * (1 - this.wAge[i] / WOBBLE_LIFE);
    }
    return 0;
  }

  /** A popped clip flying off the playfield with a spin. */
  addFlyer(x: number, y: number, w: number, h: number, dir: number): void {
    const i = this.flCursor;
    this.flCursor = (i + 1) % MAX_FLYERS;
    this.flX[i] = x;
    this.flY[i] = y;
    this.flVx[i] = dir * (140 + this.rnd() * 120);
    this.flVy[i] = -380 - this.rnd() * 120;
    this.flW[i] = w;
    this.flH[i] = h;
    this.flRot[i] = 0;
    this.flAge[i] = 0;
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
    let wc = 0;
    for (let i = 0; i < MAX_WOBBLES; i++) {
      if (this.wAge[i] < 0) continue;
      this.wAge[i] = this.wAge[i] + dt >= WOBBLE_LIFE ? -1 : this.wAge[i] + dt;
      if (this.wAge[i] >= 0) wc++;
    }
    this.wCount = wc;
    for (let i = 0; i < MAX_FLYERS; i++) {
      if (this.flAge[i] < 0) continue;
      this.flAge[i] = this.flAge[i] + dt >= FLYER_LIFE ? -1 : this.flAge[i] + dt;
      this.flVy[i] += 1500 * dt;
      this.flX[i] += this.flVx[i] * dt;
      this.flY[i] += this.flVy[i] * dt;
      this.flRot[i] += (this.flVx[i] > 0 ? 9 : -9) * dt;
    }
    this.speedT = Math.max(0, this.speedT - dt);
  }

  /** Popped armour plates spinning off the playfield. */
  drawFlyers(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < MAX_FLYERS; i++) {
      const a = this.flAge[i];
      if (a < 0) continue;
      const w = this.flW[i];
      const h = this.flH[i];
      ctx.save();
      ctx.translate(this.flX[i], this.flY[i]);
      ctx.rotate(this.flRot[i]);
      ctx.globalAlpha = Math.min(1, (1 - a / FLYER_LIFE) * 2);
      ctx.fillStyle = '#8F9AB0';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#E8EEFF';
      ctx.fillRect(-w / 2, -h / 2, w, h * 0.3);
      ctx.strokeStyle = '#2A3040';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** WIPE: a bright scan beam sweeping across the cleared row; onSpark gets the beam position. */
  drawErasers(ctx: CanvasRenderingContext2D, onSpark: (x: number, y: number) => void): void {
    for (let i = 0; i < MAX_ERASERS; i++) {
      const a = this.eAge[i];
      if (a < 0) continue;
      const t = a / ERASER_LIFE;
      const x = -20 + (W + 40) * t;
      const y = this.ey[i];
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, (1 - t) * 3);
      ctx.fillStyle = C.cyan;
      ctx.globalAlpha *= 0.25;
      ctx.fillRect(0, y - 15, x, 30);
      ctx.globalAlpha = Math.min(1, (1 - t) * 3);
      ctx.fillStyle = C.white;
      ctx.fillRect(x - 3, y - 26, 6, 52);
      ctx.fillStyle = C.cyan;
      ctx.fillRect(x - 9, y - 22, 18, 44);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      onSpark(x, y);
    }
  }

  /** Explosion: hot core flash plus a double shockwave ellipse the size of the blast area. */
  drawBlasts(ctx: CanvasRenderingContext2D): void {
    const rx = CONFIG.explosionRx;
    const ry = CONFIG.explosionRy;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < MAX_BLASTS; i++) {
      const a = this.bAge[i];
      if (a < 0) continue;
      const t = a / BLAST_LIFE;
      const grow = 1 - (1 - Math.min(1, t * 1.6)) ** 3;
      const cx = this.bx[i];
      const cy = this.by[i];
      // Core.
      if (t < 0.45) {
        const k = 1 - t / 0.45;
        ctx.globalAlpha = k * 0.85;
        ctx.fillStyle = C.yellow;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * 0.55 * (0.6 + grow * 0.4), ry * 0.55 * (0.6 + grow * 0.4), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = k;
        ctx.fillStyle = C.white;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * 0.25, ry * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Shockwaves.
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = C.orange;
      ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * grow * 1.1, ry * grow * 1.1, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 3 * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * grow * 0.8, ry * grow * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** Floating labels (power names, combo, +1): pop in big, settle, rise and fade. */
  drawFloats(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < MAX_FLOATS; i++) {
      const a = this.fAge[i];
      if (a < 0) continue;
      const st = floatTextState(a);
      const pop = a < 0.12 ? 1.5 - (a / 0.12) * 0.5 : 1;
      const px = Math.round(this.fSize[i] * pop);
      const y = this.fy[i] - 14 - st.rise;
      ctx.font = font(px);
      ctx.globalAlpha = st.alpha * 0.55;
      ctx.lineWidth = 7;
      ctx.strokeStyle = this.fColor[i];
      ctx.strokeText(this.fText[i], this.fx[i], y);
      ctx.globalAlpha = st.alpha;
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.ink;
      ctx.strokeText(this.fText[i], this.fx[i], y);
      ctx.fillStyle = C.white;
      ctx.fillText(this.fText[i], this.fx[i], y);
    }
    ctx.globalAlpha = 1;
  }

  /** Overdrive / slow-mo: speed streaks over the playfield. */
  drawSpeed(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.speedT <= 0) return;
    const f = this.speedT / SPEED_LIFE;
    const up = this.speedDir > 0;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = up ? C.red : C.cyan;
    ctx.lineWidth = up ? 2 : 3;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.35 * Math.min(1, f * 2);
    ctx.beginPath();
    const len = up ? 110 : 30;
    const spd = up ? 1800 : 220;
    for (let i = 0; i < 14; i++) {
      const x = ((i * 0.618034 + 0.07) % 1) * (W - 40) + 20;
      const y = (((time * spd + i * 211) % (H + len)) + H + len) % (H + len) - len;
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
