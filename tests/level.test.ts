import { describe, it, expect } from 'vitest';
import { CAMPAIGN, createWorld, parseLevel, pickPower, validateLevel, LEVEL_1 } from '../src/engine';

describe('parseLevel', () => {
  it('places bricks on the grid with hp and kind', () => {
    const b = parseLevel({ name: 't', rows: ['1.3#......', '..........', '.2........'] }, 0);
    expect(b).toHaveLength(4);
    expect(b[0]).toMatchObject({ x: 21, y: 121, w: 48, h: 24, hp: 1, maxHp: 1, kind: 'normal' });
    expect(b[1]).toMatchObject({ x: 121, y: 121, hp: 3, kind: 'normal' });
    expect(b[2]).toMatchObject({ x: 171, kind: 'steel' });
    expect(b[3]).toMatchObject({ x: 71, y: 121 + 52, hp: 2 });
    expect(new Set(b.map((k) => k.seed)).size).toBe(4);
  });

  it('is deterministic and level-dependent for seeds', () => {
    const l = { name: 't', rows: ['1.........'] };
    expect(parseLevel(l, 0)[0]!.seed).toBe(parseLevel(l, 0)[0]!.seed);
    expect(parseLevel(l, 0)[0]!.seed).not.toBe(parseLevel(l, 1)[0]!.seed);
  });

  it('rejects bad characters and row lengths', () => {
    expect(() => parseLevel({ name: 'x', rows: ['1z........'] }, 0)).toThrow(/bad character "z"/);
    expect(() => parseLevel({ name: 'x', rows: ['111'] }, 0)).toThrow(/expected 10/);
  });

  it('LEVEL_1 parses', () => {
    expect(parseLevel(LEVEL_1, 0).some((k) => k.kind === 'steel')).toBe(true);
  });
});

describe('campaign', () => {
  it('has 15 levels that all pass the validator and parse', () => {
    expect(CAMPAIGN).toHaveLength(15);
    for (const l of CAMPAIGN) {
      expect(validateLevel(l), l.name).toEqual([]);
      expect(() => parseLevel(l, 0)).not.toThrow();
    }
  });

  it('validator rejects bricks sealed in by clips and bad rows', () => {
    const sealed = { name: 's', rows: ['###.......', '#1#.......', '###.......'] };
    expect(validateLevel(sealed)).toEqual(['brick at row 1, col 1 ("1") can\'t be reached']);
    expect(validateLevel({ name: 'w', rows: ['111'] })[0]).toMatch(/expected 10/);
    expect(validateLevel({ name: 'z', rows: ['rrrrrrrrrr'] })).toEqual(['no bricks that count toward winning']);
  });

  it('a featured power-up doubles its drop weight', () => {
    let plain = 0;
    let featured = 0;
    for (let i = 0; i < 2000; i++) {
      const r = (i + 0.5) / 2000;
      if (pickPower(r) === 'stapler') plain++;
      if (pickPower(r, 'stapler') === 'stapler') featured++;
    }
    expect(featured / plain).toBeGreaterThan(1.7);
  });

  it('carried score keeps extra lives on the 10,000 grid', () => {
    const w = createWorld(CAMPAIGN[0]!, { score: 12_345 });
    expect(w.score).toBe(12_345);
    expect(w.nextLifeAt).toBe(20_000);
  });
});
