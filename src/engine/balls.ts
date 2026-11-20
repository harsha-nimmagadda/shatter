import { CONFIG as C } from './config';
import { maxBounceDeg } from './paddle';
import { createRng } from './rng';
import type { Ball, World } from './state';

export const DEG = Math.PI / 180;
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function setSpeed(b: Ball, speed: number): void {
  const cur = Math.hypot(b.vx, b.vy) || 1;
  b.vx *= speed / cur;
  b.vy *= speed / cur;
}

/** Rotates the velocity clockwise (seen on screen) by `a` radians, keeping speed. */
export function rotate(b: Ball, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const vx = b.vx * c - b.vy * s;
  const vy = b.vx * s + b.vy * c;
  b.vx = vx;
  b.vy = vy;
}

/** Keeps |vy| >= minVerticalRatio * speed, preserving speed and the signs of both components. */
export function enforceMinVertical(b: Ball): void {
  const speed = Math.hypot(b.vx, b.vy);
  const minVy = C.minVerticalRatio * speed;
  if (Math.abs(b.vy) >= minVy) return;
  const sy = b.vy < 0 ? -1 : b.vy > 0 ? 1 : -1;
  const sx = b.vx < 0 ? -1 : 1;
  b.vy = sy * minVy;
  b.vx = sx * Math.sqrt(speed * speed - minVy * minVy);
}

/** Velocity for a ball leaving the paddle at `offset` (-1..1 across the half width). */
export function paddleVelocity(w: World, offset: number): { vx: number; vy: number } {
  const a = clamp(offset, -1, 1) * maxBounceDeg(w) * DEG;
  return { vx: w.speed * Math.sin(a), vy: -w.speed * Math.cos(a) };
}

/** Rests stuck balls on the paddle, keeping their offset inside it. */
export function followPaddle(w: World): void {
  const p = w.paddle;
  for (const b of w.balls) {
    if (!b.stuck) continue;
    b.stuckOffset = clamp(b.stuckOffset, -p.w / 2, p.w / 2);
    b.x = p.x + b.stuckOffset;
    b.y = p.y - b.r;
  }
}

/** Serve launch: random angle within launchDeg. Starts play. */
export function launchServe(w: World): void {
  const rng = createRng(w.rng);
  for (const b of w.balls) {
    if (!b.stuck) continue;
    const a = rng.range(-C.launchDeg, C.launchDeg) * DEG;
    b.stuck = false;
    b.vx = w.speed * Math.sin(a);
    b.vy = -w.speed * Math.cos(a);
    w.events.push({ type: 'launch', x: b.x, y: b.y });
  }
  w.rng = rng.state;
  w.status = 'playing';
}

/** Releases one ball held by 'catch' with the angle it would have bounced at. */
export function releaseBall(w: World, b: Ball): void {
  const v = paddleVelocity(w, b.stuckOffset / (w.paddle.w / 2));
  b.stuck = false;
  b.stuckT = 0;
  b.vx = v.vx;
  b.vy = v.vy;
  w.events.push({ type: 'launch', x: b.x, y: b.y });
}

/** Releases all balls held by 'catch'. */
export function releaseCaught(w: World): boolean {
  let any = false;
  for (const b of w.balls) {
    if (!b.stuck) continue;
    releaseBall(w, b);
    any = true;
  }
  return any;
}

/** Launches or releases every stuck ball (used before multiball / split). */
export function releaseAll(w: World): void {
  if (w.status === 'serve') launchServe(w);
  else releaseCaught(w);
}
