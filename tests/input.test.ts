import { describe, expect, it } from 'vitest';
import { applyDeadzone } from '../src/input/gamepad';
import { EdgeDetector, Latch } from '../src/input/latch';
import { keyboardAxis } from '../src/input/keyboard';
import { isTap, relativeDragX } from '../src/input/pointer';
import { parseSettings } from '../src/input/settings';
import { buildInput } from '../src/input/controls';
import { screenTiltAngle, smooth, tiltRangeDeg, tiltToPaddleX } from '../src/input/tilt';

const W = 540;
const PW = 96;

describe('tilt', () => {
  it('tiltRangeDeg endpoints', () => {
    expect(tiltRangeDeg(1)).toBeCloseTo(40);
    expect(tiltRangeDeg(10)).toBeCloseTo(10);
    expect(tiltRangeDeg(5.5)).toBeCloseTo(25);
  });
  it('neutral maps to centre', () => {
    expect(tiltToPaddleX(7, 7, 5, false, W, PW)).toBe(W / 2);
  });
  it('full range reaches the wall, beyond is clamped', () => {
    const r = tiltRangeDeg(5);
    expect(tiltToPaddleX(r, 0, 5, false, W, PW)).toBeCloseTo(W - PW / 2);
    expect(tiltToPaddleX(-r, 0, 5, false, W, PW)).toBeCloseTo(PW / 2);
    expect(tiltToPaddleX(r * 3, 0, 5, false, W, PW)).toBe(W - PW / 2);
    expect(tiltToPaddleX(-r * 3, 0, 5, false, W, PW)).toBe(PW / 2);
  });
  it('dead zone of 1 degree', () => {
    expect(tiltToPaddleX(0.9, 0, 5, false, W, PW)).toBe(W / 2);
    expect(tiltToPaddleX(-1, 0, 5, false, W, PW)).toBe(W / 2);
    expect(tiltToPaddleX(2, 0, 5, false, W, PW)).toBeGreaterThan(W / 2);
  });
  it('invert flips direction', () => {
    const a = tiltToPaddleX(10, 0, 5, false, W, PW);
    const b = tiltToPaddleX(10, 0, 5, true, W, PW);
    expect(a - W / 2).toBeCloseTo(W / 2 - b);
    expect(b).toBeLessThan(W / 2);
  });
  it('screenTiltAngle per orientation', () => {
    const e = { beta: 10, gamma: 20 };
    expect(screenTiltAngle(e, 0)).toBe(20);
    expect(screenTiltAngle(e, 180)).toBe(-20);
    expect(screenTiltAngle(e, 90)).toBe(10);
    expect(screenTiltAngle(e, 270)).toBe(-10);
    expect(screenTiltAngle(e, -90)).toBe(-10);
  });
  it('smooth converges and is frame-rate independent', () => {
    let v = 0;
    for (let i = 0; i < 200; i++) v = smooth(v, 100, 1 / 60);
    expect(v).toBeCloseTo(100, 3);
    const dt = 1 / 120;
    const two = smooth(smooth(0, 100, dt), 100, dt);
    const one = smooth(0, 100, 2 * dt);
    expect(one).toBeCloseTo(two, 6);
    expect(smooth(5, 100, 0)).toBe(5);
  });
});

describe('pointer', () => {
  it('relativeDragX scales by sensitivity and clamps', () => {
    expect(relativeDragX(270, 100, 140, 1.5, W, PW)).toBeCloseTo(330);
    expect(relativeDragX(270, 100, 60, 2, W, PW)).toBeCloseTo(190);
    expect(relativeDragX(270, 100, 1000, 3, W, PW)).toBe(W - PW / 2);
    expect(relativeDragX(270, 100, -1000, 3, W, PW)).toBe(PW / 2);
  });
  it('isTap thresholds', () => {
    expect(isTap(100, 3)).toBe(true);
    expect(isTap(300, 3)).toBe(false);
    expect(isTap(100, 12)).toBe(false);
  });
});

describe('keyboard and gamepad', () => {
  it('keyboardAxis', () => {
    expect(keyboardAxis(true, false)).toBe(-1);
    expect(keyboardAxis(false, true)).toBe(1);
    expect(keyboardAxis(true, true)).toBe(0);
    expect(keyboardAxis(false, false)).toBe(0);
  });
  it('applyDeadzone', () => {
    expect(applyDeadzone(0.19, 0.2)).toBe(0);
    expect(applyDeadzone(-0.2, 0.2)).toBe(0);
    expect(applyDeadzone(0.6, 0.2)).toBeCloseTo(0.5);
    expect(applyDeadzone(-1, 0.2)).toBeCloseTo(-1);
    expect(applyDeadzone(0.2001, 0.2)).toBeLessThan(0.001);
  });
  it('EdgeDetector fires once per press', () => {
    const e = new EdgeDetector();
    expect([e.update(false), e.update(true), e.update(true), e.update(false), e.update(true)]).toEqual([
      false,
      true,
      false,
      false,
      true,
    ]);
  });
});

describe('fire latch', () => {
  it('press is consumed exactly once across several inputs', () => {
    const l = new Latch();
    l.press();
    expect(buildInput(0, 0, null, l).fire).toBe(true);
    expect(buildInput(0, 0, null, l).fire).toBe(false);
    expect(buildInput(0, 0, null, l).fire).toBe(false);
  });
  it('a press with no physics step is delivered on the next one, not duplicated', () => {
    const l = new Latch();
    l.press(); // frame 1: no steps run
    l.press(); // repeated press before delivery still yields one fire
    expect(buildInput(0, 0, null, l).fire).toBe(true);
    expect(buildInput(0, 0, null, l).fire).toBe(false);
  });
  it('keyboard axis wins over gamepad', () => {
    const l = new Latch();
    expect(buildInput(1, -0.5, 100, l).moveAxis).toBe(1);
    expect(buildInput(0, -0.5, 100, l).moveAxis).toBe(-0.5);
  });
});

describe('settings', () => {
  it('defaults by touch and tolerates garbage', () => {
    expect(parseSettings(null, true).mode).toBe('tilt');
    expect(parseSettings(null, false).mode).toBe('drag');
    expect(parseSettings('{not json', true).tiltSensitivity).toBe(5);
    expect(parseSettings('42', false).dragSensitivity).toBe(1.5);
    const s = parseSettings('{"mode":"x","tiltSensitivity":99,"dragSensitivity":"a","invertTilt":true}', true);
    expect(s.mode).toBe('tilt');
    expect(s.tiltSensitivity).toBe(10);
    expect(s.dragSensitivity).toBe(1.5);
    expect(s.invertTilt).toBe(true);
  });
});
