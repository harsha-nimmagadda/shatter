import { CONFIG } from './config';
import { parseLevel, type Level } from './level';

export interface Brick {
  id: number;
  /** Top-left corner and size, logical units. */
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  kind: 'normal' | 'steel';
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
  type: 'launch' | 'wall' | 'paddle' | 'brickHit' | 'brickBreak' | 'lifeLost' | 'won' | 'gameover';
  x: number;
  y: number;
  brickId?: number;
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
}

export interface Input {
  /** Desired paddle centre in logical units; null = no change. */
  paddleX: number | null;
  /** Keyboard / gamepad direction. */
  moveDir: -1 | 0 | 1;
  /** True only on the step the button was pressed. */
  fire: boolean;
}

export function newStuckBall(): Ball {
  return { x: 0, y: 0, vx: 0, vy: 0, r: CONFIG.ballR, stuck: true, stuckOffset: 0 };
}

export function createWorld(
  level: Level,
  opts: { seed?: number; lives?: number; levelIndex?: number } = {},
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
  };
}
