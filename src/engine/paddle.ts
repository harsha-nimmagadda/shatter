import { CONFIG as C } from './config';
import type { World } from './state';

/** Paddle width from the size level and the sharpener / ruler effects. */
export function paddleWidth(w: World): number {
  const level = Math.max(-2, Math.min(2, w.paddleLevel));
  let width: number = C.paddleWidths[level + 2]!;
  if (w.effects.sharpener !== undefined) width *= C.sharpenerMul;
  if (w.effects.ruler !== undefined) width *= C.rulerMul;
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

/** Multiplier on the paddle's movement speeds. */
export function paddleSpeedMul(w: World): number {
  return w.effects.inkblot !== undefined ? C.inkblotSpeedMul : 1;
}
