import { CONFIG, EFFECT_NAMES, type EffectName, type PowerType } from '../engine';

/** Pure helpers for the power-up visuals (no canvas), so they can be unit tested in Node. */

/** Engine power type -> manifest icon id. null = no art, draw procedurally. */
export const ICON_IDS: Record<PowerType, string | null> = {
  // TODO(render-revamp): real icons for the revamp power-ups; these reuse the old art.
  photocopy: 'icon-multiball',
  crumpled: 'icon-crumpled',
  plane: 'icon-paper-plane',
  highlighter: null,
  correction: 'icon-slowdown',
  ruler: 'icon-ruler',
  gluestick: 'icon-catch',
  stapler: 'icon-laser',
  eraser: 'icon-eraser',
  goldstar: 'icon-extra-life',
  paperclip: null,
  stickynote: 'icon-sticky-note',
  sharpener: 'icon-sharpener',
  scissors: 'icon-kill-paddle',
  redpen: 'icon-speedup',
};

export type IconSource = 'art' | 'arrows' | 'doodle';

/** Which drawing to use for a power: art if the id exists, else a lettered doodle. 'arrows' is unused now. */
export function resolveIcon(type: string, hasArt: (id: string) => boolean): { source: IconSource; id: string | null } {
  const id = (ICON_IDS as Record<string, string | null>)[type] ?? null;
  if (id && hasArt(id)) return { source: 'art', id };
  return { source: 'doodle', id: null };
}

export const BAD_POWERS: ReadonlySet<string> = new Set(['sharpener', 'scissors', 'redpen']);
export const isBadPower = (type: string): boolean => BAD_POWERS.has(type);

export const POWER_NAMES: Record<PowerType, string> = {
  photocopy: 'Photocopy!',
  crumpled: 'Crumpled!',
  plane: 'Paper plane!',
  highlighter: 'Highlighter!',
  correction: 'Correction tape',
  ruler: 'Ruler!',
  gluestick: 'Glue stick!',
  stapler: 'Stapler!',
  eraser: 'Eraser!',
  goldstar: 'Gold star!',
  paperclip: 'Paperclip!',
  stickynote: 'Sticky note!',
  sharpener: 'Sharpened!',
  scissors: 'Snip!',
  redpen: 'Red pen!',
};

export const powerName = (type: string): string => (POWER_NAMES as Record<string, string>)[type] ?? 'Power!';
export const powerLetter = (type: string): string => (type[0] ?? '?').toUpperCase();

export const FLOAT_LIFE = 0.8;
export const FLOAT_RISE = 46;

/** Floating text state at `age` seconds: alpha 1 -> 0 (fading over the last 60%), rising with ease-out. */
export function floatTextState(age: number, life = FLOAT_LIFE): { alpha: number; rise: number; done: boolean } {
  if (age >= life) return { alpha: 0, rise: FLOAT_RISE, done: true };
  const t = Math.max(0, age) / life;
  const alpha = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
  const rise = FLOAT_RISE * (1 - (1 - t) * (1 - t));
  return { alpha, rise, done: false };
}

/** Time constant for the paddle width animation (about 0.15 s to settle). */
export const PADDLE_TAU = 0.05;

/** Exponential approach of `cur` to `target`; snaps when within 0.25 units. */
export function lerpTowards(cur: number, target: number, dt: number, tau = PADDLE_TAU): number {
  const d = target - cur;
  if (Math.abs(d) < 0.25) return target;
  return cur + d * (1 - Math.exp(-Math.max(0, dt) / tau));
}

export interface XY {
  x: number;
  y: number;
}

/**
 * Interpolated draw position of ball i. Interpolates by index only when the ball count is unchanged since the
 * snapshot and the ball is moving normally; otherwise (count changed, stuck, teleport) uses the current position.
 */
export function ballRenderPos(
  prev: readonly XY[],
  i: number,
  count: number,
  cur: XY,
  stuck: boolean,
  alpha: number,
  out: XY,
): XY {
  const pv = prev[i];
  if (stuck || prev.length !== count || !pv || Math.hypot(cur.x - pv.x, cur.y - pv.y) > 120) {
    out.x = cur.x;
    out.y = cur.y;
  } else {
    out.x = pv.x + (cur.x - pv.x) * alpha;
    out.y = pv.y + (cur.y - pv.y) * alpha;
  }
  return out;
}

/** Copies ball positions into `buf`, reusing its objects (only allocates when the ball count grows). */
export function snapshotBalls(balls: readonly XY[], buf: XY[]): XY[] {
  for (let i = 0; i < balls.length; i++) {
    const b = buf[i];
    if (b) {
      b.x = balls[i].x;
      b.y = balls[i].y;
    } else buf[i] = { x: balls[i].x, y: balls[i].y };
  }
  buf.length = balls.length;
  return buf;
}

/** Fraction of an effect's duration still left, 0..1. */
export function effectFraction(name: EffectName, left: number): number {
  return Math.max(0, Math.min(1, left / CONFIG.effectSeconds[name]));
}

export { EFFECT_NAMES };
