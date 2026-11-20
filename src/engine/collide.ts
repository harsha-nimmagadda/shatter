import { CONFIG as C } from './config';
import { clamp, paddleVelocity } from './balls';
import { damageBrick, smashBrick } from './bricks';
import type { Ball, Brick, World } from './state';

export function collideWalls(w: World, b: Ball): boolean {
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

/** Penetration depth of the ball into the brick (0 when apart). */
function depth(b: Ball, k: Brick): number {
  const dx = b.x - clamp(b.x, k.x, k.x + k.w);
  const dy = b.y - clamp(b.y, k.y, k.y + k.h);
  const d = Math.hypot(dx, dy);
  return d < b.r ? b.r - d : 0;
}

/** Pushes the ball out of the brick and reflects its velocity. */
function bounceOff(b: Ball, k: Brick): void {
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
}

function deepest(b: Ball, bricks: readonly Brick[]): Brick | null {
  let best: Brick | null = null;
  let bestDepth = 0;
  for (const k of bricks) {
    const d = depth(b, k);
    if (d > bestDepth) {
      best = k;
      bestDepth = d;
    }
  }
  return best;
}

/** Ball vs bricks for one substep; returns true when the ball bounced. */
export function collideBricks(w: World, b: Ball): boolean {
  if (w.effects.fireball !== undefined) return collideFireball(w, b);
  if (w.effects.through !== undefined) {
    collideThrough(w, b);
    return false;
  }
  if (b.overlap && b.overlap.length > 0) b.overlap = [];
  const k = deepest(b, w.bricks);
  if (!k) return false;
  bounceOff(b, k);
  w.events.push({ type: 'brickHit', x: b.x, y: b.y, brickId: k.id });
  damageBrick(w, k, w.effects.crumpled !== undefined ? 2 : 1);
  return true;
}

/** Fireball: smashes everything but steel without bouncing; steel still bounces. */
function collideFireball(w: World, b: Ball): boolean {
  if (b.overlap && b.overlap.length > 0) b.overlap = [];
  const hits = w.bricks.filter((k) => depth(b, k) > 0);
  let steel: Brick | null = null;
  for (const k of hits) {
    if (k.type === 'steel') continue;
    w.events.push({ type: 'brickHit', x: b.x, y: b.y, brickId: k.id });
    smashBrick(w, k);
  }
  steel = deepest(b, hits.filter((k) => k.type === 'steel'));
  if (!steel) return false;
  bounceOff(b, steel);
  w.events.push({ type: 'brickHit', x: b.x, y: b.y, brickId: steel.id });
  return true;
}

/** Through: passes everything, damaging each overlapped brick once per pass (steel takes none). */
function collideThrough(w: World, b: Ball): void {
  const prev = b.overlap ?? [];
  const now: number[] = [];
  for (const k of [...w.bricks]) {
    if (depth(b, k) <= 0) continue;
    now.push(k.id);
    if (prev.includes(k.id)) continue;
    w.events.push({ type: 'brickHit', x: b.x, y: b.y, brickId: k.id });
    damageBrick(w, k, 1);
  }
  b.overlap = now;
}

export function collidePaddle(w: World, b: Ball): boolean {
  const p = w.paddle;
  if (b.vy <= 0 || b.stuck) return false;
  const dx = b.x - clamp(b.x, p.x - p.w / 2, p.x + p.w / 2);
  const dy = b.y - clamp(b.y, p.y, p.y + p.h);
  if (Math.hypot(dx, dy) >= b.r) return false;
  b.y = p.y - b.r;
  if (w.effects.catch !== undefined) {
    b.stuck = true;
    b.stuckT = 0;
    b.stuckOffset = clamp(b.x - p.x, -p.w / 2, p.w / 2);
    b.vx = 0;
    b.vy = 0;
  } else {
    const v = paddleVelocity(w, (b.x - p.x) / (p.w / 2));
    b.vx = v.vx;
    b.vy = v.vy;
  }
  w.events.push({ type: 'paddle', x: b.x, y: b.y });
  return true;
}

/** Sticky-note net: bounces one ball back up from just above the bottom edge, then is used up. */
export function collideNet(w: World, b: Ball): boolean {
  if (!w.net || b.vy <= 0 || b.y + b.r < w.height - C.netInset) return false;
  b.y = w.height - C.netInset - b.r;
  b.vy = -Math.abs(b.vy);
  w.net = false;
  w.events.push({ type: 'net', x: b.x, y: b.y });
  return true;
}

