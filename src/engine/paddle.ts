import { CONFIG as C } from './config';
import type { World } from './state';

/** Paddle width: 96 base, 160 with the ruler, then x0.7 with the sharpener. */
export function paddleWidth(w: World): number {
  let width: number = w.effects.ruler !== undefined ? C.rulerW : C.paddleW;
  if (w.effects.sharpener !== undefined) width *= C.sharpenerMul;
  return width;
}

/** Recomputes the paddle width and keeps the paddle inside the walls. */
export function applyPaddleWidth(w: World): void {
  const p = w.paddle;
  p.w = paddleWidth(w);
  p.x = Math.max(p.w / 2, Math.min(w.width - p.w / 2, p.x));
}

/** Max paddle bounce angle from vertical, degrees. */
export function maxBounceDeg(w: World): number {
  return w.effects.ruler !== undefined ? C.rulerMaxBounceDeg : C.maxBounceDeg;
}

/** Solid x-ranges of the paddle: one, or two while the scissors gap is open. */
export function paddleSegments(w: World): [number, number][] {
  const p = w.paddle;
  const l = p.x - p.w / 2;
  const r = p.x + p.w / 2;
  if (w.effects.scissors === undefined) return [[l, r]];
  const g = C.scissorsGap / 2;
  return [[l, p.x - g], [p.x + g, r]];
}
