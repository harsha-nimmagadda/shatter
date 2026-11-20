export const POWER_TYPES = [
  'expand', 'shrink', 'multiball', 'fireball', 'catch', 'laser', 'speedup', 'slowdown', 'extralife',
  'killpaddle', 'split', 'through', 'eraser', 'inkblot', 'plane', 'sharpener', 'ruler', 'crumpled', 'stickynote',
] as const;
export type PowerType = (typeof POWER_TYPES)[number];

/** Power-ups that run on a timer (seconds remaining live in world.effects). */
export const EFFECT_NAMES = ['fireball', 'through', 'crumpled', 'catch', 'laser', 'inkblot', 'plane', 'sharpener', 'ruler'] as const;
export type EffectName = (typeof EFFECT_NAMES)[number];

/** All gameplay tunables. Units are logical playfield units (540 x 960) and seconds. */
export const CONFIG = {
  width: 540,
  height: 960,
  /** Y of the top wall (room above for the HUD). Side walls are the playfield edges. */
  topWall: 64,
  paddleW: 96,
  paddleH: 16,
  paddleY: 960 - 90,
  paddleMaxSpeed: 2400,
  paddleKeySpeed: 700,
  ballR: 8,
  startSpeed: 420,
  /** Fractional speed gain per brick break. */
  speedGain: 0.015,
  maxSpeed: 1000,
  /** Max paddle bounce angle from vertical, degrees. */
  maxBounceDeg: 60,
  /** Launch angle spread from vertical, degrees. */
  launchDeg: 20,
  /** Minimum |vy| / speed after a bounce, so the ball never runs flat. */
  minVerticalRatio: 0.3,
  lives: 3,
  brickScore: 10,
  /** Chance that a counting brick drops a capsule. */
  dropChance: 0.15,
  maxDrops: 3,
  dropVy: 140,
  dropW: 36,
  dropH: 20,
  dropWeights: {
    expand: 10, shrink: 5, multiball: 8, fireball: 5, catch: 8, laser: 7, speedup: 5, slowdown: 7, extralife: 3,
    killpaddle: 2, split: 6, through: 4, eraser: 4, inkblot: 4, plane: 5, sharpener: 4, ruler: 5, crumpled: 5,
    stickynote: 5,
  } as Record<PowerType, number>,
  effectSeconds: {
    fireball: 10, through: 8, crumpled: 10, catch: 15, laser: 10, inkblot: 6, plane: 5, sharpener: 10, ruler: 8,
  } as Record<EffectName, number>,
  /** Paddle widths for size levels -2..+2. */
  paddleWidths: [64, 80, 96, 128, 160],
  sharpenerMul: 0.7,
  rulerMul: 1.8,
  rulerMaxBounceDeg: 25,
  inkblotSpeedMul: 0.5,
  maxBalls: 8,
  maxLives: 9,
  multiballDeg: 20,
  splitDeg: 12,
  slowdownFloor: 0.7,
  catchAutoRelease: 3,
  laserSpeed: 900,
  laserCooldown: 0.25,
  planeTurn: 3,
  /** Sticky-note net: ball bottom bounces at height - netInset. */
  netInset: 24,
  explosionRx: 75,
  explosionRy: 39,
  explosionDelay: 0.08,
  movingSpeed: 50,
  regenDelay: 6,
  regenRetry: 0.5,
} as const;
