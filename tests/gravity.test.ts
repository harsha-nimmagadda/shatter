import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RANGE_DEG,
  MIN_RANGE_DEG,
  RAD,
  angleBetween,
  computeCalibration,
  cross,
  defaultCalibration,
  dot,
  gravityFromOrientation,
  length,
  lowPassVec,
  normalize,
  normalizeScreenAngle,
  parseCalibration,
  rangeScale,
  screenUp,
  signedAngleAbout,
  steadySuffix,
  tiltAngle,
  tiltAxis,
  type TiltCalibration,
  type Vec3,
} from '../src/input/gravity';
import { Calibrator } from '../src/input/calibration';
import { defaultSettings, parseSettings } from '../src/input/settings';

/** Device-frame up vector for a phone held at screen rotation `A` with the screen pitched back `pitch` and rolled `roll`. */
function held(A: number, pitch: number, roll: number): Vec3 {
  const sg = gravityFromOrientation(pitch, roll); // same formula, but in screen axes (right, up, normal)
  const right: Vec3 = A === 90 ? [0, -1, 0] : A === 180 ? [-1, 0, 0] : A === 270 ? [0, 1, 0] : [1, 0, 0];
  const up = screenUp(A);
  return [sg[0] * right[0] + sg[1] * up[0], sg[0] * right[1] + sg[1] * up[1], sg[0] * right[2] + sg[1] * up[2] + sg[2]];
}

const near = (a: number, b: number, tol = 0.05): void => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('vector basics', () => {
  it('gravityFromOrientation matches the device frame', () => {
    const flat = gravityFromOrientation(0, 0);
    expect([flat[0], flat[1], flat[2]].map((v) => Math.round(v * 1000) / 1000 + 0)).toEqual([0, 0, 1]);
    const upright = gravityFromOrientation(90, 0);
    near(upright[1], 1, 1e-9);
    const rollRight = gravityFromOrientation(0, 90); // right side down
    near(rollRight[0], -1, 1e-9);
    const faceDown = gravityFromOrientation(180, 0);
    near(faceDown[2], -1, 1e-9);
  });
  it('angleBetween / signedAngleAbout', () => {
    near(angleBetween([1, 0, 0], [0, 1, 0]), 90, 1e-9);
    near(angleBetween([1, 0, 0], [1, 0, 0]), 0, 1e-9);
    near(angleBetween([1, 0, 0], [-1, 0, 0]), 180, 1e-9);
    near(signedAngleAbout([0, 1, 0], [1, 0, 0], [0, 0, 1]), 90, 1e-9);
    near(signedAngleAbout([1, 0, 0], [0, 1, 0], [0, 0, 1]), -90, 1e-9);
    expect(signedAngleAbout([0, 0, 1], [1, 0, 0], [0, 0, 1])).toBe(0); // gravity along the axis: degenerate, no NaN
  });
  it('lowPassVec reaches ~63% after one time constant and ignores dt <= 0', () => {
    const v = lowPassVec([0, 0, 0], [1, 0, 0], 0.08, 0.08);
    near(v[0], 1 - Math.exp(-1), 1e-9);
    expect(lowPassVec([0, 1, 0], [1, 0, 0], 0)).toEqual([0, 1, 0]);
    expect(lowPassVec(null, [1, 2, 3], 0.016)).toEqual([1, 2, 3]);
  });
  it('screen angles', () => {
    expect(normalizeScreenAngle(-90)).toBe(270);
    expect(normalizeScreenAngle(360)).toBe(0);
    expect(normalizeScreenAngle(89.7)).toBe(90);
    expect(normalizeScreenAngle(NaN)).toBe(0);
    expect(screenUp(90)).toEqual([1, 0, 0]);
    expect(screenUp(270)).toEqual([-1, 0, 0]);
  });
});

describe('default calibration (no saved one): follows the screen orientation', () => {
  for (const A of [0, 90, 180, 270]) {
    it(`screen angle ${A}: right side down steers right, left side down steers left`, () => {
      const cal = defaultCalibration(held(A, 50, 0), A);
      near(tiltAngle(held(A, 50, 0), cal), 0, 1e-6);
      near(tiltAngle(held(A, 50, 20), cal), 20, 0.01);
      near(tiltAngle(held(A, 50, -15), cal), -15, 0.01);
    });
  }
  it('the same neutral with the wrong screen angle steers the wrong way (what the old Euler code got wrong on iPad landscape)', () => {
    const g0 = held(90, 50, 0);
    const wrong = defaultCalibration(g0, 0);
    // Rolling about the landscape axis barely registers about the portrait axis.
    expect(Math.abs(tiltAngle(held(90, 50, 20), wrong))).toBeLessThan(5);
  });
  it('lying flat face up works too', () => {
    const cal = defaultCalibration(held(0, 0, 0), 0);
    near(tiltAngle(held(0, 0, 18), cal), 18, 0.01);
    near(tiltAngle(held(0, 0, -18), cal), -18, 0.01);
  });
  it('default range matches the old sensitivity scale', () => {
    expect(DEFAULT_RANGE_DEG).toBeCloseTo(26.67, 1);
    expect(rangeScale(5)).toBeCloseTo(1);
    expect(rangeScale(10)).toBeLessThan(rangeScale(5));
    expect(rangeScale(1)).toBeGreaterThan(1);
  });
});

describe('3-point calibration', () => {
  const ok = (g0: Vec3, gL: Vec3, gR: Vec3): TiltCalibration => {
    const r = computeCalibration(g0, gL, gR);
    if (!r.ok) throw new Error(`calibration failed: ${r.error}`);
    return r.cal;
  };

  it('portrait: left is negative, right positive, neutral is 0', () => {
    const cal = ok(held(0, 50, 0), held(0, 50, -25), held(0, 50, 25));
    near(tiltAngle(held(0, 50, 0), cal), 0, 1e-6);
    expect(tiltAngle(held(0, 50, -25), cal)).toBeCloseTo(-cal.left, 4);
    expect(tiltAngle(held(0, 50, 25), cal)).toBeCloseTo(cal.right, 4);
    expect(tiltAngle(held(0, 50, 10), cal)).toBeGreaterThan(0);
    expect(tiltAngle(held(0, 50, -10), cal)).toBeLessThan(0);
    near(cal.left, cal.right, 0.05); // symmetric hold
    expect(length(cal.n)).toBeCloseTo(1);
  });

  it('axis hits exactly -1 / +1 at the captured extremes', () => {
    const cal = ok(held(0, 50, 0), held(0, 50, -25), held(0, 50, 25));
    expect(tiltAxis(tiltAngle(held(0, 50, -25), cal), cal)).toBeCloseTo(-1, 6);
    expect(tiltAxis(tiltAngle(held(0, 50, 25), cal), cal)).toBeCloseTo(1, 6);
    expect(tiltAxis(tiltAngle(held(0, 50, 0), cal), cal)).toBe(0);
  });

  for (const A of [0, 90, 180, 270]) {
    it(`landscape/portrait/upside down (screen ${A}): same result, no screen axes involved`, () => {
      const cal = ok(held(A, 55, 0), held(A, 55, -22), held(A, 55, 22));
      expect(tiltAxis(tiltAngle(held(A, 55, -22), cal), cal)).toBeCloseTo(-1, 6);
      expect(tiltAxis(tiltAngle(held(A, 55, 22), cal), cal)).toBeCloseTo(1, 6);
      expect(tiltAxis(tiltAngle(held(A, 55, 11), cal), cal)).toBeGreaterThan(0.3);
    });
  }

  it('lying flat facing up', () => {
    const cal = ok(held(0, 0, 0), held(0, 0, -20), held(0, 0, 20));
    near(cal.left, 20, 0.01);
    near(cal.right, 20, 0.01);
    expect(tiltAxis(tiltAngle(held(0, 0, 20), cal), cal)).toBeCloseTo(1, 6);
  });

  it('lying in bed, phone above the face (screen facing down, past vertical)', () => {
    const g0 = held(0, 125, 0);
    expect(g0[2]).toBeLessThan(0); // screen normal points down
    const cal = ok(g0, held(0, 125, -24), held(0, 125, 24));
    expect(tiltAxis(tiltAngle(held(0, 125, -24), cal), cal)).toBeCloseTo(-1, 6);
    expect(tiltAxis(tiltAngle(held(0, 125, 24), cal), cal)).toBeCloseTo(1, 6);
    expect(tiltAxis(tiltAngle(g0, cal), cal)).toBe(0);
  });

  it('upside-down hold: left/right still follow the player\'s two captures', () => {
    const cal = ok(held(180, 40, 0), held(180, 40, -20), held(180, 40, 20));
    expect(tiltAngle(held(180, 40, -20), cal)).toBeLessThan(0);
    expect(tiltAngle(held(180, 40, 20), cal)).toBeGreaterThan(0);
  });

  it('asymmetric ranges are kept separately', () => {
    const cal = ok(held(0, 50, 0), held(0, 50, -14), held(0, 50, 40));
    expect(cal.right).toBeGreaterThan(cal.left * 1.8);
    // Each side reaches full deflection at its own captured angle.
    expect(tiltAxis(tiltAngle(held(0, 50, -14), cal), cal)).toBeCloseTo(-1, 6);
    expect(tiltAxis(tiltAngle(held(0, 50, 40), cal), cal)).toBeCloseTo(1, 6);
    // Halfway on the short side is a bigger deflection than halfway on the long side.
    const l = Math.abs(tiltAxis(-cal.left / 2, cal));
    const r = Math.abs(tiltAxis(cal.right / 2, cal));
    expect(Math.abs(l - r)).toBeLessThan(0.08);
    expect(Math.abs(tiltAxis(-5, cal))).toBeGreaterThan(Math.abs(tiltAxis(5, cal)));
  });

  it('a neutral hold off-centre between the extremes is respected', () => {
    const cal = ok(held(0, 50, 10), held(0, 50, -20), held(0, 50, 30));
    expect(tiltAngle(held(0, 50, 10), cal)).toBeCloseTo(0, 5);
    expect(cal.left).toBeGreaterThan(cal.right - 1); // 30 away vs 20 away: left larger
    expect(cal.left).toBeGreaterThan(MIN_RANGE_DEG);
  });

  it('enforces the minimum range per side', () => {
    const cal = ok(held(0, 50, -9), held(0, 50, -9), held(0, 50, 25)); // neutral == left extreme
    expect(cal.left).toBe(MIN_RANGE_DEG);
    expect(cal.right).toBeGreaterThan(MIN_RANGE_DEG);
  });

  it('degenerate captures are rejected', () => {
    const g0 = held(0, 50, 0);
    expect(computeCalibration(g0, g0, g0)).toEqual({ ok: false, error: 'tooClose' });
    expect(computeCalibration(g0, held(0, 50, -3), held(0, 50, 3))).toEqual({ ok: false, error: 'tooClose' });
    expect(computeCalibration(g0, [0, 0, 0], held(0, 50, 20))).toEqual({ ok: false, error: 'degenerate' });
    expect(computeCalibration(g0, [0, 0, 1], [0, 0, -1])).toEqual({ ok: false, error: 'degenerate' });
    expect(computeCalibration([0, 0, 0], held(0, 50, -20), held(0, 50, 20))).toEqual({ ok: false, error: 'degenerate' });
  });

  it('neutral outside the two extremes is rejected', () => {
    const r = computeCalibration(held(0, 50, 0), held(0, 50, 20), held(0, 50, 45));
    expect(r).toEqual({ ok: false, error: 'neutralOutside' });
  });

  it('the sensitivity slider scales the captured range', () => {
    const cal = ok(held(0, 50, 0), held(0, 50, -25), held(0, 50, 25));
    const a = tiltAngle(held(0, 50, 10), cal);
    expect(tiltAxis(a, cal, rangeScale(10))).toBeGreaterThan(tiltAxis(a, cal, rangeScale(5)));
    expect(tiltAxis(a, cal, rangeScale(1))).toBeLessThan(tiltAxis(a, cal, rangeScale(5)));
  });
});

describe('tiltAxis', () => {
  const cal: TiltCalibration = { g0: [0, 0, 1], n: [0, -1, 0], left: 20, right: 30 };
  it('dead zone, per-side range, clamp, invert', () => {
    expect(tiltAxis(0.9, cal)).toBe(0);
    expect(tiltAxis(-1, cal)).toBe(0);
    expect(tiltAxis(2, cal)).toBeGreaterThan(0);
    expect(tiltAxis(-20, cal)).toBeCloseTo(-1);
    expect(tiltAxis(30, cal)).toBeCloseTo(1);
    expect(tiltAxis(90, cal)).toBe(1);
    expect(tiltAxis(-90, cal)).toBe(-1);
    expect(tiltAxis(10, cal, 1, true)).toBeCloseTo(-tiltAxis(10, cal));
  });
  it('is continuous leaving the dead zone', () => {
    expect(tiltAxis(1.05, cal)).toBeLessThan(0.01);
  });
});

describe('stored calibration', () => {
  const cal: TiltCalibration = { g0: [0, 0.6, 0.8], n: [0, -0.8, 0.6], left: 18, right: 24 };
  it('round-trips through settings', () => {
    const s = { ...defaultSettings(true), tiltCal: cal };
    const back = parseSettings(JSON.stringify(s), true);
    expect(back.tiltCal).not.toBeNull();
    expect(back.tiltCal?.left).toBe(18);
    expect(back.tiltCal?.right).toBe(24);
    expect(length(back.tiltCal!.g0)).toBeCloseTo(1);
    expect(dot(back.tiltCal!.n, cal.n)).toBeCloseTo(1);
  });
  it('old settings (with tiltNeutral, no tiltCal) still parse', () => {
    const old = parseSettings(JSON.stringify({ mode: 'tilt', tiltSensitivity: 6, tiltNeutral: 12, invertTilt: true }), true);
    expect(old.mode).toBe('tilt');
    expect(old.tiltSensitivity).toBe(6);
    expect(old.invertTilt).toBe(true);
    expect(old.tiltCal).toBeNull();
  });
  it('malformed calibrations are dropped', () => {
    expect(parseCalibration(null)).toBeNull();
    expect(parseCalibration({ g0: [0, 0, 0], n: [0, 1, 0], left: 10, right: 10 })).toBeNull();
    expect(parseCalibration({ g0: [0, 0, 1], n: [0, 1], left: 10, right: 10 })).toBeNull();
    expect(parseCalibration({ g0: [0, 0, 1], n: [0, 1, 0], left: 'x', right: 10 })).toBeNull();
    expect(parseCalibration({ g0: [0, 0, 1], n: [0, 1, NaN], left: 10, right: 10 })).toBeNull();
    expect(parseSettings(JSON.stringify({ tiltCal: 'junk' }), true).tiltCal).toBeNull();
  });
  it('clamps absurd ranges', () => {
    const c = parseCalibration({ g0: [0, 0, 1], n: [0, 1, 0], left: 0.1, right: 500 });
    expect(c?.left).toBe(MIN_RANGE_DEG);
    expect(c?.right).toBe(90);
  });
});

describe('steadiness', () => {
  const at = (t: number, deg: number) => ({ t, g: normalize([Math.sin(deg * RAD), 0, Math.cos(deg * RAD)]) as Vec3 });
  it('measures the steady run at the end of the history', () => {
    const s = [at(0, 30), at(100, 20), at(200, 0), at(300, 0.5), at(400, -0.4), at(500, 0.2)];
    const r = steadySuffix(s, 2);
    expect(r.count).toBe(4);
    expect(r.durationMs).toBe(300);
    expect(angleBetween(r.mean, [0, 0, 1])).toBeLessThan(1);
  });
  it('a recent jump resets the run', () => {
    const s = [at(0, 0), at(100, 0), at(200, 0), at(300, 15)];
    expect(steadySuffix(s, 2).count).toBe(1);
    expect(steadySuffix([], 2).count).toBe(0);
  });
});

describe('Calibrator (wizard state machine)', () => {
  const HZ = 60;
  /** Runs `ms` of samples of pose g (with optional jitter in degrees) starting at t0; returns the end time. */
  function hold(c: Calibrator, g: Vec3, t0: number, ms: number, jitter = 0): number {
    let t = t0;
    for (let i = 0; i < (ms / 1000) * HZ; i++) {
      t += 1000 / HZ;
      const j = jitter * Math.sin(i * 2.1);
      c.feed(normalize([g[0] + j * RAD, g[1], g[2]]), t);
    }
    return t;
  }
  /** Moves from pose a to pose b in 300 ms (not steady, so nothing is captured on the way). */
  function sweep(c: Calibrator, a: Vec3, b: Vec3, t0: number): number {
    let t = t0;
    for (let i = 1; i <= 18; i++) {
      t += 1000 / HZ;
      const k = i / 18;
      c.feed(normalize([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]), t);
    }
    return t;
  }
  const g0 = held(0, 50, 0);
  const gL = held(0, 50, -25);
  const gR = held(0, 50, 25);

  it('does nothing until the player taps READY', () => {
    const c = new Calibrator();
    hold(c, g0, 0, 1500);
    expect(c.step).toBe('neutral');
    expect(c.g0).toBeNull();
  });

  it('runs neutral -> left -> right and produces a valid calibration', () => {
    const c = new Calibrator();
    c.arm(0);
    let t = hold(c, g0, 0, 700);
    expect(c.step).toBe('left');
    t = sweep(c, g0, gL, t);
    t = hold(c, gL, t, 700);
    expect(c.step).toBe('right');
    t = sweep(c, gL, gR, t);
    t = hold(c, gR, t, 700);
    expect(c.step).toBe('done');
    const cal = c.result!;
    expect(tiltAngle(gL, cal)).toBeLessThan(-10);
    expect(tiltAngle(gR, cal)).toBeGreaterThan(10);
    expect(t).toBeGreaterThan(0);
  });

  it('requires steadiness: a wobbling phone never captures neutral and gets a kind nudge', () => {
    const c = new Calibrator();
    c.arm(0);
    // +-6 degrees of wobble.
    hold(c, g0, 0, 4000, 6);
    expect(c.step).toBe('neutral');
    expect(c.message).toMatch(/steady/i);
    // Then it settles and the capture goes through.
    hold(c, g0, 5000, 800);
    expect(c.step).toBe('left');
  });

  it('left/right captures wait until the tilt is big enough', () => {
    const c = new Calibrator();
    c.arm(0);
    let t = hold(c, g0, 0, 700);
    t = hold(c, held(0, 50, -3), t, 1500); // barely tilted: not a capture
    expect(c.step).toBe('left');
    expect(c.progress).toBeLessThan(0.5); // approaching, but not a capture
  });

  it('left and right are captured as peaks of a swing: no holding still needed', () => {
    const c = new Calibrator();
    c.arm(0);
    let t = hold(c, g0, 0, 500);
    expect(c.step).toBe('left');
    t = sweep(c, g0, gL, t); // swing out...
    expect(c.step).toBe('left'); // ...nothing yet: still on its way out
    t = sweep(c, gL, g0, t); // ...and back
    expect(c.step).toBe('right');
    expect(angleBetween(c.gL!, gL)).toBeLessThan(2); // the extreme, not wherever the swing turned back
    t = sweep(c, g0, gR, t);
    t = sweep(c, gR, g0, t);
    expect(c.step).toBe('done');
    const cal = c.result!;
    expect(tiltAngle(gL, cal)).toBeLessThan(-0.85 * cal.left);
    expect(tiltAngle(gR, cal)).toBeGreaterThan(0.85 * cal.right);
    expect(t).toBeGreaterThan(0);
  });

  it('neutral tolerates a small wobble (+-1.8 degrees) and needs only 0.4 s', () => {
    const c = new Calibrator();
    c.arm(0);
    hold(c, g0, 0, 600, 1.8);
    expect(c.step).toBe('left');
  });

  it('a swing that does not go far enough is not captured and gets a nudge after a while', () => {
    const c = new Calibrator();
    c.arm(0);
    let t = hold(c, g0, 0, 500);
    for (let i = 0; i < 4; i++) {
      t = sweep(c, g0, held(0, 50, -4), t);
      t = sweep(c, held(0, 50, -4), g0, t);
    }
    t = hold(c, g0, t, 3000);
    expect(c.step).toBe('left');
    expect(c.message).toMatch(/swing out/i);
  });

  it('the right capture cannot be the same pose as left ("now tilt the other way")', () => {
    const c = new Calibrator();
    c.arm(0);
    let t = hold(c, g0, 0, 700);
    t = sweep(c, g0, gL, t);
    t = hold(c, gL, t, 700);
    expect(c.step).toBe('right');
    t = hold(c, gL, t, 1200);
    expect(c.step).toBe('right');
    expect(c.message).toMatch(/other way/i);
  });

  it('a right tilt on the left side is not accepted (now tilt the other way)', () => {
    const c = new Calibrator();
    c.arm(0);
    let t = hold(c, g0, 0, 700);
    t = sweep(c, g0, held(0, 50, -20), t);
    t = hold(c, held(0, 50, -20), t, 700);
    t = sweep(c, held(0, 50, -20), held(0, 50, -50), t);
    t = hold(c, held(0, 50, -50), t, 700);
    expect(c.step).toBe('right'); // the other side is still asked for
    expect(c.message).toMatch(/other way/i);
    expect(c.result).toBeNull();
    expect(t).toBeGreaterThan(0);
  });

  it('reset starts over', () => {
    const c = new Calibrator();
    c.arm(0);
    hold(c, g0, 0, 700);
    c.reset();
    expect(c.step).toBe('neutral');
    expect(c.g0).toBeNull();
  });
});

describe('math sanity', () => {
  it('cross/dot', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });
});
