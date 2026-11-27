import { describe, expect, it } from 'vitest';
import {
  STICK_CURVE,
  STICK_DEADZONE,
  STICK_EASE_S,
  STICK_FULL_SPEED,
  STICK_MIN_RADIUS,
  clampKnob,
  easeAxis,
  followBase,
  isStickTap,
  stickAxis,
  stickMoveAxis,
  stickRadius,
} from '../src/input/stick';
import { parseSettings } from '../src/input/settings';
import { introHint } from '../src/game/hints';
import { shouldHoldWakeLock } from '../src/game/wakeLock';

const R = 50;

describe('stick radius', () => {
  it('is 11% of the short side, never below 44 px', () => {
    expect(stickRadius(320, 568)).toBe(STICK_MIN_RADIUS);
    expect(stickRadius(390, 844)).toBe(STICK_MIN_RADIUS); // 42.9 -> 44
    expect(stickRadius(768, 1024)).toBeCloseTo(84.48);
    // Landscape tablet uses the short side, not the long one.
    expect(stickRadius(1024, 768)).toBeCloseTo(84.48);
    expect(stickRadius(844, 390)).toBe(STICK_MIN_RADIUS);
  });
});

describe('stick response', () => {
  it('dead zone, clamp, symmetry, monotonic', () => {
    expect(stickAxis(0, R)).toBe(0);
    expect(stickAxis(R * STICK_DEADZONE * 0.9, R)).toBe(0);
    expect(stickAxis(R, R)).toBeCloseTo(1);
    expect(stickAxis(R * 5, R)).toBeCloseTo(1);
    expect(stickAxis(-R * 5, R)).toBeCloseTo(-1);
    expect(stickAxis(-20, R)).toBeCloseTo(-stickAxis(20, R));
    let prev = 0;
    for (let d = 0; d <= R; d += 2) {
      const a = stickAxis(d, R);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });
  it('uses a ~1.6 power curve: small deflections give fine control', () => {
    expect(STICK_CURVE).toBeCloseTo(1.6);
    const half = stickAxis(R * 0.5, R);
    expect(half).toBeCloseTo(Math.pow((0.5 - STICK_DEADZONE) / (1 - STICK_DEADZONE), 1.6));
    expect(half).toBeLessThan(0.33);
    expect(stickAxis(R * 0.25, R)).toBeLessThan(0.1);
    // Smooth start: no jump when leaving the dead zone.
    expect(stickAxis(R * (STICK_DEADZONE + 0.01), R)).toBeLessThan(0.01);
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

describe('floating base', () => {
  it('stays put while the thumb is inside the radius', () => {
    expect(followBase(100, 200, 130, 220, R)).toEqual({ x: 100, y: 200 });
  });
  it('follows the thumb so it sits exactly on the ring (never runs out)', () => {
    const b = followBase(100, 200, 400, 200, R);
    expect(b.x).toBeCloseTo(350);
    expect(b.y).toBeCloseTo(200);
    const d = followBase(0, 0, 300, 400, R); // 3-4-5 direction
    expect(Math.hypot(300 - d.x, 400 - d.y)).toBeCloseTo(R);
    expect(d.x / d.y).toBeCloseTo(0.75);
  });
  it('reversing direction responds immediately after a long drag', () => {
    let base = { x: 100, y: 300 };
    for (let x = 100; x <= 500; x += 20) base = followBase(base.x, base.y, x, 300, R);
    expect(500 - base.x).toBeCloseTo(R);
    // Thumb comes back 25 px: the knob is already 25 px inside the ring, axis drops straight away.
    base = followBase(base.x, base.y, 475, 300, R);
    expect(475 - base.x).toBeCloseTo(R - 25);
    expect(stickAxis(475 - base.x, R)).toBeLessThan(stickAxis(R, R));
  });
});

describe('velocity ease', () => {
  it('reaches ~63% after one time constant and converges', () => {
    expect(easeAxis(0, 1, STICK_EASE_S)).toBeCloseTo(1 - Math.exp(-1), 5);
    let v = 0;
    for (let i = 0; i < 60; i++) v = easeAxis(v, 1, 1 / 60);
    expect(v).toBe(1);
  });
  it('is frame-rate independent and ignores dt <= 0', () => {
    const one = easeAxis(0, 1, 1 / 30);
    const two = easeAxis(easeAxis(0, 1, 1 / 60), 1, 1 / 60);
    expect(one).toBeCloseTo(two, 6);
    expect(easeAxis(0.4, 1, 0)).toBe(0.4);
  });
  it('eases back to zero on release', () => {
    let v = 1;
    for (let i = 0; i < 20; i++) v = easeAxis(v, 0, 1 / 120);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.5);
    for (let i = 0; i < 200; i++) v = easeAxis(v, 0, 1 / 120);
    expect(v).toBe(0);
  });
});

describe('tap = fire', () => {
  it('quick, barely moved releases are taps', () => {
    expect(isStickTap(100, 3)).toBe(true);
    expect(isStickTap(180, 9.9)).toBe(true);
  });
  it('slow or moved releases are steering, not taps', () => {
    expect(isStickTap(181, 2)).toBe(false);
    expect(isStickTap(100, 10)).toBe(false);
    expect(isStickTap(400, 40)).toBe(false);
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
    expect(introHint('Go', true, 'stick')).toContain('Hold anywhere to steer');
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
