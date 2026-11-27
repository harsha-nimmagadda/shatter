import { CONFIG as C } from './config';
import { setSpeed } from './balls';
import { maybeDrop } from './drops';
import type { Brick, World } from './state';

/** Does this brick need to be cleared to win? (not steel, not regenerating) */
export const counts = (k: Brick): boolean => k.type !== 'steel' && k.type !== 'regen';

export type BreakCause = 'hit' | 'blast' | 'eraser';

/** Combo multiplier for the current number of breaks since the last paddle touch. */
export function comboMultiplier(w: Pick<World, 'combo'>): number {
  for (const [min, mul] of C.comboSteps) if (w.combo >= min) return mul;
  return 1;
}

/** Adds points (rounded) and awards an extra life at every 10,000 points crossed. */
export function addScore(w: World, points: number, x = w.paddle.x, y = w.paddle.y): void {
  w.score += Math.round(points);
  while (w.score >= w.nextLifeAt) {
    w.nextLifeAt += C.extraLifeEvery;
    if (w.lives < C.maxLives) {
      w.lives += 1;
      w.events.push({ type: 'extraLife', x, y });
    }
  }
}

/** Scores `hp` removed from a brick: 10 each x combo x (2 with Red Pen). Regen bricks score nothing. */
function awardHp(w: World, k: Brick, hp: number): void {
  if (k.type === 'regen' || hp <= 0) return;
  const mul = comboMultiplier(w) * (w.effects.redpen !== undefined ? 2 : 1);
  addScore(w, C.brickScore * hp * mul, k.x + k.w / 2, k.y + k.h / 2);
}

/** Any damage to a breakable brick clears the clip anti-softlock streak. */
export function resetClipStreak(w: World): void {
  w.clipStreak = 0;
  w.stallT = 0;
  for (const k of w.bricks) if (k.type === 'steel') k.streakHits = 0;
}

/**
 * The one damage path (ball, staple, blast-free sources, splash): steel takes none, a hidden brick is only
 * revealed, otherwise `dmg` hp are removed (scoring per hp removed) and the brick breaks at 0.
 */
export function damageBrick(w: World, k: Brick, dmg: number): void {
  if (k.type === 'steel') return;
  resetClipStreak(w);
  if (k.hidden) {
    k.hidden = false;
    k.hp = 1;
    awardHp(w, k, 1);
    w.events.push({ type: 'reveal', x: k.x + k.w / 2, y: k.y + k.h / 2, brickId: k.id });
    return;
  }
  const removed = Math.min(dmg, k.hp);
  if (k.hp - dmg <= 0) {
    destroyBrick(w, k, 'hit');
  } else {
    awardHp(w, k, removed);
    k.hp -= dmg;
  }
}

/** Orthogonal edge neighbours of a brick (gap <= 2 px, overlapping span on the other axis). */
export function edgeNeighbours(w: World, k: Brick): Brick[] {
  const GAP = 2 + 1e-6;
  return w.bricks.filter((o) => {
    if (o === k) return false;
    const yOverlap = Math.min(k.y + k.h, o.y + o.h) - Math.max(k.y, o.y);
    const xOverlap = Math.min(k.x + k.w, o.x + o.w) - Math.max(k.x, o.x);
    const sideBySide = yOverlap > 0 && (Math.abs(o.x - (k.x + k.w)) <= GAP || Math.abs(k.x - (o.x + o.w)) <= GAP);
    const stacked = xOverlap > 0 && (Math.abs(o.y - (k.y + k.h)) <= GAP || Math.abs(k.y - (o.y + o.h)) <= GAP);
    return sideBySide || stacked;
  });
}

/** Ball damage with the Highlighter splash: neighbours (never clips) take 1 damage, no recursive splash. */
export function damageBrickBall(w: World, k: Brick, dmg: number): void {
  const neighbours = w.effects.highlighter !== undefined && k.type !== 'steel'
    ? edgeNeighbours(w, k).filter((o) => o.type !== 'steel')
    : [];
  const cx = k.x + k.w / 2;
  const cy = k.y + k.h / 2;
  damageBrick(w, k, dmg);
  if (neighbours.length === 0) return;
  w.events.push({ type: 'splash', x: cx, y: cy, brickId: k.id });
  for (const o of neighbours) if (w.bricks.includes(o)) damageBrick(w, o, 1);
}

/** Removes a brick: scores, drops, explodes / leaves a ghost, and checks for the win. */
export function destroyBrick(w: World, k: Brick, cause: BreakCause): void {
  const i = w.bricks.indexOf(k);
  if (i < 0 || k.type === 'steel') return;
  resetClipStreak(w);
  awardHp(w, k, k.hp);
  w.bricks.splice(i, 1);
  k.hp = 0;
  if (k.type !== 'regen') {
    const before = comboMultiplier(w);
    w.combo += 1;
    const after = comboMultiplier(w);
    if (after > before) w.events.push({ type: 'combo', x: k.x + k.w / 2, y: k.y + k.h / 2, value: after });
  }
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

/** A ball hit a metal clip: advances the anti-softlock streak and pops loose clips at the threshold. */
export function clipHit(w: World, k: Brick): void {
  w.clipStreak += 1;
  k.streakHits += 1;
  if (k.streakHits === C.clipLooseHits) {
    w.events.push({ type: 'clipLoose', x: k.x + k.w / 2, y: k.y + k.h / 2, brickId: k.id });
  }
  if (w.clipStreak < C.clipPopStreak) return;
  for (const o of [...w.bricks]) {
    if (o.type !== 'steel' || o.streakHits < C.clipLooseHits) continue;
    w.bricks.splice(w.bricks.indexOf(o), 1);
    w.events.push({ type: 'clipPop', x: o.x + o.w / 2, y: o.y + o.h / 2, brickId: o.id });
  }
  w.clipStreak = 0;
  for (const o of w.bricks) if (o.type === 'steel') o.streakHits = 0;
}

function checkWin(w: World, x: number, y: number): void {
  if (w.status !== 'playing' && w.status !== 'serve') return;
  if (w.bricks.some(counts)) return;
  w.status = 'won';
  addScore(w, C.winLifeBonus * w.lives, x, y);
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
