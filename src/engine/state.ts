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
  /** Seconds spent stuck to the paddle by 'catch' (auto-release timer). */
  stuckT?: number;
  /** Ids of bricks currently overlapped by a 'through' ball (damage once per pass). */
  overlap?: number[];
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
    | 'explode' | 'regen' | 'reveal' | 'powerup' | 'powerMiss' | 'effectEnd' | 'laser' | 'eraser' | 'net';
  x: number;
  y: number;
  brickId?: number;
  /** Power-up type ('powerup', 'powerMiss') or effect name ('effectEnd'). */
  power?: PowerType | EffectName;
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
  /** Paddle size level, -2..+2. */
  paddleLevel: number;
  /** Sticky-note safety net armed. */
  net: boolean;
  /** Seconds until the laser may fire again. */
  laserCd: number;
  nextId: number;
  /** Chance per counting brick break to drop a capsule. */
  dropChance: number;
  /** Debug: every drop is this power. */
  forcedPower: PowerType | null;
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
  opts: { seed?: number; lives?: number; levelIndex?: number; forcedPower?: PowerType; dropChance?: number } = {},
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
    score: 0,
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
    paddleLevel: 0,
    net: false,
    laserCd: 0,
    nextId: 1,
    dropChance: opts.dropChance ?? (opts.forcedPower ? 1 : CONFIG.dropChance),
    forcedPower: opts.forcedPower ?? null,
  };
}
