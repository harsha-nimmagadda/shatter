import { describe, expect, it } from 'vitest';
import { POWER_TYPES } from '../src/engine';
import {
  BAD_POWERS,
  FLOAT_LIFE,
  ICON_IDS,
  POWER_NAMES,
  ballRenderPos,
  floatTextState,
  isBadPower,
  lerpTowards,
  powerName,
  resolveIcon,
  snapshotBalls,
} from '../src/render/powerVisuals';
import manifest from '../public/assets/world1/manifest.json';

describe('icon mapping', () => {
  it('covers every engine power type', () => {
    for (const t of POWER_TYPES) expect(t in ICON_IDS, t).toBe(true);
  });
  it('maps to ids that exist in the manifest (except the procedural ones)', () => {
    for (const t of POWER_TYPES) {
      const id = ICON_IDS[t];
      if (id === null) expect(['highlighter', 'paperclip']).toContain(t);
      else expect(Object.keys(manifest)).toContain(id);
    }
  });
  it('falls back when art is missing, and never throws on unknown types', () => {
    expect(resolveIcon('stapler', () => true)).toEqual({ source: 'art', id: 'icon-laser' });
    expect(resolveIcon('stapler', () => false).source).toBe('doodle');
    expect(resolveIcon('nope', () => true).source).toBe('doodle');
  });
  it('has a name for every power', () => {
    for (const t of POWER_TYPES) expect(POWER_NAMES[t].length).toBeGreaterThan(2);
    expect(powerName('zzz')).toBe('Power!');
  });
});

describe('good / bad', () => {
  it('classifies the three hazards', () => {
    for (const t of ['sharpener', 'scissors', 'redpen']) expect(isBadPower(t)).toBe(true);
    for (const t of POWER_TYPES) expect(isBadPower(t)).toBe(BAD_POWERS.has(t));
    expect(isBadPower('photocopy')).toBe(false);
    expect(isBadPower('goldstar')).toBe(false);
  });
});

describe('float text', () => {
  it('lives about 0.8 s, fades out and rises', () => {
    expect(FLOAT_LIFE).toBeCloseTo(0.8);
    const a = floatTextState(0);
    expect(a.alpha).toBe(1);
    expect(a.rise).toBe(0);
    expect(a.done).toBe(false);
    const mid = floatTextState(0.6);
    expect(mid.alpha).toBeLessThan(1);
    expect(mid.alpha).toBeGreaterThan(0);
    expect(mid.rise).toBeGreaterThan(a.rise);
    expect(floatTextState(0.8).done).toBe(true);
    expect(floatTextState(5).alpha).toBe(0);
  });
});

describe('paddle width animation', () => {
  it('converges to the target within ~0.5 s and never overshoots', () => {
    let w = 96;
    for (let i = 0; i < 30; i++) {
      w = lerpTowards(w, 160, 1 / 60);
      expect(w).toBeLessThanOrEqual(160);
    }
    expect(w).toBe(160);
    let s = 160;
    for (let i = 0; i < 30; i++) s = lerpTowards(s, 64, 1 / 60);
    expect(s).toBe(64);
  });
  it('is mostly done after 0.15 s', () => {
    let w = 96;
    for (let i = 0; i < 9; i++) w = lerpTowards(w, 128, 1 / 60);
    expect(128 - w).toBeLessThan(3);
  });
});

describe('ball interpolation', () => {
  const out = { x: 0, y: 0 };
  it('interpolates when counts match', () => {
    const prev = [{ x: 0, y: 0 }];
    ballRenderPos(prev, 0, 1, { x: 10, y: 20 }, false, 0.5, out);
    expect(out).toEqual({ x: 5, y: 10 });
  });
  it('uses the current position when the ball count changed, the ball is stuck, or it teleported', () => {
    const prev = [{ x: 0, y: 0 }];
    ballRenderPos(prev, 0, 3, { x: 10, y: 20 }, false, 0.5, out);
    expect(out).toEqual({ x: 10, y: 20 });
    ballRenderPos(prev, 0, 1, { x: 10, y: 20 }, true, 0.5, out);
    expect(out).toEqual({ x: 10, y: 20 });
    ballRenderPos(prev, 0, 1, { x: 500, y: 20 }, false, 0.5, out);
    expect(out).toEqual({ x: 500, y: 20 });
    ballRenderPos(prev, 2, 3, { x: 7, y: 7 }, false, 0.5, out);
    expect(out).toEqual({ x: 7, y: 7 });
  });
  it('snapshotBalls reuses objects and tracks length', () => {
    const buf = snapshotBalls([{ x: 1, y: 2 }, { x: 3, y: 4 }], []);
    const first = buf[0];
    snapshotBalls([{ x: 9, y: 9 }], buf);
    expect(buf).toHaveLength(1);
    expect(buf[0]).toBe(first);
    expect(buf[0]).toEqual({ x: 9, y: 9 });
  });
});
