import { CONFIG, EFFECT_NAMES, POWER_CATEGORY, type EffectName, type PowerCategory, type PowerType } from '../engine';

/** Pure helpers for the power-up visuals (no canvas), so they can be unit tested in Node. */

export const BAD_POWERS: ReadonlySet<string> = new Set(['sharpener', 'scissors', 'redpen']);
export const isBadPower = (type: string): boolean => BAD_POWERS.has(type);

/** Ring colour of a capsule badge per category: ball blue, paddle green, utility gold, hazard red. */
export const CATEGORY_COLORS: Record<PowerCategory, string> = {
  ball: '#00E5FF',
  paddle: '#39FF14',
  utility: '#F2B705',
  hazard: '#FF3B5C',
};

export function categoryColor(type: string): string {
  const cat = (POWER_CATEGORY as Record<string, PowerCategory | undefined>)[type];
  return CATEGORY_COLORS[cat ?? 'ball'];
}

export type CapsuleShape = 'circle' | 'square' | 'hexagon' | 'saw';

/** Badge outline per category so the categories also differ by shape (colour-blind friendly): ball circle, paddle rounded square, utility hexagon, hazard spiky saw. */
export const CATEGORY_SHAPES: Record<PowerCategory, CapsuleShape> = { ball: 'circle', paddle: 'square', utility: 'hexagon', hazard: 'saw' };

export function capsuleShape(type: string): CapsuleShape {
  const cat = (POWER_CATEGORY as Record<string, PowerCategory | undefined>)[type];
  return CATEGORY_SHAPES[cat ?? 'ball'];
}

/** One-line effect text per power-up (3-5 words) for the catch callout. */
export const POWER_EFFECTS: Record<PowerType, string> = {
  photocopy: '3 balls!',
  crumpled: 'Smash through bricks!',
  plane: 'Balls home in',
  highlighter: 'Hits splash neighbours',
  correction: 'Ball slows down',
  ruler: 'Paddle is wider',
  gluestick: 'Ball sticks, tap to launch',
  stapler: 'Paddle shoots lasers',
  eraser: 'Wipes a row of bricks',
  goldstar: 'Extra life!',
  paperclip: 'Pulls power-ups in',
  stickynote: 'Safety net under you',
  sharpener: 'Paddle shrinks!',
  scissors: 'Paddle splits in two!',
  redpen: 'Ball goes much faster!',
};
export const powerEffect = (type: string): string => (POWER_EFFECTS as Record<string, string>)[type] ?? '';

/** Highlighter trail colour behind a ball for the active ball effects. */
export const TRAIL_COLORS = { highlighter: '#39FF14', crumpled: '#FF7A1A', plane: '#00E5FF', redpen: '#FF3B5C', none: '#7FD8FF' } as const;

/** Light-trail colour behind a ball for the active ball effect (Meteor wins, then Overdrive, Splash, Homing). */
export function trailColor(eff: Partial<Record<string, number>>): { color: string; alpha: number } {
  if (eff.crumpled !== undefined) return { color: TRAIL_COLORS.crumpled, alpha: 0.75 };
  if (eff.redpen !== undefined) return { color: TRAIL_COLORS.redpen, alpha: 0.7 };
  if (eff.highlighter !== undefined) return { color: TRAIL_COLORS.highlighter, alpha: 0.65 };
  if (eff.plane !== undefined) return { color: TRAIL_COLORS.plane, alpha: 0.65 };
  return { color: TRAIL_COLORS.none, alpha: 0.5 };
}

/** Display names (neon re-theme). Engine ids stay the stationery ones from SPEC.md. */
export const POWER_NAMES: Record<PowerType, string> = {
  photocopy: 'TRIPLE BALL',
  crumpled: 'METEOR',
  plane: 'HOMING',
  highlighter: 'SPLASH',
  correction: 'SLOW-MO',
  ruler: 'WIDE',
  gluestick: 'STICKY',
  stapler: 'LASERS',
  eraser: 'WIPE',
  goldstar: '1-UP',
  paperclip: 'MAGNET',
  stickynote: 'SHIELD',
  sharpener: 'SHRINK',
  scissors: 'SPLIT',
  redpen: 'OVERDRIVE ×2',
};

export const powerName = (type: string): string => (POWER_NAMES as Record<string, string>)[type] ?? 'POWER!';
export const powerLetter = (type: string): string => (type[0] ?? '?').toUpperCase();

export const FLOAT_LIFE = 0.9;
export const FLOAT_RISE = 54;

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

/** Floating combo label for a multiplier: 1.5 -> "×1.5", 2 -> "×2". */
export const comboLabel = (value: number): string => `×${Number.isInteger(value) ? value : value.toFixed(1)}`;

/** HUD combo text ("×2.0 COMBO"); empty at 1x so the HUD hides it. */
export const comboHudText = (mul: number): string => (mul > 1 ? `×${Number.isInteger(mul) ? mul : mul.toFixed(1)} COMBO` : '');

/** Combo tier 0..3 for a multiplier (1, 1.5, 2, 3). */
export const comboTier = (mul: number): number => (mul >= 3 ? 3 : mul >= 2 ? 2 : mul > 1 ? 1 : 0);

/** Visual brick tilt (radians) of a loose metal clip, shaking slightly; 0 while it is still firmly fixed. */
export function clipTilt(streakHits: number, time: number, id: number): number {
  if (streakHits < CONFIG.clipLooseHits) return 0;
  return 0.07 + Math.sin(time * 42 + id * 1.7) * 0.025;
}

/** Fraction of an effect's duration still left, 0..1. */
export function effectFraction(name: EffectName, left: number): number {
  return Math.max(0, Math.min(1, left / CONFIG.effectSeconds[name]));
}

export { EFFECT_NAMES };
