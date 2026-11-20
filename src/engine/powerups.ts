import { CONFIG as C, EFFECT_NAMES, isPositive, type EffectName, type PowerType } from './config';
import { DEG, clamp, releaseAll, releaseBall, releaseCaught, rotate, setSpeed } from './balls';
import { addScore, counts, damageBrick, destroyBrick } from './bricks';
import { applyPaddleWidth, paddleSegments } from './paddle';
import type { Ball, Brick, Drop, World } from './state';

const isEffect = (t: PowerType): t is EffectName => (EFFECT_NAMES as readonly string[]).includes(t);

/** Applies a caught power-up. */
export function applyPower(w: World, type: PowerType): void {
  if (isEffect(type)) {
    const wasActive = w.effects[type] !== undefined;
    w.effects[type] = C.effectSeconds[type];
    if (type === 'stapler' && !wasActive) w.stapleCd = 0;
    // Red Pen: one speed boost only; re-catching just refreshes the timer.
    if (type === 'redpen' && !wasActive) scaleSpeed(w, Math.min(C.maxSpeed, w.speed * C.redpenMul));
    applyPaddleWidth(w);
    return;
  }
  switch (type) {
    case 'photocopy':
      photocopy(w);
      break;
    case 'correction':
      scaleSpeed(w, Math.max(C.correctionFloor * C.startSpeed, w.speed * C.correctionMul));
      break;
    case 'goldstar':
      w.lives = Math.min(C.maxLives, w.lives + 1);
      break;
    case 'eraser':
      eraseLowestRow(w);
      break;
    case 'stickynote':
      w.net = true;
      break;
  }
}

function scaleSpeed(w: World, speed: number): void {
  w.speed = speed;
  for (const b of w.balls) if (!b.stuck) setSpeed(b, speed);
}

/** Photocopy: launches stuck balls, then every moving ball becomes 3 (clones at +-deg), capped. */
function photocopy(w: World): void {
  releaseAll(w);
  const base = w.balls.filter((b) => !b.stuck);
  for (const b of base) {
    const room = C.maxBalls - w.balls.length;
    if (room <= 0) break;
    const clone: Ball = { ...b };
    rotate(clone, C.photocopyDeg * DEG);
    w.balls.push(clone);
    if (room >= 2) {
      const other: Ball = { ...b };
      rotate(other, -C.photocopyDeg * DEG);
      w.balls.push(other);
    }
  }
}

/** Destroys every non-steel brick in the lowest row that has one. */
function eraseLowestRow(w: World): void {
  let y = -Infinity;
  for (const k of w.bricks) if (k.type !== 'steel' && k.y > y) y = k.y;
  if (y === -Infinity) return;
  const row = w.bricks.filter((k) => k.type !== 'steel' && Math.abs(k.y - y) < 1);
  const h = row[0]!.h;
  w.events.push({ type: 'eraser', x: w.width / 2, y: y + h / 2 });
  for (const k of row) destroyBrick(w, k, 'eraser');
}

/** Ticks effect timers and the stapler cooldown, then refreshes the paddle width. */
export function updateEffects(w: World, dt: number): void {
  w.stapleCd = Math.max(0, w.stapleCd - dt);
  for (const name of EFFECT_NAMES) {
    const left = w.effects[name];
    if (left === undefined) continue;
    if (left - dt <= 0) {
      delete w.effects[name];
      w.events.push({ type: 'effectEnd', x: w.paddle.x, y: w.paddle.y, power: name });
      if (name === 'redpen') scaleSpeed(w, Math.max(C.startSpeed, w.speed / C.redpenMul));
    } else {
      w.effects[name] = left - dt;
    }
  }
  applyPaddleWidth(w);
}

/** Falls capsules (paperclip pulls positive ones in); applies caught ones, removes missed ones. */
export function updateDrops(w: World, dt: number): void {
  let i = 0;
  const p = w.paddle;
  const pull = w.effects.paperclip !== undefined;
  const segs = paddleSegments(w);
  const gap = w.effects.scissors !== undefined;
  while (i < w.drops.length) {
    const d: Drop = w.drops[i]!;
    d.y += d.vy * dt;
    if (pull && isPositive(d.type) && Math.hypot(d.x - p.x, d.y - (p.y + p.h / 2)) < C.paperclipRange) {
      const dx = p.x - d.x;
      d.x += Math.sign(dx) * Math.min(Math.abs(dx), C.paperclipSpeed * dt);
    }
    const inY = d.y + C.dropH / 2 > p.y && d.y - C.dropH / 2 < p.y + p.h;
    // With the scissors gap open, a capsule centred over the gap falls through.
    const caught =
      inY &&
      !(gap && Math.abs(d.x - p.x) < C.scissorsGap / 2) &&
      segs.some(([l, r]) => d.x + C.dropW / 2 > l && d.x - C.dropW / 2 < r);
    if (caught) {
      w.drops.splice(i, 1);
      w.events.push({ type: 'powerup', x: d.x, y: d.y, power: d.type });
      if (isPositive(d.type)) addScore(w, C.catchBonus, d.x, d.y);
      applyPower(w, d.type);
    } else if (d.y - C.dropH / 2 > w.height) {
      w.drops.splice(i, 1);
      w.events.push({ type: 'powerMiss', x: d.x, y: w.height, power: d.type });
    } else {
      i++;
    }
  }
}

/** Fire press while playing: release glued balls (the stapler fires by itself). */
export function handleFire(w: World): void {
  releaseCaught(w);
}

/** Stapler: while active and playing, shoots 2 staples from the paddle ends every 0.4 s. */
export function updateStapler(w: World, _dt: number): void {
  if (w.effects.stapler === undefined || w.status !== 'playing' || w.stapleCd > 0) return;
  const p = w.paddle;
  const inset = 6;
  w.bolts.push({ x: p.x - p.w / 2 + inset, y: p.y }, { x: p.x + p.w / 2 - inset, y: p.y });
  w.stapleCd = C.staplerInterval;
  w.events.push({ type: 'staple', x: p.x, y: p.y });
}

/** Auto-releases caught balls after catchAutoRelease seconds. */
export function updateCaught(w: World, dt: number): void {
  for (const b of w.balls) {
    if (!b.stuck) continue;
    b.stuckT = (b.stuckT ?? 0) + dt;
    if (b.stuckT >= C.glueAutoRelease) releaseBall(w, b);
  }
}

/** Moves bolts upward; a bolt hitting a brick damages it and disappears (steel absorbs it). */
export function updateBolts(w: World, dt: number): void {
  const keep: typeof w.bolts = [];
  for (const bolt of w.bolts) {
    bolt.y -= C.stapleSpeed * dt;
    if (bolt.y < C.topWall) continue;
    const hit = w.bricks.find(
      (k) => bolt.x >= k.x && bolt.x <= k.x + k.w && bolt.y >= k.y && bolt.y <= k.y + k.h,
    );
    if (!hit) {
      keep.push(bolt);
      continue;
    }
    w.events.push({ type: 'brickHit', x: bolt.x, y: bolt.y, brickId: hit.id });
    damageBrick(w, hit, 1);
  }
  w.bolts = keep;
}

/** Paper plane: each moving ball turns toward the nearest counting brick, keeping its speed. */
export function steerBalls(w: World, dt: number): void {
  if (w.effects.plane === undefined) return;
  const targets = w.bricks.filter(counts);
  if (targets.length === 0) return;
  for (const b of w.balls) {
    if (b.stuck) continue;
    let best: Brick | null = null;
    let bestD = Infinity;
    for (const k of targets) {
      const d = Math.hypot(k.x + k.w / 2 - b.x, k.y + k.h / 2 - b.y);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (!best) continue;
    const want = Math.atan2(best.y + best.h / 2 - b.y, best.x + best.w / 2 - b.x);
    let diff = want - Math.atan2(b.vy, b.vx);
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    rotate(b, clamp(diff, -C.planeTurn * dt, C.planeTurn * dt));
  }
}
