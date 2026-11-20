/** Logical playfield size; all game code draws in these units. */
export const LOGICAL_W = 540;
export const LOGICAL_H = 960;

const MARGIN_COLOR = '#f6f1e3';
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
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.fit = fitPlayfield(this.cssW, this.cssH);
  }

  /** Device pixels per logical unit (dpr * fit scale). */
  get pixelScale(): number {
    return this.dpr * this.fit.scale;
  }

  /** Clears the whole canvas to the margin colour and sets the logical-coordinate transform. */
  begin(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MARGIN_COLOR;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
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
