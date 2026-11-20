import { describe, it, expect } from 'vitest';
import {
  CONFIG, EFFECT_NAMES, LEVEL_1, POWER_TYPES, applyPower, createWorld, damageBrick, pickPower, step,
  type Brick, type BrickType, type EffectName, type Input, type PowerType, type World,
} from '../src/engine';

const DT = 1 / 120;
const NONE: Input = { paddleX: null, moveAxis: 0, fire: false };
const FIRE: Input = { ...NONE, fire: true };

function mk(id: number, x: number, y: number, type: BrickType = 'normal', hp = 1): Brick {
  return {
    id, x, y, w: 48, h: 24, hp, maxHp: hp, kind: type === 'steel' ? 'steel' : 'normal', type, vx: 0,
    hidden: false, seed: id,
  };
}

const ball = (x: number, y: number, vx = 0, vy = 0) => ({
  x, y, vx, vy, r: CONFIG.ballR, stuck: false, stuckOffset: 0,
});

function world(bricks: Brick[] = [], opts: { dropChance?: number; forcedPower?: PowerType } = {}): World {
  const w = createWorld(LEVEL_1, { seed: 9, dropChance: 0, ...opts });
  w.status = 'playing';
  w.bricks = [mk(900, 400, 300, 'steel'), ...bricks];
  w.balls = [ball(270, 600, 0, -420)];
  return w;
}

const run = (w: World, seconds: number, input: Input = NONE): void => {
  for (let i = 0; i < Math.round(seconds * 120); i++) step(w, i === 0 ? input : NONE, DT);
};
const types = (w: World): string[] => w.events.map((e) => e.type);
const speedOf = (b: { vx: number; vy: number }): number => Math.hypot(b.vx, b.vy);
const below = (k: Brick, vy = -420) => ball(k.x + k.w / 2, k.y + k.h + 6, 0, vy);

describe('drops', () => {
  it('weighted table is deterministic and matches the weights', () => {
    expect(pickPower(0)).toBe('expand');
    expect(pickPower(0.999999)).toBe('stickynote');
    const total = POWER_TYPES.reduce((a, t) => a + CONFIG.dropWeights[t], 0);
    expect(total).toBe(102);
    const n = 10200;
    const got: Partial<Record<PowerType, number>> = {};
    for (let i = 0; i < n; i++) {
      const t = pickPower((i + 0.5) / n);
      got[t] = (got[t] ?? 0) + 1;
    }
    for (const t of POWER_TYPES) expect(got[t]).toBeCloseTo(CONFIG.dropWeights[t] * 100, -1);
  });

  const breakAll = (seed: number, chance: number): string => {
    const w = createWorld(LEVEL_1, { seed, dropChance: chance });
    w.status = 'playing';
    const out: string[] = [];
    for (let i = 0; i < 40; i++) {
      const k = mk(100 + i, 20 + (i % 10) * 50, 120 + Math.floor(i / 10) * 26);
      w.bricks = [mk(900, 400, 300, 'steel'), k];
      damageBrick(w, k, 1);
      out.push(...w.drops.map((d) => `${d.id}:${d.type}`));
      w.drops = [];
    }
    return out.join(',');
  };

  it('same seed gives the same drops; roughly 15% drop', () => {
    expect(breakAll(3, 0.15)).toBe(breakAll(3, 0.15));
    expect(breakAll(3, 0.15)).not.toBe(breakAll(4, 0.15));
    expect(breakAll(3, 0.15).split(',').filter(Boolean).length).toBeGreaterThan(0);
    expect(breakAll(3, 0)).toBe('');
    expect(createWorld(LEVEL_1).dropChance).toBe(CONFIG.dropChance);
  });

  it('spawns a 140 u/s capsule at the brick centre; at most 3 fall at once', () => {
    const w = world([], { dropChance: 1, forcedPower: 'expand' });
    const bricks = [0, 1, 2, 3, 4].map((i) => mk(i + 1, 20 + i * 50, 120));
    w.bricks.push(...bricks);
    for (const k of bricks) damageBrick(w, k, 1);
    expect(w.drops).toHaveLength(3);
    expect(w.drops[0]).toMatchObject({ type: 'expand', x: 44, y: 132, vy: 140 });
  });

  it('steel and regenerating bricks never drop', () => {
    const w = world([], { dropChance: 1 });
    const r = mk(1, 20, 120, 'regen');
    w.bricks.push(r);
    damageBrick(w, r, 1);
    expect(w.drops).toHaveLength(0);
    expect(w.ghosts).toHaveLength(1);
  });

  it('caught on the paddle: applies and emits; keeps falling during serve', () => {
    const w = world();
    w.status = 'serve';
    w.balls[0]!.stuck = true;
    w.drops.push({ id: 1, type: 'expand', x: w.paddle.x, y: w.paddle.y - 20, vy: 140 });
    run(w, 0.5);
    expect(w.drops).toHaveLength(0);
    expect(w.paddleLevel).toBe(1);
    expect(w.paddle.w).toBe(128);
    const e = w.events.find((x) => x.type === 'powerup');
    expect(e?.power).toBe('expand');
  });

  it('falls past the bottom: removed with powerMiss', () => {
    const w = world();
    w.drops.push({ id: 1, type: 'shrink', x: 20, y: 940, vy: 140 });
    run(w, 0.6);
    expect(w.drops).toHaveLength(0);
    expect(w.paddleLevel).toBe(0);
    expect(w.events.some((x) => x.type === 'powerMiss' && x.power === 'shrink')).toBe(true);
  });
});

describe('paddle size', () => {
  it('levels clamp to -2..+2 with widths 64/80/96/128/160', () => {
    const w = world();
    const widths: number[] = [];
    for (let i = 0; i < 3; i++) {
      applyPower(w, 'shrink');
      widths.push(w.paddle.w);
    }
    expect(widths).toEqual([80, 64, 64]);
    for (let i = 0; i < 5; i++) applyPower(w, 'expand');
    expect(w.paddle.w).toBe(160);
    expect(w.paddleLevel).toBe(2);
  });

  it('sharpener x0.7, ruler x1.8, and the paddle is clamped into the walls', () => {
    const w = world();
    applyPower(w, 'sharpener');
    step(w, NONE, DT);
    expect(w.paddle.w).toBeCloseTo(96 * 0.7);
    applyPower(w, 'ruler');
    w.paddle.x = 10;
    step(w, NONE, DT);
    expect(w.paddle.w).toBeCloseTo(96 * 0.7 * 1.8);
    expect(w.paddle.x).toBeCloseTo(w.paddle.w / 2);
    run(w, 11);
    expect(w.paddle.w).toBe(96);
  });

  it('ruler narrows the max bounce angle to 25 degrees', () => {
    const w = world();
    applyPower(w, 'ruler');
    step(w, NONE, DT);
    const p = w.paddle;
    w.balls = [ball(p.x + p.w / 2, p.y - CONFIG.ballR + 1, 0, 420)];
    step(w, NONE, DT);
    const b = w.balls[0]!;
    expect((Math.atan2(b.vx, -b.vy) * 180) / Math.PI).toBeCloseTo(25, 3);
  });

  it('inkblot halves paddle speed', () => {
    const a = world();
    const b = world();
    applyPower(b, 'inkblot');
    step(a, { ...NONE, moveAxis: 1 }, 0.1);
    step(b, { ...NONE, moveAxis: 1 }, 0.1);
    expect(b.paddle.x - 270).toBeCloseTo((a.paddle.x - 270) / 2);
  });
});

describe('timed effects', () => {
  it.each(EFFECT_NAMES)('%s lasts its duration, refreshes, then emits effectEnd', (name: EffectName) => {
    const w = world();
    w.balls = [];
    w.status = 'serve';
    const dur = CONFIG.effectSeconds[name];
    applyPower(w, name);
    expect(w.effects[name]).toBe(dur);
    run(w, dur / 2);
    expect(w.effects[name]).toBeCloseTo(dur / 2, 1);
    applyPower(w, name);
    expect(w.effects[name]).toBe(dur);
    run(w, dur - 0.2);
    expect(w.effects[name]).toBeDefined();
    run(w, 0.4);
    expect(w.effects[name]).toBeUndefined();
    expect(w.events.filter((e) => e.type === 'effectEnd' && e.power === name)).toHaveLength(1);
  });

  it('durations match the spec', () => {
    expect(CONFIG.effectSeconds).toEqual({
      fireball: 10, through: 8, crumpled: 10, catch: 15, laser: 10, inkblot: 6, plane: 5, sharpener: 10, ruler: 8,
    });
  });
});

describe('ball multiplication', () => {
  it('multiball triples, at +-20 degrees with the same speed', () => {
    const w = world();
    applyPower(w, 'multiball');
    expect(w.balls).toHaveLength(3);
    const ang = w.balls.map((b) => Math.round((Math.atan2(b.vx, -b.vy) * 180) / Math.PI));
    expect(ang.sort((a, b) => a - b)).toEqual([-20, 0, 20]);
    for (const b of w.balls) expect(speedOf(b)).toBeCloseTo(420);
  });

  it('caps at 8 balls', () => {
    const w = world();
    for (let i = 0; i < 5; i++) applyPower(w, 'multiball');
    expect(w.balls).toHaveLength(8);
    applyPower(w, 'split');
    expect(w.balls).toHaveLength(8);
  });

  it('split doubles at +-12 degrees', () => {
    const w = world();
    applyPower(w, 'split');
    expect(w.balls).toHaveLength(2);
    const ang = w.balls.map((b) => Math.round((Math.atan2(b.vx, -b.vy) * 180) / Math.PI)).sort((a, b) => a - b);
    expect(ang).toEqual([-12, 12]);
  });

  it('launches stuck (caught) balls first', () => {
    const w = world();
    applyPower(w, 'catch');
    Object.assign(w.balls[0]!, { stuck: true, stuckOffset: 0, vx: 0, vy: 0 });
    applyPower(w, 'multiball');
    expect(w.balls).toHaveLength(3);
    expect(w.balls.every((b) => !b.stuck && speedOf(b) > 0)).toBe(true);
  });
});

describe('ball-behaviour effects', () => {
  it('fireball destroys bricks without bouncing, but steel still bounces', () => {
    const k = mk(1, 200, 200, 'normal', 3);
    const k2 = mk(2, 200, 150, 'normal', 1);
    const w = world([k, k2]);
    applyPower(w, 'fireball');
    w.balls = [below(k)];
    run(w, 0.4);
    expect(w.bricks.map((b) => b.id)).toEqual([900]);
    expect(w.balls[0]!.vy).toBeLessThan(0);
    expect(w.balls[0]!.vx).toBeCloseTo(0);

    const s = mk(3, 200, 200, 'steel');
    const w2 = world([s]);
    applyPower(w2, 'fireball');
    w2.balls = [below(s)];
    run(w2, 0.1);
    expect(w2.balls[0]!.vy).toBeGreaterThan(0);
    expect(w2.bricks).toContain(s);
  });

  it('fireball overrides through', () => {
    const s = mk(3, 200, 200, 'steel');
    const w = world([s]);
    applyPower(w, 'through');
    applyPower(w, 'fireball');
    w.balls = [below(s)];
    run(w, 0.1);
    expect(w.balls[0]!.vy).toBeGreaterThan(0);
  });

  it('through passes bricks, damaging each once per pass; steel takes none', () => {
    const k = mk(1, 200, 200, 'normal', 3);
    const s = mk(2, 200, 150, 'steel');
    const w = world([k, s]);
    applyPower(w, 'through');
    w.balls = [below(k)];
    run(w, 0.3);
    expect(k.hp).toBe(2);
    expect(s.hp).toBe(1);
    expect(w.balls[0]!.vy).toBeLessThan(0);
    expect(w.balls[0]!.y).toBeLessThan(150);
    // Second pass damages again.
    w.balls = [below(k)];
    run(w, 0.3);
    expect(k.hp).toBe(1);
  });

  it('through: a brick is not damaged every substep while overlapped', () => {
    const k = mk(1, 200, 200, 'normal', 3);
    const w = world([k]);
    applyPower(w, 'through');
    w.balls = [ball(224, 212, 0, -10)];
    run(w, 0.3);
    expect(k.hp).toBe(2);
  });

  it('crumpled does 2 damage per hit and still bounces', () => {
    const k = mk(1, 200, 200, 'normal', 3);
    const w = world([k]);
    applyPower(w, 'crumpled');
    w.balls = [below(k)];
    run(w, 0.1);
    expect(k.hp).toBe(1);
    expect(w.balls[0]!.vy).toBeGreaterThan(0);
  });

  it('plane steers toward the nearest brick at <= 3 rad/s, keeping speed', () => {
    const k = mk(1, 400, 400);
    const w = world([k]);
    w.bricks = w.bricks.filter((b) => b.id !== 900);
    applyPower(w, 'plane');
    w.balls = [ball(100, 600, 0, -420)];
    const a0 = Math.atan2(-420, 0);
    step(w, NONE, DT);
    const b = w.balls[0]!;
    const turned = Math.abs(Math.atan2(b.vy, b.vx) - a0);
    expect(turned).toBeCloseTo(3 * DT, 5);
    expect(speedOf(b)).toBeCloseTo(420);
    // Heading error shrinks over time.
    const err = (): number => {
      const bb = w.balls[0]!;
      const want = Math.atan2(412 - bb.y, 424 - bb.x);
      return Math.abs(Math.atan2(Math.sin(want - Math.atan2(bb.vy, bb.vx)), Math.cos(want - Math.atan2(bb.vy, bb.vx))));
    };
    const e0 = err();
    run(w, 0.2);
    expect(err()).toBeLessThan(e0);
    expect(speedOf(w.balls[0]!)).toBeCloseTo(w.speed, 3);
  });
});

describe('catch', () => {
  const caught = (): World => {
    const w = world();
    applyPower(w, 'catch');
    step(w, NONE, DT);
    const p = w.paddle;
    w.balls = [ball(p.x + 30, p.y - CONFIG.ballR + 1, 0, 420)];
    step(w, NONE, DT);
    return w;
  };

  it('sticks at the contact offset while status stays playing', () => {
    const w = caught();
    const b = w.balls[0]!;
    expect(b.stuck).toBe(true);
    expect(b.stuckOffset).toBeCloseTo(30);
    expect(w.status).toBe('playing');
    step(w, { ...NONE, paddleX: 100 }, DT);
    expect(b.x).toBeCloseTo(w.paddle.x + 30);
  });

  it('fire releases with the paddle bounce angle', () => {
    const w = caught();
    step(w, FIRE, DT);
    const b = w.balls[0]!;
    expect(b.stuck).toBe(false);
    expect((Math.atan2(b.vx, -b.vy) * 180) / Math.PI).toBeCloseTo((30 / 48) * 60, 3);
    expect(speedOf(b)).toBeCloseTo(w.speed, 3);
  });

  it('auto-releases after 3 s', () => {
    const w = caught();
    run(w, 2.9);
    expect(w.balls[0]!.stuck).toBe(true);
    run(w, 0.2);
    expect(w.balls[0]!.stuck).toBe(false);
  });

  it('keeps the stuck offset inside a shrinking paddle', () => {
    const w = caught();
    for (let i = 0; i < 2; i++) applyPower(w, 'shrink');
    step(w, NONE, DT);
    expect(Math.abs(w.balls[0]!.stuckOffset)).toBeLessThanOrEqual(w.paddle.w / 2);
  });
});

describe('laser', () => {
  it('fires two bolts per press, at most one volley per 0.25 s', () => {
    const w = world();
    applyPower(w, 'laser');
    step(w, FIRE, DT);
    expect(w.bolts).toHaveLength(2);
    expect(w.events.filter((e) => e.type === 'laser')).toHaveLength(1);
    expect(w.bolts[0]!.x).toBeLessThan(w.paddle.x);
    expect(w.bolts[1]!.x).toBeGreaterThan(w.paddle.x);
    step(w, FIRE, DT);
    expect(w.bolts).toHaveLength(2);
    run(w, 0.25);
    step(w, FIRE, DT);
    expect(w.bolts).toHaveLength(4);
  });

  it('bolts travel at 900 u/s, damage a brick once and vanish; hidden gets revealed', () => {
    const k = mk(1, 20, 300, 'normal', 2);
    const h = mk(2, 440, 300, 'hidden', 2);
    h.hidden = true;
    const w = world([k, h]);
    w.paddle.x = 70;
    applyPower(w, 'laser');
    step(w, FIRE, DT);
    const y0 = w.bolts[0]!.y;
    step(w, NONE, DT);
    expect(w.bolts[0]!.y).toBeCloseTo(y0 - 7.5);
    run(w, 1);
    expect(k.hp).toBe(1);
    expect(w.bolts).toHaveLength(0);
    w.paddle.x = 492;
    run(w, 0.3);
    step(w, FIRE, DT);
    run(w, 1);
    expect(h.hidden).toBe(false);
  });

  it('steel absorbs bolts', () => {
    const s = mk(1, 20, 300, 'steel');
    const w = world([s]);
    w.paddle.x = 70;
    applyPower(w, 'laser');
    step(w, FIRE, DT);
    run(w, 1);
    expect(w.bolts).toHaveLength(0);
    expect(w.bricks).toContain(s);
  });

  it('catch + laser: fire releases the ball and shoots', () => {
    const w = world();
    applyPower(w, 'catch');
    applyPower(w, 'laser');
    Object.assign(w.balls[0]!, { stuck: true, stuckOffset: 10, vx: 0, vy: 0 });
    step(w, FIRE, DT);
    expect(w.balls[0]!.stuck).toBe(false);
    expect(w.bolts).toHaveLength(2);
  });

  it('no shooting without the effect', () => {
    const w = world();
    step(w, FIRE, DT);
    expect(w.bolts).toHaveLength(0);
  });
});

describe('speed, lives, eraser, net', () => {
  it('speedup x1.25 capped, slowdown x0.75 floored at 0.7 start speed; balls rescaled', () => {
    const w = world();
    applyPower(w, 'speedup');
    expect(w.speed).toBeCloseTo(525);
    expect(speedOf(w.balls[0]!)).toBeCloseTo(525);
    for (let i = 0; i < 10; i++) applyPower(w, 'speedup');
    expect(w.speed).toBe(CONFIG.maxSpeed);
    for (let i = 0; i < 20; i++) applyPower(w, 'slowdown');
    expect(w.speed).toBeCloseTo(0.7 * CONFIG.startSpeed);
    expect(speedOf(w.balls[0]!)).toBeCloseTo(0.7 * CONFIG.startSpeed);
  });

  it('extralife adds one, max 9', () => {
    const w = world();
    applyPower(w, 'extralife');
    expect(w.lives).toBe(4);
    for (let i = 0; i < 10; i++) applyPower(w, 'extralife');
    expect(w.lives).toBe(9);
  });

  it('killpaddle loses a life immediately', () => {
    const w = world();
    applyPower(w, 'killpaddle');
    expect(w.lives).toBe(2);
    expect(w.status).toBe('serve');
    expect(types(w)).toContain('lifeLost');
    expect(w.balls).toHaveLength(1);
    expect(w.balls[0]!.stuck).toBe(true);
    w.lives = 1;
    applyPower(w, 'killpaddle');
    expect(w.status).toBe('gameover');
  });

  it('eraser destroys the lowest row except steel, scoring and emitting', () => {
    const w = world([
      mk(1, 20, 120), mk(2, 70, 120),
      mk(3, 20, 200), mk(4, 70, 200, 'normal', 2), mk(5, 120, 200, 'steel'), mk(6, 170, 200, 'regen'),
    ]);
    applyPower(w, 'eraser');
    expect(w.bricks.map((k) => k.id).sort((a, b) => a - b)).toEqual([1, 2, 5, 900]);
    expect(w.events.filter((e) => e.type === 'brickBreak')).toHaveLength(3);
    const e = w.events.find((x) => x.type === 'eraser')!;
    expect(e.y).toBe(212);
    expect(w.score).toBe(10 + 20 + 10);
    expect(w.ghosts).toHaveLength(1);
  });

  it('stickynote saves exactly one ball', () => {
    const w = world();
    applyPower(w, 'stickynote');
    expect(w.net).toBe(true);
    w.balls = [ball(50, 900, 0, 420), ball(400, 900, 0, 420)];
    w.balls[1]!.vx = 100;
    run(w, 0.5);
    expect(w.net).toBe(false);
    expect(types(w)).toContain('net');
    expect(w.events.filter((e) => e.type === 'net')).toHaveLength(1);
    expect(w.status).toBe('playing');
    expect(w.balls).toHaveLength(1);
    expect(w.balls[0]!.vy).toBeLessThan(0);
    expect(w.balls[0]!.x).toBeCloseTo(50, 0);
  });

  it('the net bounce happens at height - 24', () => {
    const w = world();
    applyPower(w, 'stickynote');
    w.balls = [ball(50, 925, 0, 420)];
    step(w, NONE, DT);
    expect(w.balls[0]!.y + CONFIG.ballR).toBeLessThanOrEqual(CONFIG.height - 24 + 1e-9);
  });
});

describe('life lost clears everything', () => {
  it('drops, effects, bolts, net and size level reset', () => {
    const w = world();
    for (const t of ['laser', 'fireball', 'catch', 'stickynote', 'expand', 'ruler'] as PowerType[]) applyPower(w, t);
    w.bolts.push({ x: 10, y: 500 });
    w.drops.push({ id: 5, type: 'extralife', x: 10, y: 100, vy: 140 });
    w.net = false; // let the ball fall
    w.balls = [ball(20, 975, 0, 300)];
    step(w, NONE, DT);
    expect(w.lives).toBe(2);
    expect(w.drops).toEqual([]);
    expect(w.bolts).toEqual([]);
    expect(w.effects).toEqual({});
    expect(w.net).toBe(false);
    expect(w.paddleLevel).toBe(0);
    expect(w.paddle.w).toBe(96);
  });
});

describe('determinism with power-ups', () => {
  const play = (): World => {
    const w = createWorld(LEVEL_1, { seed: 77, dropChance: 0.6 });
    for (let i = 0; i < 12000; i++) {
      step(w, { paddleX: 270 + 220 * Math.sin(i / 70), moveAxis: 0, fire: i % 97 === 0 }, DT);
      if (w.status === 'won' || w.status === 'gameover') break;
    }
    return w;
  };
  it('same seed + inputs give identical state, and power-ups actually happen', () => {
    const a = play();
    const b = play();
    expect(a).toEqual(b);
    expect(a.time).toBeGreaterThan(5);
  });
});
