import { describe, expect, it } from 'vitest';
import { clampKnob, stickAxis, stickMoveAxis, STICK_FULL_SPEED, STICK_RADIUS } from '../src/input/stick';
import { parseSettings } from '../src/input/settings';
import { introHint } from '../src/game/hints';
import { shouldHoldWakeLock } from '../src/game/wakeLock';

describe('stick math', () => {
  it('dead zone, clamp, symmetry, monotonic', () => {
    expect(stickAxis(0)).toBe(0);
    expect(stickAxis(STICK_RADIUS * 0.1)).toBe(0);
    expect(stickAxis(STICK_RADIUS)).toBeCloseTo(1);
    expect(stickAxis(STICK_RADIUS * 5)).toBeCloseTo(1);
    expect(stickAxis(-STICK_RADIUS * 5)).toBeCloseTo(-1);
    expect(stickAxis(-20)).toBeCloseTo(-stickAxis(20));
    let prev = 0;
    for (let d = 0; d <= STICK_RADIUS; d += 4) {
      const a = stickAxis(d);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(stickAxis(STICK_RADIUS * 0.56)).toBeLessThan(0.56);
  });
  it('clampKnob limits to the radius', () => {
    const k = clampKnob(300, 400, 50);
    expect(Math.hypot(k.x, k.y)).toBeCloseTo(50);
    expect(clampKnob(10, 5, 50)).toEqual({ x: 10, y: 5 });
  });
  it('full deflection crosses the field in about 0.55 s', () => {
    expect(540 / (STICK_FULL_SPEED * 1)).toBeCloseTo(0.55);
    expect(stickMoveAxis(1, 1, 700) * 700).toBeCloseTo(STICK_FULL_SPEED);
    expect(stickMoveAxis(0.5, 2, 700)).toBeCloseTo(stickMoveAxis(1, 1, 700));
  });
});

describe('stick settings and hints', () => {
  it('parses stick mode and speed, old saves stay valid', () => {
    expect(parseSettings(JSON.stringify({ mode: 'stick', stickSpeed: 1.3 }), true)).toMatchObject({ mode: 'stick', stickSpeed: 1.3 });
    expect(parseSettings(JSON.stringify({ mode: 'stick', stickSpeed: 9 }), true).stickSpeed).toBe(1.6);
    const old = parseSettings(JSON.stringify({ mode: 'drag', tiltSensitivity: 3 }), true);
    expect(old.mode).toBe('drag');
    expect(old.stickSpeed).toBe(1);
    expect(parseSettings(JSON.stringify({ mode: 'bogus' }), false).mode).toBe('drag');
  });
  it('stick intro hint', () => {
    expect(introHint('Go', true, 'stick')).toContain('stick on the left');
  });
});

describe('wake lock policy', () => {
  const base = { started: true, paused: false, hidden: false, status: 'playing' };
  it('holds while serving or playing', () => {
    expect(shouldHoldWakeLock(base)).toBe(true);
    expect(shouldHoldWakeLock({ ...base, status: 'serve' })).toBe(true);
  });
  it('releases on pause, menus, hidden tab, title, end states', () => {
    expect(shouldHoldWakeLock({ ...base, paused: true })).toBe(false);
    expect(shouldHoldWakeLock({ ...base, hidden: true })).toBe(false);
    expect(shouldHoldWakeLock({ ...base, started: false })).toBe(false);
    expect(shouldHoldWakeLock({ ...base, status: 'won' })).toBe(false);
    expect(shouldHoldWakeLock({ ...base, status: 'gameover' })).toBe(false);
  });
});
