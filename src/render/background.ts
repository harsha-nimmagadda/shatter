import { CONFIG } from '../engine/config';
import { createRng } from '../engine/rng';
import { BoilCache, type Sprite } from './boil';
import { roughCirclePoints, strokePath, strokeSegs, wobblyLinePoints, type Seg } from './sketch';
import type { Skin } from './skin';

const W = CONFIG.width;
const H = CONFIG.height;

/** Static paper page, drawn once into an offscreen canvas per pixel scale. */
export class Background {
  private canvas: HTMLCanvasElement | null = null;
  private scale = 0;

  constructor(private readonly skin: Skin) {}

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
    const tex = s.textures?.paper;
    if (tex) {
      g.drawImage(tex, 0, 0, W, H);
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
      strokePath(g, wobblyLinePoints(-4, y, W + 4, y, rng, { jitter: 0.002, maxJitter: 1.4, overshoot: 0, segLen: 60 }), rng, s.rule, 1.2, 0.5);
    }
    // Double red margin.
    for (const mx of [58, 64]) {
      strokePath(g, wobblyLinePoints(mx, -6, mx + 1, H + 6, rng, { jitter: 0.002, maxJitter: 1.6, overshoot: 0, segLen: 80 }), rng, s.margin, 1.4, 0.6);
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
