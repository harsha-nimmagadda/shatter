/** Logical playfield size; all game code draws in these units. */
export const LOGICAL_W = 540;
export const LOGICAL_H = 960;

const MARGIN_COLOR = '#05010F';
const MAX_DPR = 2;

export interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Uniform scale and centering offsets (in CSS px) that fit the playfield into a CSS box. */
export function fitPlayfield(cssW: number, cssH: number): Fit {
  const scale = Math.min(cssW / LOGICAL_W, cssH / LOGICAL_H);
  return {
    scale,
    offsetX: (cssW - LOGICAL_W * scale) / 2,
    offsetY: (cssH - LOGICAL_H * scale) / 2,
  };
}

/** Owns the canvas size and maps the letterboxed logical playfield onto it. */
export class View {
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private dprCap = MAX_DPR;
  private ver = 0;
  private fit: Fit = { scale: 1, offsetX: 0, offsetY: 0 };
  private readonly onResize = (): void => this.resize();

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    this.resize();
  }

  resize(): void {
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.fit = fitPlayfield(this.cssW, this.cssH);
    this.ver++;
  }

  /** Caps the canvas device-pixel ratio (adaptive quality); resizes only when the cap actually changes it. */
  setDprCap(cap: number): void {
    if (cap === this.dprCap) return;
    this.dprCap = cap;
    this.resize();
  }

  /** Bumps on every resize; lets callers cache work derived from the transform. */
  get version(): number {
    return this.ver;
  }

  /** Canvas CSS size and the playfield's offset inside it. */
  get cssWidth(): number {
    return this.cssW;
  }
  get cssHeight(): number {
    return this.cssH;
  }
  get offsetX(): number {
    return this.fit.offsetX;
  }
  get offsetY(): number {
    return this.fit.offsetY;
  }

  /** CSS pixels per logical unit. */
  get cssScale(): number {
    return this.fit.scale;
  }

  /** Device pixels per logical unit (dpr * fit scale). */
  get pixelScale(): number {
    return this.dpr * this.fit.scale;
  }

  /** Clears the whole canvas to the margin colour and sets the logical-coordinate transform. */
  begin(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Only the letterbox bars: the playfield itself is fully covered by the background blit.
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const x0 = Math.max(0, Math.ceil(this.dpr * this.fit.offsetX));
    const y0 = Math.max(0, Math.ceil(this.dpr * this.fit.offsetY));
    const x1 = Math.min(cw, Math.floor(this.dpr * (this.fit.offsetX + LOGICAL_W * this.fit.scale)));
    const y1 = Math.min(ch, Math.floor(this.dpr * (this.fit.offsetY + LOGICAL_H * this.fit.scale)));
    ctx.fillStyle = MARGIN_COLOR;
    if (y0 > 0) ctx.fillRect(0, 0, cw, y0);
    if (y1 < ch) ctx.fillRect(0, y1, cw, ch - y1);
    if (x0 > 0) ctx.fillRect(0, y0, x0, y1 - y0);
    if (x1 < cw) ctx.fillRect(x1, y0, cw - x1, y1 - y0);
    const k = this.dpr * this.fit.scale;
    ctx.setTransform(k, 0, 0, k, this.dpr * this.fit.offsetX, this.dpr * this.fit.offsetY);
  }

  /** Converts a client (pointer) position into logical playfield coordinates. */
  toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.fit.offsetX) / this.fit.scale,
      y: (clientY - rect.top - this.fit.offsetY) / this.fit.scale,
    };
  }
}
