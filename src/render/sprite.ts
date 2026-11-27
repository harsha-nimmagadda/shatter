/** Renders into a sprite canvas. ctx is scaled so (0,0)..(w,h) is the content box; `px` = device px per unit. */
export type SpriteRender = (ctx: CanvasRenderingContext2D, px: number) => void;

/** One pre-rendered offscreen canvas (glows and gradients are baked in, so drawing is a single drawImage). */
export class Sprite {
  readonly canvas: HTMLCanvasElement;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly pad: number,
    scale: number,
    render: SpriteRender,
  ) {
    const pw = Math.max(1, Math.ceil((w + 2 * pad) * scale));
    const ph = Math.max(1, Math.ceil((h + 2 * pad) * scale));
    const c = document.createElement('canvas');
    c.width = pw;
    c.height = ph;
    const g = c.getContext('2d');
    if (g) {
      const sx = pw / (w + 2 * pad);
      const sy = ph / (h + 2 * pad);
      g.setTransform(sx, 0, 0, sy, pad * sx, pad * sy);
      render(g, sx);
    }
    this.canvas = c;
  }

  /** (x, y) is the top-left of the content box in logical units; `s` scales around that corner. */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, s = 1): void {
    const p = this.pad * s;
    ctx.drawImage(this.canvas, x - p, y - p, (this.w + 2 * this.pad) * s, (this.h + 2 * this.pad) * s);
  }

  /** Draws centred on (cx, cy) with scale s. */
  drawCentered(ctx: CanvasRenderingContext2D, cx: number, cy: number, s = 1): void {
    this.draw(ctx, cx - (this.w * s) / 2, cy - (this.h * s) / 2, s);
  }
}

/** Capped sprite cache keyed by number or string. Everything is rebuilt when the pixel scale changes. */
export class SpriteCache {
  private readonly map = new Map<number | string, Sprite>();
  private scale = 0;

  constructor(private readonly maxEntries = 512) {}

  get pixelScale(): number {
    return this.scale;
  }

  /** Returns true if the scale changed (and the cache was emptied). */
  setScale(scale: number): boolean {
    if (Math.abs(scale - this.scale) < 1e-6) return false;
    this.scale = scale;
    this.map.clear();
    return true;
  }

  get(key: number | string): Sprite | undefined {
    return this.map.get(key);
  }

  build(key: number | string, w: number, h: number, pad: number, render: SpriteRender): Sprite {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    const s = new Sprite(w, h, pad, Math.max(0.25, this.scale), render);
    this.map.set(key, s);
    return s;
  }

  /** get() or build() in one call. */
  use(key: number | string, w: number, h: number, pad: number, render: SpriteRender): Sprite {
    return this.map.get(key) ?? this.build(key, w, h, pad, render);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
