import { CONFIG as C } from './config';
import { setSpeed } from './balls';
import { maybeDrop } from './drops';
import type { Brick, World } from './state';

/** Does this brick need to be cleared to win? (not steel, not regenerating) */
export const counts = (k: Brick): boolean => k.type !== 'steel' && k.type !== 'regen';

export type BreakCause = 'hit' | 'blast' | 'eraser';

/** Deals `dmg` damage from a ball or bolt. Steel takes none; a hidden brick is only revealed. */
export function damageBrick(w: World, k: Brick, dmg: number): void {
  if (k.type === 'steel') return;
  if (k.hidden) {
    k.hidden = false;
    k.hp = 1;
    w.events.push({ type: 'reveal', x: k.x + k.w / 2, y: k.y + k.h / 2, brickId: k.id });
    return;
  }
  k.hp -= dmg;
  if (k.hp <= 0) destroyBrick(w, k, 'hit');
}

/** Destroys a brick outright (fireball): hidden bricks included, steel excluded. */
export function smashBrick(w: World, k: Brick): void {
  if (k.type === 'steel') return;
  k.hidden = false;
  destroyBrick(w, k, 'hit');
}

/** Removes a brick: scores, drops, explodes / leaves a ghost, and checks for the win. */
export function destroyBrick(w: World, k: Brick, cause: BreakCause): void {
  const i = w.bricks.indexOf(k);
  if (i < 0 || k.type === 'steel') return;
  w.bricks.splice(i, 1);
  k.hp = 0;
  w.score += C.brickScore * k.maxHp;
  if (cause === 'hit') {
    w.speed = Math.min(C.maxSpeed, w.speed * (1 + C.speedGain));
    for (const o of w.balls) if (!o.stuck) setSpeed(o, w.speed);
  }
  const cx = k.x + k.w / 2;
  const cy = k.y + k.h / 2;
  w.events.push({ type: 'brickBreak', x: cx, y: cy, brickId: k.id });
  if (k.type === 'regen') {
    w.ghosts.push({ brick: { ...k, hp: k.maxHp }, timer: C.regenDelay });
  } else {
    maybeDrop(w, k);
  }
  if (k.type === 'explosive') explode(w, k);
  checkWin(w, cx, cy);
}

function checkWin(w: World, x: number, y: number): void {
  if (w.status !== 'playing' && w.status !== 'serve') return;
  if (w.bricks.some(counts)) return;
  w.status = 'won';
  w.events.push({ type: 'won', x, y });
}

function explode(w: World, k: Brick): void {
  const cx = k.x + k.w / 2;
  const cy = k.y + k.h / 2;
  w.events.push({ type: 'explode', x: cx, y: cy, brickId: k.id });
  for (const o of [...w.bricks]) {
    if (o.type === 'steel') continue;
    const dx = (o.x + o.w / 2 - cx) / C.explosionRx;
    const dy = (o.y + o.h / 2 - cy) / C.explosionRy;
    if (dx * dx + dy * dy > 1) continue;
    if (o.type === 'explosive') {
      if (!w.blasts.some((b) => b.brickId === o.id)) {
        w.blasts.push({ brickId: o.id, at: w.time + C.explosionDelay });
      }
    } else {
      destroyBrick(w, o, 'blast');
    }
  }
}

/** Detonates queued chain explosions whose delay has elapsed. */
export function processBlasts(w: World): void {
  if (w.blasts.length === 0) return;
  const due = w.blasts.filter((b) => b.at <= w.time);
  if (due.length === 0) return;
  w.blasts = w.blasts.filter((b) => b.at > w.time);
  for (const b of due) {
    const k = w.bricks.find((o) => o.id === b.brickId);
    if (k) destroyBrick(w, k, 'blast');
  }
}

const rectsOverlap = (a: Brick, x: number, b: Brick): boolean =>
  x < b.x + b.w && b.x < x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Slides moving bricks; walls and other bricks in the way reverse them. */
export function updateMovingBricks(w: World, dt: number): void {
  for (const k of w.bricks) {
    if (k.type !== 'moving') continue;
    const nx = k.x + k.vx * dt;
    const blocked =
      nx < 0 || nx + k.w > w.width || w.bricks.some((o) => o !== k && rectsOverlap(k, nx, o));
    if (blocked) k.vx = -k.vx;
    else k.x = nx;
  }
}

/** Re-forms regenerating bricks when their timer is up and nothing is in the way. */
export function updateGhosts(w: World, dt: number): void {
  if (w.ghosts.length === 0) return;
  const keep: typeof w.ghosts = [];
  for (const g of w.ghosts) {
    g.timer -= dt;
    if (g.timer > 0) {
      keep.push(g);
      continue;
    }
    const k = g.brick;
    const ballIn = w.balls.some((b) => {
      const dx = b.x - Math.max(k.x, Math.min(b.x, k.x + k.w));
      const dy = b.y - Math.max(k.y, Math.min(b.y, k.y + k.h));
      return Math.hypot(dx, dy) < b.r;
    });
    if (ballIn || w.bricks.some((o) => rectsOverlap(k, k.x, o))) {
      g.timer = C.regenRetry;
      keep.push(g);
      continue;
    }
    w.bricks.push(k);
    w.events.push({ type: 'regen', x: k.x + k.w / 2, y: k.y + k.h / 2, brickId: k.id });
  }
  w.ghosts = keep;
}
