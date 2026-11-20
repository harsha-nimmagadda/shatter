import { CONFIG as C } from './config';
import { createRng } from './rng';
import { newStuckBall, type Ball, type Brick, type GameEvent, type Input, type World } from './state';

const DEG = Math.PI / 180;

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
  movePaddle(world, input, dt);
  if (world.status === 'serve') {
    serve(world, input);
  } else if (world.status === 'playing') {
    for (const ball of world.balls) {
      if (world.status === 'playing') moveBall(world, ball, dt);
    }
    handleLostBalls(world);
  }
  world.time += dt;
}

function movePaddle(w: World, input: Input, dt: number): void {
  const p = w.paddle;
  if (input.moveDir !== 0) {
    p.x += input.moveDir * C.paddleKeySpeed * dt;
  } else if (input.paddleX !== null) {
    const max = C.paddleMaxSpeed * dt;
    p.x += Math.max(-max, Math.min(max, input.paddleX - p.x));
  }
  p.x = Math.max(p.w / 2, Math.min(w.width - p.w / 2, p.x));
}

function serve(w: World, input: Input): void {
  for (const b of w.balls) {
    if (!b.stuck) continue;
    b.x = w.paddle.x + b.stuckOffset;
    b.y = w.paddle.y - b.r;
  }
  if (!input.fire) return;
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

function moveBall(w: World, ball: Ball, dt: number): void {
  const dist = Math.hypot(ball.vx, ball.vy) * dt;
  const n = Math.max(1, Math.ceil(dist / (ball.r * 0.5)));
  const h = dt / n;
  for (let i = 0; i < n && w.status === 'playing'; i++) {
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    let bounced = collideWalls(w, ball);
    bounced = collideBricks(w, ball) || bounced;
    bounced = collidePaddle(w, ball) || bounced;
    if (bounced) enforceMinVertical(ball);
  }
}

function collideWalls(w: World, b: Ball): boolean {
  let hit = false;
  if (b.x - b.r < 0) {
    b.x = b.r;
    b.vx = Math.abs(b.vx);
    hit = true;
  } else if (b.x + b.r > w.width) {
    b.x = w.width - b.r;
    b.vx = -Math.abs(b.vx);
    hit = true;
  }
  if (b.y - b.r < C.topWall) {
    b.y = C.topWall + b.r;
    b.vy = Math.abs(b.vy);
    hit = true;
  }
  if (hit) w.events.push({ type: 'wall', x: b.x, y: b.y });
  return hit;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Resolves the single deepest brick overlap this substep. */
function collideBricks(w: World, b: Ball): boolean {
  let best: Brick | null = null;
  let bestDepth = 0;
  for (const k of w.bricks) {
    const dx = b.x - clamp(b.x, k.x, k.x + k.w);
    const dy = b.y - clamp(b.y, k.y, k.y + k.h);
    const d = Math.hypot(dx, dy);
    if (d < b.r && b.r - d > bestDepth) {
      best = k;
      bestDepth = b.r - d;
    }
  }
  if (!best) return false;

  const k = best;
  const inX = b.x >= k.x && b.x <= k.x + k.w;
  const inY = b.y >= k.y && b.y <= k.y + k.h;
  let nx = 0;
  let ny = 0;
  if (inX) {
    ny = b.y < k.y + k.h / 2 ? -1 : 1;
    b.y = ny < 0 ? k.y - b.r : k.y + k.h + b.r;
  } else if (inY) {
    nx = b.x < k.x + k.w / 2 ? -1 : 1;
    b.x = nx < 0 ? k.x - b.r : k.x + k.w + b.r;
  } else {
    // True corner: normal points from the corner to the ball centre.
    const cx = clamp(b.x, k.x, k.x + k.w);
    const cy = clamp(b.y, k.y, k.y + k.h);
    const d = Math.hypot(b.x - cx, b.y - cy) || 1;
    nx = (b.x - cx) / d;
    ny = (b.y - cy) / d;
    b.x = cx + nx * b.r;
    b.y = cy + ny * b.r;
  }
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= 2 * vn * nx;
    b.vy -= 2 * vn * ny;
  }

  w.events.push({ type: 'brickHit', x: b.x, y: b.y, brickId: k.id });
  if (k.kind === 'normal' && --k.hp <= 0) {
    w.bricks.splice(w.bricks.indexOf(k), 1);
    w.score += C.brickScore * k.maxHp;
    w.speed = Math.min(C.maxSpeed, w.speed * (1 + C.speedGain));
    for (const o of w.balls) if (!o.stuck) setSpeed(o, w.speed);
    w.events.push({ type: 'brickBreak', x: k.x + k.w / 2, y: k.y + k.h / 2, brickId: k.id });
    if (!w.bricks.some((o) => o.kind === 'normal')) {
      w.status = 'won';
      w.events.push({ type: 'won', x: b.x, y: b.y });
    }
  }
  return true;
}

function collidePaddle(w: World, b: Ball): boolean {
  const p = w.paddle;
  if (b.vy <= 0) return false;
  const dx = b.x - clamp(b.x, p.x - p.w / 2, p.x + p.w / 2);
  const dy = b.y - clamp(b.y, p.y, p.y + p.h);
  if (Math.hypot(dx, dy) >= b.r) return false;
  const offset = clamp((b.x - p.x) / (p.w / 2), -1, 1);
  const a = offset * C.maxBounceDeg * DEG;
  b.vx = w.speed * Math.sin(a);
  b.vy = -w.speed * Math.cos(a);
  b.y = p.y - b.r;
  w.events.push({ type: 'paddle', x: b.x, y: b.y });
  return true;
}

function setSpeed(b: Ball, speed: number): void {
  const cur = Math.hypot(b.vx, b.vy) || 1;
  b.vx *= speed / cur;
  b.vy *= speed / cur;
}

/** Keeps |vy| >= minVerticalRatio * speed, preserving speed and the signs of both components. */
function enforceMinVertical(b: Ball): void {
  const speed = Math.hypot(b.vx, b.vy);
  const minVy = C.minVerticalRatio * speed;
  if (Math.abs(b.vy) >= minVy) return;
  const sy = b.vy < 0 ? -1 : b.vy > 0 ? 1 : -1;
  const sx = b.vx < 0 ? -1 : 1;
  b.vy = sy * minVy;
  b.vx = sx * Math.sqrt(speed * speed - minVy * minVy);
}

function handleLostBalls(w: World): void {
  if (w.status !== 'playing') return;
  const alive = w.balls.filter((b) => b.y - b.r <= w.height);
  if (alive.length === w.balls.length) return;
  w.balls = alive;
  if (alive.length > 0) return;
  w.lives -= 1;
  w.speed = C.startSpeed;
  w.events.push({ type: 'lifeLost', x: w.paddle.x, y: w.height });
  if (w.lives <= 0) {
    w.status = 'gameover';
    w.events.push({ type: 'gameover', x: w.paddle.x, y: w.height });
  } else {
    w.status = 'serve';
    const ball = newStuckBall();
    ball.x = w.paddle.x;
    ball.y = w.paddle.y - ball.r;
    w.balls = [ball];
  }
}
