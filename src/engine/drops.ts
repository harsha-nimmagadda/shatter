import { CONFIG as C, POWER_TYPES, type PowerType } from './config';
import { createRng } from './rng';
import type { Brick, World } from './state';

/** Maybe spawns a falling capsule at the centre of a just-broken counting brick. */
export function maybeDrop(w: World, k: Brick): void {
  if (w.drops.length >= C.maxDrops) return;
  const rng = createRng(w.rng);
  let type: PowerType | null = null;
  if (rng.next() < w.dropChance) type = w.forcedPower ?? pickPower(rng.next());
  w.rng = rng.state;
  if (!type) return;
  w.drops.push({ id: w.nextId++, type, x: k.x + k.w / 2, y: k.y + k.h / 2, vy: C.dropVy });
}

/** Weighted pick; `r` in [0, 1). */
export function pickPower(r: number): PowerType {
  let total = 0;
  for (const t of POWER_TYPES) total += C.dropWeights[t];
  let acc = r * total;
  for (const t of POWER_TYPES) {
    acc -= C.dropWeights[t];
    if (acc < 0) return t;
  }
  return POWER_TYPES[POWER_TYPES.length - 1]!;
}
