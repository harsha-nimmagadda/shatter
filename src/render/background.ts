import { CONFIG } from '../engine/config';
import { createRng } from '../engine/rng';
import { coverRect, pickIndex, placeMarginDoodles, type Rect } from './artLayout';
import { sourceSize } from './assets';
import { BoilCache, type Sprite } from './boil';
import { roughCirclePoints, strokePath, strokeSegs, wobblyLinePoints, type Seg } from './sketch';
import type { Skin } from './skin';

const W = CONFIG.width;
const H = CONFIG.height;

/** Static paper page, drawn once into an offscreen canvas per pixel scale. */
export class Background {
  private canvas: HTMLCanvasElement | null = null;
  private scale = 0;

  private seed = 1;
  private grid: Rect | null = null;

  constructor(private readonly skin: Skin) {}

  /** Level-specific inputs (paper variant, doodle placement). Invalidates the cached page. */
  setLayout(seed: number, grid: Rect | null): void {
    this.seed = seed;
    this.grid = grid;
    this.canvas = null;
  }

  /** 3-5 seeded margin doodles with multiply + reduced alpha; returns false if there are no margin images. */
  private drawMarginArt(g: CanvasRenderingContext2D): boolean {
    const imgs: CanvasImageSource[] = [];
    const byId = this.skin.assets?.byId ?? {};
    for (const id of Object.keys(byId).sort()) if (id.startsWith('margin-')) imgs.push(...byId[id]);
    if (!imgs.length) return false;
    const forbidden: Rect[] = [
      { x: 0, y: 0, w: W, h: CONFIG.topWall + 8 }, // HUD band
      { x: 52, y: 0, w: 18, h: H }, // red margin lines
      { x: 0, y: CONFIG.paddleY - 60, w: W, h: H - CONFIG.paddleY + 60 }, // paddle zone
      ...[180, 480, 780].map((hy) => ({ x: 8, y: hy - 16, w: 32, h: 32 })), // punched holes
      { x: 370, y: 705, w: 100, h: 110 }, // coffee ring
    ];
    if (this.grid) {
      const m = 10;
      forbidden.push({ x: this.grid.x - m, y: this.grid.y - m, w: this.grid.w + 2 * m, h: this.grid.h + 2 * m });
    }
    const count = 3 + (pickIndex(this.seed, 3) % 3);
    const doodles = placeMarginDoodles({ seed: this.seed, count, imageCount: imgs.length, width: W, height: H, forbidden, leftStrip: [4, 50] });
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = 0.7;
    for (const d of doodles) {
      const img = imgs[d.image];
      const sz = sourceSize(img);
      const k = d.size / Math.max(1, sz.w, sz.h);
      const dw = sz.w * k;
      const dh = sz.h * k;
      g.save();
      g.translate(d.x, d.y);
      g.rotate(d.rot);
      g.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      g.restore();
    }
    g.restore();
    return true;
  }

  private build(scale: number): void {
    const s = this.skin;
    const c = document.createElement('canvas');
    c.width = Math.ceil(W * scale);
    c.height = Math.ceil(H * scale);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
    const rng = createRng(0xb00c);

    g.fillStyle = s.paper;
    g.fillRect(0, 0, W, H);
    const papers = s.assets?.get('paper') ?? [];
    const tex = papers.length ? papers[pickIndex(this.seed, papers.length)] : s.textures?.paper;
    if (tex) {
      // Paper art is drawn on white: multiply keeps the cream paper colour and adds only the grain.
      const sz = sourceSize(tex);
      const c = coverRect(sz.w, sz.h, W, H);
      g.save();
      g.globalCompositeOperation = 'multiply';
      g.globalAlpha = 0.45; // full strength reads as dirty tan paper; keep just the grain
      if (c.w > 0) g.drawImage(tex, c.x, c.y, c.w, c.h, 0, 0, W, H);
      else g.drawImage(tex, 0, 0, W, H);
      g.restore();
    } else {
      // Faint grain.
      for (let i = 0; i < 1400; i++) {
        g.globalAlpha = rng.range(0.03, 0.09);
        g.fillStyle = rng.next() < 0.5 ? '#8a7a55' : '#ffffff';
        g.fillRect(rng.range(0, W), rng.range(0, H), rng.range(0.6, 1.8), rng.range(0.6, 1.4));
      }
      g.globalAlpha = 1;
    }

    // Ruled lines.
    for (let y = 32; y < H; y += 32) {
      strokePath(g, wobblyLinePoints(-4, y, W + 4, y, rng, { jitter: 0.002, maxJitter: 1.4, overshoot: 0, segLen: 60 }), rng, s.rule, 1.3, 1);
    }
    // Double red margin.
    for (const mx of [58, 64]) {
      strokePath(g, wobblyLinePoints(mx, -6, mx + 1, H + 6, rng, { jitter: 0.002, maxJitter: 1.6, overshoot: 0, segLen: 80 }), rng, s.margin, 1.5, 1);
    }
    // Punched holes.
    for (const hy of [180, 480, 780]) {
      g.fillStyle = 'rgba(120,105,80,0.18)';
      g.beginPath();
      g.arc(24, hy, 9, 0, Math.PI * 2);
      g.fill();
      strokePath(g, roughCirclePoints(24, hy, 9, rng, 0.04), rng, 'rgba(100,90,70,0.5)', 1.2);
    }
    // Coffee ring.
    const ring = roughCirclePoints(420, 760, 46, rng, 0.03);
    strokePath(g, ring, rng, 'rgba(150,100,50,0.12)', 6);
    strokePath(g, roughCirclePoints(421, 761, 44, rng, 0.04), rng, 'rgba(150,100,50,0.1)', 2);
    if (!this.drawMarginArt(g)) {
      // Tiny margin doodles: a star and a little flower.
      const star: Seg[] = [];
      for (let i = 0; i < 5; i++) {
        const a1 = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
        const a2 = -Math.PI / 2 + ((i + 1) * 4 * Math.PI) / 5;
        star.push({ x1: 28 + Math.cos(a1) * 8, y1: 330 + Math.sin(a1) * 8, x2: 28 + Math.cos(a2) * 8, y2: 330 + Math.sin(a2) * 8 });
      }
      strokeSegs(g, star, rng, 'rgba(60,70,120,0.55)', 1.1);
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        strokePath(g, roughCirclePoints(30 + Math.cos(a) * 5, 640 + Math.sin(a) * 5, 3.2, rng, 0.1), rng, 'rgba(60,70,120,0.5)', 1);
      }
    }
    g.globalAlpha = 1;
    this.canvas = c;
    this.scale = scale;
  }

  draw(ctx: CanvasRenderingContext2D, pixelScale: number): void {
    if (!this.canvas || Math.abs(this.scale - pixelScale) > 1e-6) this.build(pixelScale);
    if (this.canvas) ctx.drawImage(this.canvas, 0, 0, W, H);
  }
}

/** Hand-drawn side and top walls (boiling sprites). */
export class PlayFrame {
  constructor(
    private readonly skin: Skin,
    private readonly cache: BoilCache,
  ) {}

  private sprite(key: string, w: number, h: number, horizontal: boolean, seed: number): Sprite {
    const hit = this.cache.get(key, 'f');
    if (hit) return hit;
    const ink = this.skin.ink;
    return this.cache.build(key, 'f', w, h, 6, (g, v) => {
      const rng = createRng(seed + v * 977);
      const pts = horizontal
        ? wobblyLinePoints(0, h / 2, w, h / 2, rng, { jitter: 0.004, maxJitter: 2, segLen: 40 })
        : wobblyLinePoints(w / 2, 0, w / 2, h, rng, { jitter: 0.004, maxJitter: 2, segLen: 40 });
      strokePath(g, pts, rng, ink, 3);
      const p2 = horizontal
        ? wobblyLinePoints(4, h / 2 + 2, w - 4, h / 2 + 1.5, rng, { segLen: 40, maxJitter: 1.5 })
        : wobblyLinePoints(w / 2 + 2, 4, w / 2 + 1.5, h - 4, rng, { segLen: 40, maxJitter: 1.5 });
      strokePath(g, p2, rng, ink, 1.6, 0.5);
    });
  }

  draw(ctx: CanvasRenderingContext2D, time: number): void {
    const top = CONFIG.topWall;
    this.sprite('top', W, 4, true, 11).draw(ctx, 0, top - 4, time, 1);
    this.sprite('left', 4, H - top, false, 22).draw(ctx, -1, top, time, 2);
    this.sprite('right', 4, H - top, false, 33).draw(ctx, W - 3, top, time, 3);
  }
}
