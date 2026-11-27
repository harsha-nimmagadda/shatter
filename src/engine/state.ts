import { CONFIG, type EffectName, type PowerType } from './config';
import { parseLevel, type Level } from './level';

export type BrickType = 'normal' | 'steel' | 'explosive' | 'moving' | 'regen' | 'hidden';

export interface Brick {
  id: number;
  /** Top-left corner and size, logical units. */
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  /** Coarse kind: 'steel' = indestructible, everything else 'normal'. Kept for the renderer. */
  kind: 'normal' | 'steel';
  /** Full brick type (see level.ts for the level characters). */
  type: BrickType;
  /** Horizontal velocity (moving bricks only, else 0). */
  vx: number;
  /** True until a hidden brick has been hit once; renderers must not draw it. */
  hidden: boolean;
  /** Metal clips only: ball hits since the last breakable-brick damage (anti-softlock). */
  streakHits: number;
  /** Hash of (level, row, col) for the hand-drawn renderer. */
  seed: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Resting on the paddle at paddle.x + stuckOffset before launch. */
  stuck: boolean;
  stuckOffset: number;
  /** Seconds spent stuck to the paddle by 'gluestick' (auto-release timer). */
  stuckT?: number;
}

export interface Drop {
  id: number;
  type: PowerType;
  /** Centre. */
  x: number;
  y: number;
  vy: number;
}

export interface Bolt {
  x: number;
  y: number;
}

/** A destroyed regenerating brick waiting to re-form. */
export interface Ghost {
  brick: Brick;
  /** Seconds until the next re-form attempt. */
  timer: number;
}

/** An explosive brick that will detonate at world.time >= at (chain delay). */
export interface PendingBlast {
  brickId: number;
  at: number;
}

export interface Paddle {
  /** Centre x. */
  x: number;
  /** Top y. */
  y: number;
  w: number;
  h: number;
}

export interface GameEvent {
  type:
    | 'launch' | 'wall' | 'paddle' | 'brickHit' | 'brickBreak' | 'lifeLost' | 'won' | 'gameover'
    | 'explode' | 'regen' | 'reveal' | 'powerup' | 'powerMiss' | 'effectEnd' | 'staple' | 'eraser' | 'net'
    | 'splash' | 'extraLife' | 'combo' | 'clipPop' | 'clipLoose';
  x: number;
  y: number;
  brickId?: number;
  /** Power-up type ('powerup', 'powerMiss') or effect name ('effectEnd'). */
  power?: PowerType | EffectName;
  /** 'combo': the new multiplier. */
  value?: number;
}

export interface World {
  width: number;
  height: number;
  paddle: Paddle;
  balls: Ball[];
  bricks: Brick[];
  score: number;
  lives: number;
  status: 'serve' | 'playing' | 'won' | 'gameover';
  /** Current ball speed. */
  speed: number;
  /** PRNG state (see rng.ts). */
  rng: number;
  events: GameEvent[];
  time: number;
  drops: Drop[];
  bolts: Bolt[];
  ghosts: Ghost[];
  blasts: PendingBlast[];
  /** Seconds remaining per timed effect. */
  effects: Partial<Record<EffectName, number>>;
  /** Sticky-note safety net armed. */
  net: boolean;
  /** Seconds until the stapler fires its next volley. */
  stapleCd: number;
  /** Bricks broken since any ball last touched the paddle. */
  combo: number;
  /** Ball hits on metal clips since the last breakable-brick damage. */
  clipStreak: number;
  /** Seconds of play since a breakable brick was last damaged (anti-stall nudge). */
  stallT: number;
  /** Score at which the next extra life is awarded. */
  nextLifeAt: number;
  nextId: number;
  /** Chance per counting brick break to drop a capsule. */
  dropChance: number;
  /** Debug: every drop is this power. */
  forcedPower: PowerType | null;
  /** Power-up whose drop weight is doubled on this level (campaign levels that introduce one). */
  featured: PowerType | null;
}

export interface Input {
  /** Desired paddle centre in logical units; null = no change. */
  paddleX: number | null;
  /** Keyboard / gamepad direction, analog in [-1, 1]. */
  moveAxis: number;
  /** True only on the step the button was pressed. */
  fire: boolean;
}

export function newStuckBall(): Ball {
  return { x: 0, y: 0, vx: 0, vy: 0, r: CONFIG.ballR, stuck: true, stuckOffset: 0 };
}

export function createWorld(
  level: Level,
  opts: {
    seed?: number;
    lives?: number;
    /** Score carried in from earlier campaign levels (extra lives continue from the next 10,000). */
    score?: number;
    levelIndex?: number;
    forcedPower?: PowerType;
    featured?: PowerType;
    dropChance?: number;
  } = {},
): World {
  const paddle = { x: CONFIG.width / 2, y: CONFIG.paddleY, w: CONFIG.paddleW, h: CONFIG.paddleH };
  const ball = newStuckBall();
  ball.x = paddle.x;
  ball.y = paddle.y - ball.r;
  return {
    width: CONFIG.width,
    height: CONFIG.height,
    paddle,
    balls: [ball],
    bricks: parseLevel(level, opts.levelIndex ?? 0),
    score: opts.score ?? 0,
    lives: opts.lives ?? CONFIG.lives,
    status: 'serve',
    speed: CONFIG.startSpeed,
    rng: (opts.seed ?? 1) >>> 0,
    events: [],
    time: 0,
    drops: [],
    bolts: [],
    ghosts: [],
    blasts: [],
    effects: {},
    net: false,
    stapleCd: 0,
    combo: 0,
    clipStreak: 0,
    stallT: 0,
    nextLifeAt: (Math.floor((opts.score ?? 0) / CONFIG.extraLifeEvery) + 1) * CONFIG.extraLifeEvery,
    nextId: 1,
    dropChance: opts.dropChance ?? (opts.forcedPower ? 1 : CONFIG.dropChance),
    forcedPower: opts.forcedPower ?? null,
    featured: opts.featured ?? null,
  };
}
