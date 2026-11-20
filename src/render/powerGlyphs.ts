import type { Rng } from '../engine/rng';
import { roughCirclePoints, strokePath } from './sketch';

/**
 * Procedural doodle icons, used whenever a power's manifest art is missing. Each glyph is designed in a
 * 24 x 24 box centred on (0, 0) and drawn through a scale transform, so `size` is the box edge in units.
 */

const INK = '#2b2b2b';

type Glyph = (ctx: CanvasRenderingContext2D, rng: Rng) => void;

function poly(ctx: CanvasRenderingContext2D, pts: readonly [number, number][], fill: string | null, stroke = INK, w = 1.5): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color = INK, w = 1.5): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | null, stroke: string | null = INK, w = 1.5): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = w;
    ctx.stroke();
  }
}

/** A slanted pen/marker shape: body rect from tail to tip rotated by `ang`. */
function pen(ctx: CanvasRenderingContext2D, body: string, cap: string, tip: string): void {
  ctx.save();
  ctx.rotate(-Math.PI / 4);
  poly(ctx, [[-11, -3], [4, -3], [4, 3], [-11, 3]], body);
  poly(ctx, [[-11, -3], [-6, -3], [-6, 3], [-11, 3]], cap);
  poly(ctx, [[4, -3], [10, 0], [4, 3]], tip);
  ctx.restore();
}

const star = (ctx: CanvasRenderingContext2D, r: number, fill: string): void => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  poly(ctx, pts, fill);
};

export const GLYPHS: Record<string, Glyph> = {
  photocopy: (ctx) => {
    poly(ctx, [[-10, -9], [2, -9], [2, 5], [-10, 5]], '#ffffff');
    poly(ctx, [[-4, -4], [8, -4], [8, 10], [-4, 10]], '#ffffff');
    line(ctx, -1, 0, 5, 0, INK, 1.1);
    line(ctx, -1, 3.5, 5, 3.5, INK, 1.1);
    line(ctx, -1, 7, 3, 7, INK, 1.1);
  },
  crumpled: (ctx, rng) => {
    strokePath(ctx, roughCirclePoints(0, 0, 9, rng, 0.12), rng, INK, 1.6);
    line(ctx, -5, -3, 1, 1, '#777', 1);
    line(ctx, 1, -6, 4, 0, '#777', 1);
    line(ctx, -3, 4, 5, 5, '#777', 1);
  },
  plane: (ctx) => {
    poly(ctx, [[11, 0], [-10, -8], [-5, 0], [-10, 8]], '#fffdf3');
    line(ctx, 11, 0, -5, 0, INK, 1);
  },
  highlighter: (ctx) => pen(ctx, '#39FF14', '#2b2b2b', '#e8ff7a'),
  correction: (ctx) => {
    circle(ctx, -2, 0, 8, '#fffdf3');
    circle(ctx, -2, 0, 3, '#dadada');
    poly(ctx, [[3, 4], [11, 4], [11, 9], [3, 9]], '#ffffff');
  },
  ruler: (ctx) => {
    poly(ctx, [[-11, -4], [11, -4], [11, 4], [-11, 4]], '#ecd08a');
    for (let x = -9; x <= 9; x += 3) line(ctx, x, -4, x, x % 6 === 0 ? 0 : -1.5, INK, 1);
  },
  gluestick: (ctx) => {
    poly(ctx, [[-5, -2], [5, -2], [5, 11], [-5, 11]], '#3a76d8');
    poly(ctx, [[-5, -2], [5, -2], [5, -8], [-5, -8]], '#fff6c4');
    poly(ctx, [[-6, -2], [6, -2], [6, 1], [-6, 1]], '#f5f5f5');
  },
  stapler: (ctx) => {
    poly(ctx, [[-11, 1], [11, 1], [11, 7], [-11, 7]], '#4b4f57');
    poly(ctx, [[-11, 1], [-9, -6], [11, -3], [11, 1]], '#d03b3b');
    line(ctx, -2, 9, 2, 9, INK, 1.2);
  },
  eraser: (ctx) => {
    poly(ctx, [[-10, -5], [10, -5], [10, 5], [-10, 5]], '#f2a6ad');
    poly(ctx, [[2, -5], [6, -5], [6, 5], [2, 5]], '#5b8fd0', INK, 1.2);
  },
  goldstar: (ctx) => star(ctx, 11, '#F2B705'),
  paperclip: (ctx) => {
    ctx.strokeStyle = '#8a9099';
    ctx.lineWidth = 1.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-3, 6);
    ctx.lineTo(-3, -6);
    ctx.arc(0, -6, 3, Math.PI, 0);
    ctx.lineTo(3, 8);
    ctx.arc(0, 8, 3, 0, Math.PI);
    ctx.lineTo(-6, -6);
    ctx.arc(-1.5, -6, 4.5, Math.PI, 0);
    ctx.lineTo(6, 8);
    ctx.stroke();
  },
  stickynote: (ctx) => {
    poly(ctx, [[-9, -9], [9, -9], [9, 4], [3, 10], [-9, 10]], '#f9e46a');
    line(ctx, -6, -3, 6, -3, '#c9ab20', 1);
    line(ctx, -6, 1, 3, 1, '#c9ab20', 1);
  },
  sharpener: (ctx) => {
    poly(ctx, [[-10, -6], [8, -6], [10, 6], [-10, 6]], '#b4b9c1');
    circle(ctx, -3, 0, 2.2, '#222', INK, 1);
    line(ctx, 3, -6, 3, 6, INK, 1);
  },
  scissors: (ctx) => {
    line(ctx, -8, -8, 9, 7, '#8a9099', 2.2);
    line(ctx, -8, 8, 9, -7, '#8a9099', 2.2);
    circle(ctx, -7, -6.5, 3, null, '#FF3B5C', 1.8);
    circle(ctx, -7, 6.5, 3, null, '#FF3B5C', 1.8);
  },
  redpen: (ctx) => pen(ctx, '#FF3B5C', '#2b2b2b', '#ffd0d6'),
};

/** Draws the doodle for `type` centred at (cx, cy) in a `size` box; false when there is none. */
export function drawGlyph(ctx: CanvasRenderingContext2D, type: string, cx: number, cy: number, size: number, rng: Rng): boolean {
  const g = GLYPHS[type];
  if (!g) return false;
  ctx.save();
  ctx.translate(cx, cy);
  const k = size / 24;
  ctx.scale(k, k);
  g(ctx, rng);
  ctx.restore();
  return true;
}
