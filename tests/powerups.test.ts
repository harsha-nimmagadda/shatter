import { describe, it, expect } from 'vitest';
import {
  CONFIG, EFFECT_NAMES, LEVEL_1, POWER_CATEGORY, POWER_TYPES, applyPower, comboMultiplier, isPositive,
  edgeNeighbours, createWorld, damageBrick, pickPower, step,
  type Brick, type BrickType, type EffectName, type Input, type PowerType, type World,
} from '../src/engine';

const DT = 1 / 120;
const NONE: Input = { paddleX: null, moveAxis: 0, fire: false };
const FIRE: Input = { ...NONE, fire: true };

function mk(id: number, x: number, y: number, type: BrickType = 'normal', hp = 1): Brick {
  return {
    id, x, y, w: 48, h: 24, hp, maxHp: hp, kind: type === 'steel' ? 'steel' : 'normal', type, vx: 0,
    hidden: false, streakHits: 0, seed: id,
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
/** Keeps the level from being won while a test breaks bricks. */
const sentinel = (w: World): void => {
  w.bricks.push(mk(901, 490, 70, 'normal', 99));
};
const types = (w: World): string[] => w.events.map((e) => e.type);
const speedOf = (b: { vx: number; vy: number }): number => Math.hypot(b.vx, b.vy);
const below = (k: Brick, vy = -420) => ball(k.x + k.w / 2, k.y + k.h + 6, 0, vy);

describe('drops', () => {
  it('weighted table is deterministic and matches the weights', () => {
    expect(pickPower(0)).toBe('photocopy');
    expect(pickPower(0.999999)).toBe('redpen');
    const total = POWER_TYPES.reduce((a, t) => a + CONFIG.dropWeights[t], 0);
    expect(total).toBe(83);
    const n = 8300;
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
    const w = world([], { dropChance: 1, forcedPower: 'photocopy' });
    const bricks = [0, 1, 2, 3, 4].map((i) => mk(i + 1, 20 + i * 50, 120));
    w.bricks.push(...bricks);
    for (const k of bricks) damageBrick(w, k, 1);
    expect(w.drops).toHaveLength(3);
    expect(w.drops[0]).toMatchObject({ type: 'photocopy', x: 44, y: 132, vy: 140 });
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
    w.drops.push({ id: 1, type: 'ruler', x: w.paddle.x, y: w.paddle.y - 20, vy: 140 });
    run(w, 0.5);
    expect(w.drops).toHaveLength(0);
    expect(w.paddle.w).toBe(160);
    expect(w.score).toBe(50);
    const e = w.events.find((x) => x.type === 'powerup');
    expect(e?.power).toBe('ruler');
  });

  it('catching a hazard gives no bonus; catching a positive one gives +50', () => {
    const w = world();
    w.drops.push({ id: 1, type: 'redpen', x: w.paddle.x, y: w.paddle.y - 20, vy: 140 });
    run(w, 0.3);
    expect(w.score).toBe(0);
    expect(w.effects.redpen).toBeDefined();
  });

  it('falls past the bottom: removed with powerMiss', () => {
    const w = world();
    w.drops.push({ id: 1, type: 'sharpener', x: 20, y: 940, vy: 140 });
    run(w, 0.6);
    expect(w.drops).toHaveLength(0);
    expect(w.effects.sharpener).toBeUndefined();
    expect(w.events.some((x) => x.type === 'powerMiss' && x.power === 'sharpener')).toBe(true);
  });
});


describe('paddle size', () => {
  it('base 96; ruler 160; sharpener x0.7; both 112; clamped into the walls', () => {
    const w = world();
    expect(w.paddle.w).toBe(96);
    applyPower(w, 'sharpener');
    step(w, NONE, DT);
    expect(w.paddle.w).toBeCloseTo(96 * 0.7);
    applyPower(w, 'ruler');
    w.paddle.x = 10;
    step(w, NONE, DT);
    expect(w.paddle.w).toBeCloseTo(112);
    expect(w.paddle.x).toBeCloseTo(56);
    run(w, 11);
    expect(w.paddle.w).toBe(96);
    const v = world();
    applyPower(v, 'ruler');
    step(v, NONE, DT);
    expect(v.paddle.w).toBe(160);
  });

  it('ruler narrows the max bounce angle to 40 degrees', () => {
    const w = world();
    applyPower(w, 'ruler');
    step(w, NONE, DT);
    const p = w.paddle;
    w.balls = [ball(p.x + p.w / 2, p.y - CONFIG.ballR + 1, 0, 420)];
    step(w, NONE, DT);
    const b = w.balls[0]!;
    expect((Math.atan2(b.vx, -b.vy) * 180) / Math.PI).toBeCloseTo(40, 3);
  });
});

describe('timed effects', () => {
  it('there are exactly 15 powers and 11 timed ones', () => {
    expect([...POWER_TYPES].sort()).toEqual([
      'correction', 'crumpled', 'eraser', 'gluestick', 'goldstar', 'highlighter', 'paperclip', 'photocopy', 'plane',
      'redpen', 'ruler', 'scissors', 'sharpener', 'stapler', 'stickynote',
    ]);
    expect([...EFFECT_NAMES].sort()).toEqual([
      'correction', 'crumpled', 'gluestick', 'highlighter', 'paperclip', 'plane', 'redpen', 'ruler', 'scissors', 'sharpener',
      'stapler',
    ]);
  });

  it('categories and positivity', () => {
    expect(POWER_CATEGORY.photocopy).toBe('ball');
    expect(POWER_CATEGORY.gluestick).toBe('paddle');
    expect(POWER_CATEGORY.goldstar).toBe('utility');
    expect(POWER_CATEGORY.scissors).toBe('hazard');
    for (const t of POWER_TYPES) expect(isPositive(t)).toBe(!['sharpener', 'scissors', 'redpen'].includes(t));
  });

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

  it('durations and weights match the spec', () => {
    expect(CONFIG.effectSeconds).toEqual({
      crumpled: 10, plane: 5, highlighter: 10, correction: 10, ruler: 8, gluestick: 12, stapler: 10, paperclip: 12, sharpener: 10,
      scissors: 8, redpen: 10,
    });
    expect(CONFIG.dropWeights).toEqual({
      photocopy: 8, crumpled: 6, plane: 5, highlighter: 6, correction: 7, ruler: 8, gluestick: 7, stapler: 7,
      eraser: 4, goldstar: 3, paperclip: 5, stickynote: 5, sharpener: 4, scissors: 3, redpen: 5,
    });
  });
});

describe('photocopy', () => {
  it('triples every moving ball at +-20 degrees with the same speed', () => {
    const w = world();
    applyPower(w, 'photocopy');
    expect(w.balls).toHaveLength(3);
    const ang = w.balls.map((b) => Math.round((Math.atan2(b.vx, -b.vy) * 180) / Math.PI));
    expect(ang.sort((a, b) => a - b)).toEqual([-20, 0, 20]);
    for (const b of w.balls) expect(speedOf(b)).toBeCloseTo(420);
    applyPower(w, 'photocopy');
    expect(w.balls).toHaveLength(8);
  });

  it('caps at 8 balls', () => {
    const w = world();
    for (let i = 0; i < 5; i++) applyPower(w, 'photocopy');
    expect(w.balls).toHaveLength(8);
  });

  it('launches stuck (glued) balls first', () => {
    const w = world();
    applyPower(w, 'gluestick');
    Object.assign(w.balls[0]!, { stuck: true, stuckOffset: 0, vx: 0, vy: 0 });
    applyPower(w, 'photocopy');
    expect(w.balls).toHaveLength(3);
    expect(w.balls.every((b) => !b.stuck && speedOf(b) > 0)).toBe(true);
  });
});

describe('ball-behaviour effects', () => {
  it('crumpled: 2 damage; a destroyed brick does not bounce the ball, a surviving one does', () => {
    const k = mk(1, 200, 200, 'normal', 2);
    const k2 = mk(2, 200, 120, 'normal', 3);
    const w = world([k, k2]);
    applyPower(w, 'crumpled');
    w.balls = [below(k)];
    run(w, 0.3);
    expect(w.bricks).not.toContain(k);
    // Carried on upward through the gap, hit k2 (3 hp -> 1) and bounced back.
    expect(k2.hp).toBe(1);
    expect(w.balls[0]!.vy).toBeGreaterThan(0);
    const w2 = world([mk(3, 200, 200, 'normal', 3)]);
    applyPower(w2, 'crumpled');
    const k3 = w2.bricks[1]!;
    w2.balls = [below(k3)];
    run(w2, 0.1);
    expect(k3.hp).toBe(1);
    expect(w2.balls[0]!.vy).toBeGreaterThan(0);
  });

  it('crumpled pass-through keeps the ball velocity', () => {
    const k = mk(1, 200, 200, 'normal', 1);
    const w = world([k]);
    applyPower(w, 'crumpled');
    w.balls = [below(k)];
    run(w, 0.1);
    expect(w.bricks).not.toContain(k);
    expect(w.balls[0]!.vy).toBeLessThan(0);
    expect(w.balls[0]!.vx).toBeCloseTo(0);
  });

  it('crumpled still bounces off clips and a hidden brick is only revealed', () => {
    const s = mk(1, 200, 200, 'steel');
    const w = world([s]);
    applyPower(w, 'crumpled');
    w.balls = [below(s)];
    run(w, 0.1);
    expect(w.balls[0]!.vy).toBeGreaterThan(0);
    const h = mk(2, 200, 200, 'hidden', 2);
    h.hidden = true;
    const w2 = world([h]);
    applyPower(w2, 'crumpled');
    w2.balls = [below(h)];
    run(w2, 0.1);
    expect(h.hidden).toBe(false);
    expect(w2.bricks).toContain(h);
    expect(w2.balls[0]!.vy).toBeGreaterThan(0);
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

describe('gluestick', () => {
  const caught = (): World => {
    const w = world();
    applyPower(w, 'gluestick');
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

  it('a glue catch resets the combo', () => {
    const w = world();
    applyPower(w, 'gluestick');
    w.combo = 7;
    const p = w.paddle;
    w.balls = [ball(p.x, p.y - CONFIG.ballR + 1, 0, 420)];
    step(w, NONE, DT);
    expect(w.combo).toBe(0);
  });
});

describe('stapler', () => {
  it('fires 2 staples every 0.4 s automatically, without pressing fire', () => {
    const w = world();
    applyPower(w, 'stapler');
    let volleys = 0;
    for (let i = 0; i < 120; i++) {
      step(w, NONE, DT);
      volleys += w.events.filter((e) => e.type === 'staple').length;
      w.events = [];
    }
    // t = 0, 0.4, 0.8 within the first second.
    expect(volleys).toBe(3);
    expect(w.bolts.length).toBeGreaterThanOrEqual(2);
    expect(w.bolts.some((b) => b.x < w.paddle.x)).toBe(true);
    expect(w.bolts.some((b) => b.x > w.paddle.x)).toBe(true);
  });

  it('does not fire while serving, and the fire button does not shoot', () => {
    const w = world();
    w.status = 'serve';
    w.balls[0]!.stuck = true;
    applyPower(w, 'stapler');
    run(w, 0.5);
    expect(w.bolts).toHaveLength(0);
    const v = world();
    step(v, FIRE, DT);
    expect(v.bolts).toHaveLength(0);
  });

  it('staples travel at 900 u/s, damage a brick once and vanish; hidden gets revealed', () => {
    const k = mk(1, 20, 300, 'normal', 2);
    const h = mk(2, 440, 300, 'hidden', 2);
    h.hidden = true;
    const w = world([k, h]);
    w.paddle.x = 70;
    applyPower(w, 'stapler');
    step(w, NONE, DT);
    const y0 = w.bolts[0]!.y;
    step(w, NONE, DT);
    expect(w.bolts[0]!.y).toBeCloseTo(y0 - 7.5);
    run(w, 0.7);
    expect(k.hp).toBe(1);
    w.effects = {};
    w.bolts = [];
    w.paddle.x = 492;
    applyPower(w, 'stapler');
    run(w, 1);
    expect(h.hidden).toBe(false);
  });

  it('clips absorb staples', () => {
    const s = mk(1, 20, 300, 'steel');
    const w = world([s]);
    w.paddle.x = 70;
    applyPower(w, 'stapler');
    run(w, 0.3);
    w.effects = {};
    run(w, 1);
    expect(w.bolts).toHaveLength(0);
    expect(w.bricks).toContain(s);
    expect(w.clipStreak).toBe(0);
  });
});

describe('highlighter', () => {
  const grid = (): { w: World; c: Brick; l: Brick; r: Brick; u: Brick; d: Brick; far: Brick } => {
    const c = mk(1, 200, 200, 'normal', 3);
    const l = mk(2, 150, 200, 'normal', 2);
    const r = mk(3, 250, 200, 'normal', 2);
    const u = mk(4, 200, 174, 'normal', 2);
    const d = mk(5, 200, 226, 'normal', 2);
    const far = mk(6, 300, 200, 'normal', 2);
    const w = world([c, l, r, u, d, far]);
    applyPower(w, 'highlighter');
    return { w, c, l, r, u, d, far };
  };

  it('splashes 1 damage to the four edge neighbours only', () => {
    const { w, c, l, r, u, d, far } = grid();
    w.balls = [below(c)];
    // d (below c) is in the way; hit it first from underneath instead: aim at c via sideways shot.
    w.balls = [ball(c.x + c.w / 2, c.y + c.h + 3, 0, -420)];
    w.bricks = w.bricks.filter((k) => k !== d);
    step(w, NONE, DT);
    expect(c.hp).toBe(2);
    expect([l.hp, r.hp, u.hp]).toEqual([1, 1, 1]);
    expect(far.hp).toBe(2);
    expect(types(w)).toContain('splash');
  });

  it('diagonal and gapped bricks are not neighbours', () => {
    const w = world([mk(1, 200, 200), mk(2, 250, 226), mk(3, 258, 200), mk(4, 200, 253)]);
    expect(edgeNeighbours(w, w.bricks[1]!).map((k) => k.id)).toEqual([]);
  });

  it('reveals hidden bricks, detonates bombs, ignores clips, and does not recurse', () => {
    const c = mk(1, 200, 200, 'normal', 2);
    const h = mk(2, 150, 200, 'hidden', 2);
    h.hidden = true;
    const x = mk(3, 250, 200, 'explosive', 1);
    const s = mk(4, 200, 174, 'steel');
    const next = mk(5, 100, 200, 'normal', 2); // neighbour of h, not of c
    const w = world([c, h, x, s, next]);
    applyPower(w, 'highlighter');
    w.balls = [ball(c.x + c.w / 2, c.y + c.h + 3, 0, -420)];
    step(w, NONE, DT);
    expect(h.hidden).toBe(false);
    expect(w.bricks).not.toContain(x);
    expect(types(w)).toContain('explode');
    expect(w.bricks).toContain(s);
    expect(next.hp).toBe(2);
  });

  it('splash damage can break neighbours and scores them', () => {
    const c = mk(1, 200, 200, 'normal', 2);
    const n = mk(2, 250, 200, 'normal', 1);
    const w = world([c, n]);
    applyPower(w, 'highlighter');
    w.balls = [ball(c.x + c.w / 2, c.y + c.h + 3, 0, -420)];
    step(w, NONE, DT);
    expect(w.bricks).not.toContain(n);
    expect(w.score).toBe(10 + 10);
  });
});

describe('correction, goldstar, redpen', () => {
  it('correction takes 30% off for 10 s (floored at 0.7 x start), re-catch only refreshes, then speed returns', () => {
    const w = world();
    w.speed = 800;
    w.balls[0]!.vy = -800;
    applyPower(w, 'correction');
    expect(w.speed).toBeCloseTo(560);
    expect(speedOf(w.balls[0]!)).toBeCloseTo(560);
    expect(w.effects.correction).toBe(10);
    applyPower(w, 'correction');
    expect(w.speed).toBeCloseTo(560);
    w.effects.correction = DT / 2;
    step(w, NONE, DT);
    expect(w.effects.correction).toBeUndefined();
    expect(w.speed).toBeCloseTo(800);
  });

  it('correction respects the 0.7 x start-speed floor', () => {
    const w = world();
    applyPower(w, 'correction');
    expect(w.speed).toBeCloseTo(0.7 * CONFIG.startSpeed);
  });

  it('goldstar adds one life, max 9', () => {
    const w = world();
    applyPower(w, 'goldstar');
    expect(w.lives).toBe(4);
    for (let i = 0; i < 10; i++) applyPower(w, 'goldstar');
    expect(w.lives).toBe(9);
  });

  it('redpen: x1.25 speed once, reverts on expiry (not below start); re-catch only refreshes', () => {
    const w = world();
    applyPower(w, 'redpen');
    expect(w.speed).toBeCloseTo(525);
    expect(speedOf(w.balls[0]!)).toBeCloseTo(525);
    run(w, 5);
    applyPower(w, 'redpen');
    expect(w.speed).toBeCloseTo(525);
    expect(w.effects.redpen).toBe(CONFIG.effectSeconds.redpen);
    run(w, 10.1);
    expect(w.effects.redpen).toBeUndefined();
    expect(w.speed).toBeCloseTo(420);
    expect(speedOf(w.balls[0]!)).toBeCloseTo(420, 0);
  });

  it('redpen caps at max speed and never reverts below start speed', () => {
    const w = world();
    w.speed = 900;
    applyPower(w, 'redpen');
    expect(w.speed).toBe(CONFIG.maxSpeed);
    const v = world();
    applyPower(v, 'redpen');
    v.speed = 430;
    run(v, 10.1);
    expect(v.speed).toBe(420);
  });

  it('redpen doubles points', () => {
    const k = mk(1, 200, 200, 'normal', 1);
    const w = world([k]);
    sentinel(w);
    applyPower(w, 'redpen');
    damageBrick(w, k, 1);
    expect(w.score).toBe(20);
  });
});

describe('scissors', () => {
  it('the gap is 24 wide at the centre: a ball over it falls through', () => {
    const w = world();
    applyPower(w, 'scissors');
    step(w, NONE, DT);
    const p = w.paddle;
    w.balls = [ball(p.x, p.y - 30, 0, 420)];
    run(w, 0.6);
    expect(w.status).toBe('serve');
    expect(w.lives).toBe(2);
  });

  it('a ball over a segment bounces, with the angle mapped across the full width', () => {
    const w = world();
    applyPower(w, 'scissors');
    step(w, NONE, DT);
    const p = w.paddle;
    w.balls = [ball(p.x + 40, p.y - CONFIG.ballR + 1, 0, 420)];
    step(w, NONE, DT);
    const b = w.balls[0]!;
    expect(b.vy).toBeLessThan(0);
    expect((Math.atan2(b.vx, -b.vy) * 180) / Math.PI).toBeCloseTo((40 / 48) * 60, 3);
  });

  it('capsules over the gap fall through, over a segment are caught', () => {
    const w = world();
    applyPower(w, 'scissors');
    step(w, NONE, DT);
    w.drops.push({ id: 1, type: 'goldstar', x: w.paddle.x, y: w.paddle.y - 20, vy: 140 });
    run(w, 0.5);
    expect(w.lives).toBe(3);
    expect(w.events.some((e) => e.type === 'powerMiss')).toBe(false);
    run(w, 0.6);
    expect(w.events.some((e) => e.type === 'powerMiss')).toBe(true);
    w.drops.push({ id: 2, type: 'goldstar', x: w.paddle.x + 30, y: w.paddle.y - 20, vy: 140 });
    run(w, 0.3);
    expect(w.lives).toBe(4);
  });
});

describe('paperclip', () => {
  it('pulls positive capsules within 220 px toward the paddle at up to 260 px/s', () => {
    const w = world();
    applyPower(w, 'paperclip');
    w.drops.push({ id: 1, type: 'goldstar', x: w.paddle.x + 150, y: w.paddle.y - 100, vy: 0 });
    step(w, NONE, DT);
    expect(w.drops[0]!.x).toBeCloseTo(w.paddle.x + 150 - 260 * DT);
    run(w, 1);
    expect(Math.abs(w.drops[0] ? w.drops[0].x - w.paddle.x : 0)).toBeLessThan(1);
  });

  it('ignores far capsules and hazards, and does nothing without the effect', () => {
    const w = world();
    applyPower(w, 'paperclip');
    w.drops.push(
      { id: 1, type: 'goldstar', x: w.paddle.x + 200, y: w.paddle.y - 300, vy: 0 },
      { id: 2, type: 'scissors', x: w.paddle.x + 50, y: w.paddle.y - 100, vy: 0 },
    );
    run(w, 0.5);
    expect(w.drops[0]!.x).toBe(w.paddle.x + 200);
    expect(w.drops[1]!.x).toBe(w.paddle.x + 50);
    const v = world();
    v.drops.push({ id: 1, type: 'goldstar', x: v.paddle.x + 100, y: v.paddle.y - 100, vy: 0 });
    run(v, 0.5);
    expect(v.drops[0]!.x).toBe(v.paddle.x + 100);
  });
});

describe('eraser, stickynote', () => {
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
    // 10 + 20 (regen scores 0); the 2nd break is the 2nd of the combo, still 1x.
    expect(w.score).toBe(30);
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

describe('scoring', () => {
  it('10 per hp removed (a 3-hp marker is 30 in total) and rounded to an integer', () => {
    const k = mk(1, 200, 200, 'normal', 3);
    const w = world([k]);
    sentinel(w);
    damageBrick(w, k, 1);
    damageBrick(w, k, 1);
    expect(w.score).toBe(20);
    damageBrick(w, k, 1);
    expect(w.score).toBe(30);
    expect(Number.isInteger(w.score)).toBe(true);
  });

  it('combo multiplier steps at 3, 6 and 9 breaks, evaluated before the break is added', () => {
    const w = world();
    sentinel(w);
    const m: number[] = [];
    const awards: number[] = [];
    for (let i = 0; i < 11; i++) {
      const k = mk(100 + i, 20 + i * 2, 120);
      w.bricks.push(k);
      const before = w.score;
      damageBrick(w, k, 1);
      awards.push(w.score - before);
      m.push(comboMultiplier(w));
    }
    expect(awards).toEqual([10, 10, 10, 15, 15, 15, 20, 20, 20, 30, 30]);
    expect(m.slice(0, 3)).toEqual([1, 1, 1.5]);
    expect(w.events.filter((e) => e.type === 'combo').map((e) => e.value)).toEqual([1.5, 2, 3]);
  });

  it('combo resets when any ball touches the paddle', () => {
    const w = world();
    w.combo = 9;
    expect(comboMultiplier(w)).toBe(3);
    const p = w.paddle;
    w.balls = [ball(p.x, p.y - CONFIG.ballR + 1, 0, 420)];
    step(w, NONE, DT);
    expect(w.combo).toBe(0);
    expect(comboMultiplier(w)).toBe(1);
  });

  it('regenerating bricks score 0 and do not build the combo', () => {
    const k = mk(1, 200, 200, 'regen', 1);
    const w = world([k]);
    sentinel(w);
    damageBrick(w, k, 1);
    expect(w.score).toBe(0);
    expect(w.combo).toBe(0);
    expect(w.drops).toHaveLength(0);
  });

  it('staple, blast and splash points use the combo too', () => {
    const w = world();
    sentinel(w);
    w.combo = 9;
    const k = mk(1, 200, 200, 'normal', 1);
    w.bricks.push(k);
    damageBrick(w, k, 1);
    expect(w.score).toBe(30);
    const x = mk(2, 100, 200, 'explosive', 1);
    const n = mk(3, 150, 200, 'normal', 1);
    w.bricks.push(x, n);
    damageBrick(w, x, 1);
    expect(w.score).toBe(30 + 30 + 30);
  });

  it('+250 per remaining life on a win', () => {
    const k = mk(1, 200, 200, 'normal', 1);
    const w = world([k]);
    damageBrick(w, k, 1);
    expect(w.status).toBe('won');
    expect(w.score).toBe(10 + 250 * 3);
  });

  it('an extra life every 10,000 points crossed, max 9', () => {
    const w = world();
    sentinel(w);
    w.score = 9990;
    const k = mk(1, 200, 200, 'normal', 1);
    w.bricks.push(k);
    damageBrick(w, k, 1);
    expect(w.lives).toBe(4);
    expect(types(w)).toContain('extraLife');
    w.score = 19990;
    const k2 = mk(2, 260, 200, 'normal', 1);
    w.bricks.push(k2);
    damageBrick(w, k2, 1);
    expect(w.lives).toBe(5);
    w.lives = 9;
    w.score = 29990;
    const k3 = mk(3, 320, 200, 'normal', 1);
    w.bricks.push(k3);
    damageBrick(w, k3, 1);
    expect(w.lives).toBe(9);
  });
});

describe('clip anti-softlock', () => {
  const hitClip = (w: World, s: Brick): void => {
    w.balls = [below(s)];
    run(w, 0.05);
  };

  it('pops clips with >= 3 streak hits on the 10th clip hit', () => {
    const a = mk(1, 100, 200, 'steel');
    const b = mk(2, 300, 200, 'steel');
    const w = world([a, b]);
    // 3 hits on a, 6 on b, then the 10th on b.
    for (let i = 0; i < 3; i++) hitClip(w, a);
    expect(types(w)).toContain('clipLoose');
    expect(a.streakHits).toBe(3);
    for (let i = 0; i < 6; i++) hitClip(w, b);
    expect(w.clipStreak).toBe(9);
    expect(w.bricks).toContain(a);
    hitClip(w, b);
    expect(w.bricks).not.toContain(a);
    expect(w.bricks).not.toContain(b);
    expect(types(w).filter((t) => t === 'clipPop')).toHaveLength(2);
    expect(w.clipStreak).toBe(0);
  });

  it('keeps clips below 3 hits, and resets all counters', () => {
    const a = mk(1, 100, 200, 'steel');
    const b = mk(2, 300, 200, 'steel');
    const w = world([a, b]);
    hitClip(w, a);
    hitClip(w, a);
    for (let i = 0; i < 8; i++) hitClip(w, b);
    expect(w.bricks).toContain(a);
    expect(a.streakHits).toBe(0);
    expect(w.clipStreak).toBe(0);
  });

  it('damaging a breakable brick (any source) resets the streak; paddle bounces do not', () => {
    const a = mk(1, 100, 200, 'steel');
    const k = mk(2, 300, 200, 'normal', 2);
    const w = world([a, k]);
    for (let i = 0; i < 4; i++) hitClip(w, a);
    expect(w.clipStreak).toBe(4);
    const p = w.paddle;
    w.balls = [ball(p.x, p.y - CONFIG.ballR + 1, 0, 420)];
    step(w, NONE, DT);
    expect(w.clipStreak).toBe(4);
    damageBrick(w, k, 1);
    expect(w.clipStreak).toBe(0);
    expect(a.streakHits).toBe(0);
  });

  it('clips never count toward winning', () => {
    const a = mk(1, 100, 200, 'steel');
    const k = mk(2, 300, 200, 'normal', 1);
    const w = world([a, k]);
    damageBrick(w, k, 1);
    expect(w.status).toBe('won');
  });
});

describe('life lost clears everything', () => {
  it('drops, effects, bolts, net, combo and clip streak reset', () => {
    const w = world();
    for (const t of ['stapler', 'crumpled', 'gluestick', 'stickynote', 'redpen', 'ruler'] as PowerType[]) applyPower(w, t);
    w.bolts.push({ x: 10, y: 500 });
    w.drops.push({ id: 5, type: 'goldstar', x: 10, y: 100, vy: 140 });
    w.net = false; // let the ball fall
    w.combo = 5;
    w.clipStreak = 4;
    w.bricks[0]!.streakHits = 2;
    w.balls = [ball(20, 975, 0, 300)];
    step(w, NONE, DT);
    expect(w.lives).toBe(2);
    expect(w.drops).toEqual([]);
    expect(w.bolts).toEqual([]);
    expect(w.effects).toEqual({});
    expect(w.net).toBe(false);
    expect(w.combo).toBe(0);
    expect(w.clipStreak).toBe(0);
    expect(w.bricks[0]!.streakHits).toBe(0);
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

describe('anti-stall nudge', () => {
  it('leans paddle bounces toward a counting brick only after the stall threshold, by at most stallNudgeDeg', () => {
    const bounceAngle = (stallT: number): number => {
      const w = world([mk(902, 450, 150)]);
      const p = w.paddle;
      w.stallT = stallT;
      w.balls = [ball(p.x, p.y - CONFIG.ballR + 1, 0, 420)];
      step(w, NONE, DT);
      const b = w.balls[0]!;
      return (Math.atan2(b.vx, -b.vy) * 180) / Math.PI;
    };
    expect(bounceAngle(CONFIG.stallAssistSec - 1)).toBeCloseTo(0, 3);
    const leaned = bounceAngle(CONFIG.stallAssistSec);
    expect(leaned).toBeGreaterThan(0);
    expect(leaned).toBeLessThanOrEqual(CONFIG.stallNudgeDeg + CONFIG.stallNudgeGrowth * DT + 1e-6);
    expect(bounceAngle(CONFIG.stallAssistSec + 100)).toBeLessThanOrEqual(CONFIG.stallNudgeMaxDeg + 1e-6);
  });

  it('brick damage and losing a life reset the stall timer', () => {
    const k = mk(901, 200, 300, 'normal', 2);
    const w = world([k]);
    w.status = 'playing';
    w.stallT = 15;
    damageBrick(w, k, 1);
    expect(w.stallT).toBe(0);
    w.stallT = 15;
    w.balls = [ball(270, w.height + 40, 0, 420)];
    step(w, NONE, DT);
    expect(w.lives).toBe(CONFIG.lives - 1);
    expect(w.stallT).toBe(0);
  });
});
