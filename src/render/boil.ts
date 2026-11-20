export const VARIANTS = 3;
export const BOIL_HZ = 10;

/** Which of the 3 variants to show: cycles at ~10 Hz, de-synchronised per seed. */
export function boilFrame(time: number, seed: number): number {
  return (Math.floor(time * BOIL_HZ) + ((seed >>> 0) % VARIANTS)) % VARIANTS;
}

/** Draws one variant; ctx is scaled so logical (0,0)..(w,h) is the sprite's content box. */
export type SpriteRender = (ctx: CanvasRenderingContext2D, variant: number) => void;

export class Sprite {
  private readonly canvases: HTMLCanvasElement[] = [];

  constructor(
    readonly tag: number | string,
    readonly w: number,
    readonly h: number,
    readonly pad: number,
    scale: number,
    render: SpriteRender,
  ) {
    const pw = Math.max(1, Math.ceil((w + 2 * pad) * scale));
    const ph = Math.max(1, Math.ceil((h + 2 * pad) * scale));
    for (let v = 0; v < VARIANTS; v++) {
      const c = document.createElement('canvas');
      c.width = pw;
      c.height = ph;
      const g = c.getContext('2d');
      if (g) {
        // Map the padded canvas exactly onto (w + 2 pad) logical units.
        g.setTransform(pw / (w + 2 * pad), 0, 0, ph / (h + 2 * pad), (pad * pw) / (w + 2 * pad), (pad * ph) / (h + 2 * pad));
        render(g, v);
      }
      this.canvases.push(c);
    }
  }

  /** (x, y) is the top-left of the content box in logical units. */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number, s = 1): void {
    const c = this.canvases[boilFrame(time, seed)];
    ctx.drawImage(c, x - this.pad * s, y - this.pad * s, (this.w + 2 * this.pad) * s, (this.h + 2 * this.pad) * s);
  }
}

/** Capped sprite cache. Everything is rebuilt when the pixel scale changes. */
export class BoilCache {
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

  /** The sprite for key if its tag still matches (e.g. a brick's hp), else undefined. */
  get(key: number | string, tag: number | string): Sprite | undefined {
    const s = this.map.get(key);
    return s && s.tag === tag ? s : undefined;
  }

  build(key: number | string, tag: number | string, w: number, h: number, pad: number, render: SpriteRender): Sprite {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    const s = new Sprite(tag, w, h, pad, this.scale, render);
    this.map.set(key, s);
    return s;
  }

  delete(key: number | string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
