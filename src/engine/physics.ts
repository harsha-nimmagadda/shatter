import { CONFIG as C } from './config';
import { enforceMinVertical, followPaddle, launchServe } from './balls';
import { processBlasts, updateGhosts, updateMovingBricks } from './bricks';
import { collideBricks, collideNet, collidePaddle, collideWalls } from './collide';
import { loseLife } from './life';
import { paddleSpeedMul } from './paddle';
import { handleFire, steerBalls, updateBolts, updateCaught, updateDrops, updateEffects } from './powerups';
import type { Ball, GameEvent, Input, World } from './state';

/** Returns and clears the accumulated events. Call once per rendered frame. */
export function drainEvents(world: World): GameEvent[] {
  const out = world.events;
  world.events = [];
  return out;
}

/**
 * Advances the world by dt seconds. Mutates `world` in place (no per-step allocation
 * churn); callers that need history must copy what they need beforehand.
 */
export function step(world: World, input: Input, dt: number): void {
  updateEffects(world, dt);
  movePaddle(world, input, dt);
  if (world.status === 'serve') {
    followPaddle(world);
    if (input.fire) launchServe(world);
  } else if (world.status === 'playing') {
    followPaddle(world);
    if (input.fire) handleFire(world);
    updateCaught(world, dt);
  }
  if (world.status === 'serve' || world.status === 'playing') {
    updateMovingBricks(world, dt);
    processBlasts(world);
    updateGhosts(world, dt);
  }
  if (world.status === 'playing') {
    steerBalls(world, dt);
    for (const ball of world.balls) {
      if (world.status === 'playing' && !ball.stuck) moveBall(world, ball, dt);
    }
    updateBolts(world, dt);
  }
  if (world.status === 'serve' || world.status === 'playing') updateDrops(world, dt);
  handleLostBalls(world);
  world.time += dt;
}

function movePaddle(w: World, input: Input, dt: number): void {
  const p = w.paddle;
  const mul = paddleSpeedMul(w);
  if (input.moveAxis !== 0) {
    p.x += input.moveAxis * C.paddleKeySpeed * mul * dt;
  } else if (input.paddleX !== null) {
    const max = C.paddleMaxSpeed * mul * dt;
    p.x += Math.max(-max, Math.min(max, input.paddleX - p.x));
  }
  p.x = Math.max(p.w / 2, Math.min(w.width - p.w / 2, p.x));
}

function moveBall(w: World, ball: Ball, dt: number): void {
  const dist = Math.hypot(ball.vx, ball.vy) * dt;
  const n = Math.max(1, Math.ceil(dist / (ball.r * 0.5)));
  const h = dt / n;
  for (let i = 0; i < n && w.status === 'playing' && !ball.stuck; i++) {
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    let bounced = collideWalls(w, ball);
    bounced = collideBricks(w, ball) || bounced;
    bounced = collidePaddle(w, ball) || bounced;
    bounced = collideNet(w, ball) || bounced;
    if (bounced && !ball.stuck) enforceMinVertical(ball);
  }
}

function handleLostBalls(w: World): void {
  if (w.status !== 'playing') return;
  const alive = w.balls.filter((b) => b.y - b.r <= w.height);
  if (alive.length === w.balls.length) return;
  w.balls = alive;
  if (alive.length > 0) return;
  loseLife(w);
}
