import { describe, it, expect } from 'vitest';
import { CONFIG, LEVEL_1, createWorld, drainEvents, step, type Brick, type Input, type World } from '../src/engine';

const DT = 1 / 120;
const NONE: Input = { paddleX: null, moveAxis: 0, fire: false };
const FIRE: Input = { ...NONE, fire: true };

function brick(id: number, x: number, y: number, hp = 3, kind: 'normal' | 'steel' = 'normal'): Brick {
  return { id, x, y, w: 48, h: 24, hp, maxHp: hp, kind, seed: id };
}

/** Playing world with one ball and the given bricks (a far-away dummy keeps the level from winning). */
function setup(ball: { x: number; y: number; vx: number; vy: number }, bricks: Brick[] = []): World {
  const w = createWorld(LEVEL_1, { seed: 7 });
  w.status = 'playing';
  w.bricks = [brick(99, 20, 300), ...bricks];
  w.balls = [{ ...ball, r: CONFIG.ballR, stuck: false, stuckOffset: 0 }];
  return w;
}

const angleDeg = (vx: number, vy: number): number => (Math.atan2(vx, -vy) * 180) / Math.PI;

describe('collisions', () => {
  it('does not tunnel at max speed', () => {
    const k = brick(1, 250, 200, 3);
    const w = setup({ x: 274, y: 700, vx: 0, vy: -1000 }, [k]);
    w.speed = 1000;
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      step(w, NONE, DT);
      hit = w.events.some((e) => e.type === 'brickHit' && e.brickId === 1);
    }
    expect(hit).toBe(true);
    expect(w.balls[0]!.vy).toBeGreaterThan(0);
    expect(w.balls[0]!.y).toBeGreaterThan(k.y + k.h);
  });

  it('treats the seam between adjacent bricks as a flat face', () => {
    const a = brick(1, 100, 200);
    const b = brick(2, 148, 200);
    const w = setup({ x: 148, y: 230, vx: 0, vy: -420 }, [a, b]);
    step(w, NONE, DT);
    const ball = w.balls[0]!;
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBeCloseTo(420);
    expect(a.hp + b.hp).toBe(5);
  });

  it('keeps vx on a near-seam hit', () => {
    const a = brick(1, 100, 200);
    const b = brick(2, 148, 200);
    const w = setup({ x: 148, y: 230, vx: 30, vy: -400 }, [a, b]);
    step(w, NONE, DT);
    expect(w.balls[0]!.vx).toBeCloseTo(30);
    expect(w.balls[0]!.vy).toBeCloseTo(400);
    expect(a.hp + b.hp).toBe(5);
  });

  it('uses a diagonal normal on a true corner hit', () => {
    const k = brick(1, 100, 200);
    const w = setup({ x: 94, y: 194, vx: 300, vy: 300 }, [k]);
    step(w, NONE, DT);
    const ball = w.balls[0]!;
    expect(ball.vx).toBeCloseTo(-300, 3);
    expect(ball.vy).toBeCloseTo(-300, 3);
  });

  it('enforces the minimum vertical ratio after a bounce', () => {
    const w = setup({ x: 10, y: 500, vx: -419, vy: -5 });
    step(w, NONE, DT);
    const b = w.balls[0]!;
    const speed = Math.hypot(b.vx, b.vy);
    expect(b.vx).toBeGreaterThan(0);
    expect(Math.abs(b.vy)).toBeGreaterThanOrEqual(CONFIG.minVerticalRatio * speed - 1e-9);
    expect(b.vy).toBeLessThan(0);
    expect(speed).toBeCloseTo(Math.hypot(419, 5));
  });

  it('steel bricks are hit but never damaged', () => {
    const s = brick(1, 100, 200, 1, 'steel');
    const w = setup({ x: 124, y: 230, vx: 0, vy: -420 }, [s]);
    step(w, NONE, DT);
    expect(w.bricks).toContain(s);
    expect(w.events.some((e) => e.type === 'brickHit')).toBe(true);
    expect(w.balls[0]!.vy).toBeGreaterThan(0);
  });
});

describe('paddle', () => {
  const hit = (offset: number): World => {
    const w = setup({ x: 0, y: 0, vx: 0, vy: 420 });
    const p = w.paddle;
    Object.assign(w.balls[0]!, { x: p.x + offset * (p.w / 2), y: p.y - CONFIG.ballR + 1 });
    step(w, NONE, DT);
    return w;
  };

  it('centre hit goes straight up', () => {
    const b = hit(0).balls[0]!;
    expect(b.vx).toBeCloseTo(0);
    expect(b.vy).toBeCloseTo(-420);
  });

  it('edge hits go ~60 degrees with speed preserved', () => {
    for (const side of [1, -1]) {
      const b = hit(side).balls[0]!;
      expect(angleDeg(b.vx, b.vy)).toBeCloseTo(side * 60, 3);
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(420);
    }
  });
});

describe('serve and lives', () => {
  it('ball follows the paddle, then launches within 20 degrees', () => {
    const w = createWorld(LEVEL_1, { seed: 3 });
    step(w, { ...NONE, paddleX: 300 }, 0.5);
    expect(w.paddle.x).toBe(300);
    expect(w.balls[0]!.x).toBe(300);
    expect(w.balls[0]!.y).toBe(w.paddle.y - CONFIG.ballR);
    step(w, FIRE, DT);
    const b = w.balls[0]!;
    expect(w.status).toBe('playing');
    expect(b.stuck).toBe(false);
    expect(Math.abs(angleDeg(b.vx, b.vy))).toBeLessThanOrEqual(20 + 1e-9);
    expect(b.vy).toBeLessThan(0);
    expect(w.events.some((e) => e.type === 'launch')).toBe(true);
  });

  it('paddle moves by keyboard and stays inside walls', () => {
    const w = createWorld(LEVEL_1);
    step(w, { ...NONE, moveAxis: -1 }, 1);
    expect(w.paddle.x).toBe(CONFIG.paddleW / 2);
    step(w, { ...NONE, paddleX: 5000 }, 1);
    expect(w.paddle.x).toBe(CONFIG.width - CONFIG.paddleW / 2);
  });

  it('losing the ball costs a life and returns to serve', () => {
    const w = setup({ x: 50, y: 980, vx: 0, vy: 100 });
    w.speed = 800;
    step(w, NONE, DT);
    expect(w.lives).toBe(2);
    expect(w.status).toBe('serve');
    expect(w.balls).toHaveLength(1);
    expect(w.balls[0]!.stuck).toBe(true);
    expect(w.speed).toBe(CONFIG.startSpeed);
  });

  it('last life ends the game', () => {
    const w = setup({ x: 50, y: 980, vx: 0, vy: 100 });
    w.lives = 1;
    step(w, NONE, DT);
    expect(w.status).toBe('gameover');
    expect(w.events.map((e) => e.type)).toEqual(expect.arrayContaining(['lifeLost', 'gameover']));
    const x = w.paddle.x;
    step(w, { ...FIRE, moveAxis: 1 }, DT);
    expect(w.status).toBe('gameover');
    expect(w.paddle.x).toBeGreaterThan(x);
  });
});

describe('bricks and winning', () => {
  it('breaking a brick scores, speeds up, and caps at max speed', () => {
    const w = setup({ x: 124, y: 230, vx: 0, vy: -420 }, [brick(1, 100, 200, 2)]);
    for (let i = 0; i < 2; i++) {
      Object.assign(w.balls[0]!, { x: 124, y: 230, vx: 0, vy: -w.speed });
      step(w, NONE, DT);
    }
    expect(w.bricks.some((k) => k.id === 1)).toBe(false);
    expect(w.score).toBe(20);
    expect(w.speed).toBeCloseTo(420 * (1 + CONFIG.speedGain));
    expect(Math.hypot(w.balls[0]!.vx, w.balls[0]!.vy)).toBeCloseTo(w.speed);

    const c = setup({ x: 124, y: 230, vx: 0, vy: -995 }, [brick(1, 100, 200, 1)]);
    c.speed = 995;
    step(c, NONE, DT);
    expect(c.speed).toBe(CONFIG.maxSpeed);
  });

  it('wins when only steel remains', () => {
    const w = setup({ x: 124, y: 230, vx: 0, vy: -420 }, [brick(1, 100, 200, 1), brick(2, 300, 200, 1, 'steel')]);
    w.bricks = w.bricks.filter((k) => k.id !== 99);
    step(w, NONE, DT);
    expect(w.status).toBe('won');
    expect(w.events.some((e) => e.type === 'won')).toBe(true);
    expect(w.bricks).toHaveLength(1);
  });
});

describe('determinism and events', () => {
  const run = (): World => {
    const w = createWorld(LEVEL_1, { seed: 42 });
    for (let i = 0; i < 4000; i++) {
      const input: Input = {
        paddleX: 270 + 200 * Math.sin(i / 90),
        moveAxis: 0,
        fire: i % 300 === 0,
      };
      step(w, input, DT);
    }
    return w;
  };

  it('same seed and inputs give identical state', () => {
    expect(run()).toEqual(run());
  });

  it('different seeds diverge', () => {
    const a = createWorld(LEVEL_1, { seed: 1 });
    const b = createWorld(LEVEL_1, { seed: 2 });
    step(a, FIRE, DT);
    step(b, FIRE, DT);
    expect(a.balls[0]!.vx).not.toBe(b.balls[0]!.vx);
  });

  it('drainEvents returns and clears', () => {
    const w = createWorld(LEVEL_1);
    step(w, FIRE, DT);
    step(w, NONE, DT);
    const ev = drainEvents(w);
    expect(ev.map((e) => e.type)).toContain('launch');
    expect(w.events).toHaveLength(0);
    expect(drainEvents(w)).toEqual([]);
  });
});
