export const POWER_TYPES = [
  'photocopy', 'crumpled', 'plane', 'highlighter', 'correction', 'ruler', 'gluestick', 'stapler', 'eraser',
  'goldstar', 'paperclip', 'stickynote', 'sharpener', 'scissors', 'redpen',
] as const;
export type PowerType = (typeof POWER_TYPES)[number];

export type PowerCategory = 'ball' | 'paddle' | 'utility' | 'hazard';

/** Badge colour category: ball = blue, paddle = green, utility = gold, hazard = red. */
export const POWER_CATEGORY: Record<PowerType, PowerCategory> = {
  photocopy: 'ball', crumpled: 'ball', plane: 'ball', highlighter: 'ball', correction: 'ball',
  ruler: 'paddle', gluestick: 'paddle', stapler: 'paddle',
  eraser: 'utility', goldstar: 'utility', paperclip: 'utility', stickynote: 'utility',
  sharpener: 'hazard', scissors: 'hazard', redpen: 'hazard',
};

/** Positive power-ups give +50 when caught; hazards do not. */
export const isPositive = (type: PowerType): boolean => POWER_CATEGORY[type] !== 'hazard';

/** Power-ups that run on a timer (seconds remaining live in world.effects). */
export const EFFECT_NAMES = [
  'crumpled', 'plane', 'highlighter', 'correction', 'ruler', 'gluestick', 'stapler', 'paperclip', 'sharpener', 'scissors', 'redpen',
] as const;
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
  speedGain: 0.012,
  maxSpeed: 900,
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
    photocopy: 8, crumpled: 6, plane: 5, highlighter: 6, correction: 7, ruler: 8, gluestick: 7, stapler: 7,
    eraser: 4, goldstar: 3, paperclip: 5, stickynote: 5, sharpener: 4, scissors: 3, redpen: 5,
  } as Record<PowerType, number>,
  effectSeconds: {
    crumpled: 10, plane: 5, highlighter: 10, correction: 10, ruler: 8, gluestick: 12, stapler: 10, paperclip: 12, sharpener: 10,
    scissors: 8, redpen: 10,
  } as Record<EffectName, number>,
  sharpenerMul: 0.7,
  rulerW: 160,
  rulerMaxBounceDeg: 40,
  scissorsGap: 24,
  staplerInterval: 0.4,
  paperclipRange: 220,
  paperclipSpeed: 260,
  redpenMul: 1.25,
  correctionMul: 0.7,
  catchBonus: 50,
  winLifeBonus: 250,
  extraLifeEvery: 10000,
  /** Combo multiplier steps: [min breaks, multiplier], highest first. */
  comboSteps: [[9, 3], [6, 2], [3, 1.5]] as readonly (readonly [number, number])[],
  clipPopStreak: 10,
  clipLooseHits: 3,
  maxBalls: 8,
  maxLives: 9,
  photocopyDeg: 20,
  correctionFloor: 0.7,
  glueAutoRelease: 3,
  stapleSpeed: 900,
  planeTurn: 3,
  /** Anti-stall: after this many seconds of play with no breakable brick damaged, paddle bounces lean toward the bricks. */
  stallAssistSec: 15,
  /** Max lean of a paddle bounce toward the nearest counting brick when the nudge starts, degrees... */
  stallNudgeDeg: 15,
  /** ...growing this many degrees per further second of stall... */
  stallNudgeGrowth: 1,
  /** ...up to this cap. */
  stallNudgeMaxDeg: 35,
  /** Sticky-note net: ball bottom bounces at height - netInset. */
  netInset: 24,
  explosionRx: 75,
  explosionRy: 39,
  explosionDelay: 0.08,
  movingSpeed: 50,
  regenDelay: 6,
  regenRetry: 0.5,
} as const;
