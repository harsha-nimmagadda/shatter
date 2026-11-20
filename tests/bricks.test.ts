import { describe, it, expect } from 'vitest';
import {
  CONFIG, LEVEL_1, TEST_LEVELS, createWorld, parseLevel, step,
  type Brick, type BrickType, type Input, type World,
} from '../src/engine';

const DT = 1 / 120;
const NONE: Input = { paddleX: null, moveAxis: 0, fire: false };

function mk(id: number, x: number, y: number, type: BrickType = 'normal', hp = 1): Brick {
  const h = type === 'hidden' ? 2 : hp;
  return {
    id, x, y, w: 48, h: 24, hp: h, maxHp: h, kind: type === 'steel' ? 'steel' : 'normal', type,
    vx: type === 'moving' ? CONFIG.movingSpeed : 0, hidden: type === 'hidden', streakHits: 0, seed: id,
  };
}

/** Playing world; ball parked far away unless given. A steel brick keeps the level from being won. */
function world(bricks: Brick[], ball = { x: 270, y: 700, vx: 0, vy: 0 }): World {
  const w = createWorld(LEVEL_1, { seed: 5, dropChance: 0 });
  w.status = 'playing';
  w.bricks = [mk(900, 400, 600, 'steel'), ...bricks];
  w.balls = [{ ...ball, r: CONFIG.ballR, stuck: false, stuckOffset: 0 }];
  return w;
}

/** Ball directly below a brick, flying up into it. */
const shoot = (k: Brick) => ({ x: k.x + k.w / 2, y: k.y + k.h + 6, vx: 0, vy: -420 });
const run = (w: World, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 120); i++) step(w, NONE, DT);
};
const ids = (w: World): number[] => w.bricks.map((k) => k.id);
const count = (w: World, t: string): number => w.events.filter((e) => e.type === t).length;

describe('level parsing', () => {
  it('parses the new characters', () => {
    const b = parseLevel({ name: 't', rows: ['xmrh......'] }, 0);
    expect(b.map((k) => k.type)).toEqual(['explosive', 'moving', 'regen', 'hidden']);
    expect(b[1]!.vx).toBe(50);
    expect(b[3]).toMatchObject({ hidden: true, hp: 2, maxHp: 2 });
    expect(b.every((k) => k.kind === 'normal')).toBe(true);
  });

  it('all test levels parse', () => {
    for (const name of ['explosive', 'moving', 'regen', 'hidden', 'mixed']) {
      expect(parseLevel(TEST_LEVELS[name]!, 0).length).toBeGreaterThan(3);
    }
  });
});

describe('explosive bricks', () => {
  it('destroys the 3x3 neighbourhood but not bricks two cells away, and not steel', () => {
    const x = mk(1, 200, 200, 'explosive');
    const near = [mk(2, 250, 200), mk(3, 150, 200), mk(4, 200, 174), mk(5, 250, 174, 'normal', 3)];
    const far = [mk(6, 300, 200), mk(7, 200, 122)];
    const steel = mk(8, 150, 174, 'steel');
    const w = world([x, ...near, ...far, steel], shoot(x));
    step(w, NONE, DT);
    expect(count(w, 'explode')).toBe(1);
    expect(ids(w)).toEqual(expect.arrayContaining([6, 7, 8]));
    for (const k of near) expect(ids(w)).not.toContain(k.id);
    expect(ids(w)).not.toContain(1);
  });

  it('chains with a 0.08 s delay per link', () => {
    const a = mk(1, 200, 200, 'explosive');
    const b = mk(2, 250, 200, 'explosive');
    const c = mk(3, 300, 200, 'explosive');
    const w = world([a, b, c], shoot(a));
    step(w, NONE, DT);
    expect(count(w, 'explode')).toBe(1);
    expect(ids(w)).toContain(2);
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      step(w, NONE, DT);
      for (const e of w.events) if (e.type === 'explode' && e.brickId !== 1) times.push(w.time);
      w.events = [];
    }
    expect(times).toHaveLength(2);
    expect(times[0]!).toBeGreaterThanOrEqual(0.08 - 1e-9);
    expect(times[0]!).toBeLessThan(0.08 + 2 * DT);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(0.08 - DT);
    expect(times[1]! - times[0]!).toBeLessThan(0.08 + 2 * DT);
    expect(ids(w)).toEqual([900]);
  });

  it('counts for winning while queued', () => {
    const a = mk(1, 200, 200, 'explosive');
    const b = mk(2, 250, 200, 'explosive');
    const w = world([a, b], shoot(a));
    step(w, NONE, DT);
    expect(w.status).toBe('playing');
    run(w, 0.2);
    expect(w.status).toBe('won');
  });
});

describe('moving bricks', () => {
  it('slides at 50 u/s and reverses at the wall', () => {
    const m = mk(1, 480, 200, 'moving');
    const w = world([m]);
    run(w, 0.2);
    expect(m.vx).toBe(50);
    expect(m.x).toBeCloseTo(490, 0);
    run(w, 0.1);
    expect(m.vx).toBe(-50);
    expect(m.x + m.w).toBeLessThanOrEqual(540);
    run(w, 1);
    expect(m.x).toBeLessThan(470);
  });

  it('reverses at another brick in its row, and moves at exactly 50 u/s', () => {
    const m = mk(1, 100, 200, 'moving');
    const stop = mk(2, 200, 200, 'steel');
    const w = world([m, stop]);
    run(w, 1);
    expect(m.x).toBeCloseTo(150, 0);
    run(w, 0.5);
    expect(m.vx).toBe(-50);
    expect(m.x).toBeLessThan(152);
    expect(m.x + m.w).toBeLessThanOrEqual(stop.x);
  });

  it('still collides with the ball', () => {
    const m = mk(1, 200, 200, 'moving');
    const w = world([m, mk(2, 100, 300)], shoot(m));
    step(w, NONE, DT);
    expect(ids(w)).not.toContain(1);
    expect(w.status).toBe('playing');
  });
});

describe('regenerating bricks', () => {
  it('leaves a ghost, re-forms after 6 s, and does not count for winning', () => {
    const r = mk(1, 200, 200, 'regen');
    const w = world([r], shoot(r));
    step(w, NONE, DT);
    expect(ids(w)).not.toContain(1);
    expect(w.ghosts).toHaveLength(1);
    expect(w.status).toBe('won'); // only steel + regen left
    w.status = 'playing';
    w.balls = [];
    run(w, 5.8);
    expect(ids(w)).not.toContain(1);
    run(w, 0.4);
    expect(ids(w)).toContain(1);
    expect(count(w, 'regen')).toBe(1);
    expect(w.bricks.find((k) => k.id === 1)!.hp).toBe(1);
  });

  it('waits while a ball overlaps its cell, retrying every 0.5 s', () => {
    const r = mk(1, 200, 200, 'regen');
    const w = world([r], shoot(r));
    step(w, NONE, DT);
    w.status = 'playing';
    w.balls = [{ x: 224, y: 212, vx: 0, vy: 0, r: CONFIG.ballR, stuck: false, stuckOffset: 0 }];
    run(w, 6.5);
    expect(ids(w)).not.toContain(1);
    w.balls = [];
    run(w, 0.6);
    expect(ids(w)).toContain(1);
  });
});

describe('hidden bricks', () => {
  it('is flagged hidden, revealed by the first hit, broken by the second', () => {
    const h = mk(1, 200, 200, 'hidden');
    const w = world([h], shoot(h));
    expect(h.hidden).toBe(true);
    step(w, NONE, DT);
    expect(h.hidden).toBe(false);
    expect(ids(w)).toContain(1);
    expect(count(w, 'reveal')).toBe(1);
    expect(w.balls[0]!.vy).toBeGreaterThan(0);
    Object.assign(w.balls[0]!, shoot(h));
    step(w, NONE, DT);
    expect(ids(w)).not.toContain(1);
    expect(w.score).toBe(20 + 250 * 3); // 20 for the brick + win bonus
  });

  it('counts for winning', () => {
    const h = mk(1, 200, 200, 'hidden');
    const w = world([h]);
    step(w, NONE, DT);
    expect(w.status).toBe('playing');
  });
});

describe('winning', () => {
  it('ignores steel and regen bricks', () => {
    const k = mk(1, 200, 200);
    const w = world([k, mk(2, 300, 300, 'regen'), mk(3, 100, 400, 'steel')], shoot(k));
    step(w, NONE, DT);
    expect(w.status).toBe('won');
    expect(count(w, 'won')).toBe(1);
  });
});
