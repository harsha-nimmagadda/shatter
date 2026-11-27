import { describe, expect, it } from 'vitest';
import { ADAPT, AdaptiveTilt, QuickStart, axisFromSwings, percentile, principalDirection, rotateAbout } from '../src/input/adaptive';
import { angleBetween, dot, gravityFromOrientation, normalize, screenUp, tiltAngle, type TiltCalibration, type Vec3 } from '../src/input/gravity';

const DT = 1 / 60;

/** Device-frame up vector for a phone at screen rotation A, screen pitched back `pitch`, rolled `roll` (see gravity.test). */
function held(A: number, pitch: number, roll: number): Vec3 {
  const sg = gravityFromOrientation(pitch, roll);
  const right: Vec3 = A === 90 ? [0, -1, 0] : A === 180 ? [-1, 0, 0] : A === 270 ? [0, 1, 0] : [1, 0, 0];
  const up = screenUp(A);
  return [sg[0] * right[0] + sg[1] * up[0], sg[0] * right[1] + sg[1] * up[1], sg[0] * right[2] + sg[1] * up[2] + sg[2]];
}

interface Posture {
  name: string;
  /** Neutral up vector. */
  g0: Vec3;
  /** True roll axis (positive = steer right). */
  n: Vec3;
  /** The same axis made perpendicular to gravity: all a swing (a 1-D motion of gravity) can reveal, and equivalent for steering. */
  nEq: Vec3;
}
const mk = (name: string, g0: Vec3, n: Vec3): Posture => {
  const d = dot(n, g0);
  return { name, g0, n, nEq: normalize([n[0] - g0[0] * d, n[1] - g0[1] * d, n[2] - g0[2] * d]) };
};
const POSTURES: Posture[] = [
  mk('portrait', held(0, 50, 0), [0, -1, 0]),
  mk('landscape', held(90, 45, 0), [-1, 0, 0]),
  mk('lying down (flat face-up)', normalize([0.04, 0.12, 0.99]), [0, -1, 0]),
];

const at = (p: Posture, th: number): Vec3 => normalize(rotateAbout(p.g0, p.n, th));

/** Left first, then right: two cycles of a +-amp swing, starting at rest. */
function swingAngle(t: number, amp: number): number {
  if (t < 0.15) return 0;
  return -amp * Math.sin(2 * Math.PI * 0.75 * (t - 0.15));
}

function runQuick(p: Posture, amp: number, flip = false): QuickStart {
  const q = new QuickStart();
  for (let i = 0; i < 6 * 60 && q.phase !== 'done' && q.phase !== 'failed'; i++) {
    const t = i * DT;
    q.feed(at(p, flip ? -swingAngle(t, amp) : swingAngle(t, amp)), t * 1000);
  }
  return q;
}

describe('PCA helpers', () => {
  it('finds the main direction of a cloud', () => {
    const d = normalize([1, 2, -1]);
    const pts: Vec3[] = [];
    for (let i = -10; i <= 10; i++) pts.push([d[0] * i * 0.05 + 0.002 * Math.sin(i * 7), d[1] * i * 0.05 + 0.002 * Math.cos(i * 3), d[2] * i * 0.05]);
    const r = principalDirection(pts)!;
    expect(Math.abs(dot(r.d, d))).toBeGreaterThan(0.999);
    expect(r.var1 / r.total).toBeGreaterThan(0.99);
    expect(principalDirection([[0, 0, 1]])).toBeNull();
  });
  it('percentile interpolates', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.9)).toBeCloseTo(9);
    expect(percentile([], 0.5)).toBeNaN();
  });
  it('rotateAbout is right-handed', () => {
    const v = rotateAbout([1, 0, 0], [0, 0, 1], 90);
    expect(v[0]).toBeCloseTo(0);
    expect(v[1]).toBeCloseTo(1);
  });
  it('axisFromSwings: n is perpendicular to both the mean gravity and the swing', () => {
    const p = POSTURES[0];
    const gs = [-15, -8, 0, 8, 15, 8, 0, -8].map((a) => at(p, a));
    const ax = axisFromSwings(gs)!;
    expect(Math.abs(dot(ax.n, p.nEq))).toBeGreaterThan(0.99);
  });
});

describe('quick start (swing left and right)', () => {
  for (const p of POSTURES) {
    it(`recovers the steering axis, sign and range in ${p.name}`, () => {
      const q = runQuick(p, 20);
      expect(q.phase).toBe('done');
      const cal = q.result!;
      expect(dot(cal.n, p.nEq)).toBeGreaterThan(0.98); // sign: positive about n = right
      expect(angleBetween(cal.g0, p.g0)).toBeLessThan(4);
      // Physical size of a +-20 degree roll for this posture (a pitched phone moves gravity less than the roll angle).
      const e = angleBetween(at(p, 20), p.g0);
      for (const r of [cal.left, cal.right]) {
        expect(r).toBeGreaterThanOrEqual(Math.max(ADAPT.minRange, 0.55 * e) - 0.01);
        expect(r).toBeLessThanOrEqual(Math.max(ADAPT.minRange, 1.1 * e) + 0.01);
      }
      expect(tiltAngle(at(p, -20), cal)).toBeLessThan(-0.8 * e);
      expect(tiltAngle(at(p, 20), cal)).toBeGreaterThan(0.8 * e);
    });
  }
  it('finishes in about 3 s or less', () => {
    const q = new QuickStart();
    let t = 0;
    while (q.phase === 'left' || q.phase === 'right') {
      q.feed(at(POSTURES[0], swingAngle(t, 20)), t * 1000);
      t += DT;
      if (t > 10) break;
    }
    expect(q.phase).toBe('done');
    expect(t).toBeLessThan(3.3);
    expect(q.meter).toBe(1);
  });
  it('the left cue sets the sign: swinging the other way first flips the axis', () => {
    const p = POSTURES[0];
    const cal = runQuick(p, 20, true).result!;
    expect(dot(cal.n, p.nEq)).toBeLessThan(-0.98);
  });
  it('clamps ranges to 8..35 degrees', () => {
    const big = runQuick(POSTURES[0], 60).result!;
    expect(big.left).toBeLessThanOrEqual(ADAPT.maxRange);
    expect(big.right).toBeLessThanOrEqual(ADAPT.maxRange);
    const small = runQuick(POSTURES[0], 11).result!;
    expect(small.left).toBeGreaterThanOrEqual(ADAPT.minRange);
  });
  it('fails kindly when the phone barely moves', () => {
    const q = new QuickStart();
    for (let i = 0; i < 6 * 60; i++) q.feed(at(POSTURES[0], 0.3 * Math.sin(i * 0.5)), i * DT * 1000);
    expect(q.phase).toBe('failed');
    expect(q.failure).toMatch(/wider|motion/i);
    q.reset();
    expect(q.phase).toBe('left');
  });
});

/** A player chasing a ball: slow big sweeps plus quick corrections, around a centre offset; optional tremor. */
function play(t: number, centre = 0, ampL = 18, ampR = 18): number {
  const s = Math.sin(2 * Math.PI * 0.37 * t) + 0.3 * Math.sin(2 * Math.PI * 0.83 * t + 1);
  const v = s / 1.3;
  return centre + (v < 0 ? ampL : ampR) * v;
}

function baseCal(p: Posture, left = 18, right = 18): TiltCalibration {
  return { g0: p.g0, n: p.nEq, left, right };
}

const LYING = POSTURES[2];
describe('adaptive: neutral', () => {
  it('drifts towards where the player really holds the phone (about 10 s time constant)', () => {
    const p = LYING;
    const a = new AdaptiveTilt(baseCal(p));
    // The player's true neutral is 6 degrees to the right of the stored one.
    const truth: Posture = { ...p, g0: at(p, 6) };
    let t = 0;
    const err = (): number => Math.abs(tiltAngle(truth.g0, a.cal));
    expect(err()).toBeCloseTo(6, 0);
    for (; t < 10; t += DT) a.update(at(truth, play(t)), DT, true);
    const e10 = err();
    for (; t < 40; t += DT) a.update(at(truth, play(t)), DT, true);
    expect(e10).toBeLessThan(3.6); // roughly 1 - e^-1 of the way after 10 s
    expect(e10).toBeGreaterThan(1.2);
    expect(err()).toBeLessThan(1);
  });

  it('freezes while the paddle is held near a wall (|deviation| > 50% of range)', () => {
    const p = LYING;
    const a = new AdaptiveTilt(baseCal(p));
    for (let t = 0; t < 60; t += DT) a.update(at(p, 15), DT, true); // 15 of 18 degrees: parked at the right wall
    expect(angleBetween(a.cal.g0, p.g0)).toBeLessThan(1.6); // a short creep while the smoothed angle crosses 50%, then frozen
    for (let t = 0; t < 30; t += DT) a.update(at(p, 15), DT, true);
    expect(angleBetween(a.cal.g0, p.g0)).toBeLessThan(1.6);
    // ...and holding just inside half range does drift (it is not "at the wall").
    const b = new AdaptiveTilt(baseCal(p));
    for (let t = 0; t < 30; t += DT) b.update(at(p, 5), DT, true);
    expect(angleBetween(b.cal.g0, p.g0)).toBeGreaterThan(3);
  });

  it('does nothing while the ball is not in play', () => {
    const p = LYING;
    const a = new AdaptiveTilt(baseCal(p, 12, 12));
    for (let t = 0; t < 30; t += DT) a.update(at(p, 4 + play(t, 0, 25, 25)), DT, false);
    expect(angleBetween(a.cal.g0, p.g0)).toBe(0);
    expect(a.cal.left).toBe(12);
    expect(a.clock).toBe(0);
  });
});

describe('adaptive: range', () => {
  it('tracks each side separately, at most a few degrees per second, within 8..35', () => {
    const p = LYING;
    const a = new AdaptiveTilt(baseCal(p, 12, 12));
    let t = 0;
    let worst = 0;
    const hist: number[] = [];
    for (; t < 40; t += DT) {
      a.update(at(p, play(t, 0, 28, 14)), DT, true);
      hist.push(a.cal.left);
      if (hist.length > 60) worst = Math.max(worst, Math.abs(a.cal.left - hist[hist.length - 61]));
    }
    expect(a.cal.left).toBeGreaterThan(19);
    expect(a.cal.left).toBeLessThan(30);
    expect(a.cal.right).toBeGreaterThan(10);
    expect(a.cal.right).toBeLessThan(16);
    expect(worst).toBeLessThanOrEqual(ADAPT.rangeRate * 1.1); // deg per second
    const huge = new AdaptiveTilt(baseCal(p, 30, 30));
    for (let u = 0; u < 60; u += DT) huge.update(at(p, play(u, 0, 70, 70)), DT, true);
    expect(huge.cal.left).toBeLessThanOrEqual(ADAPT.maxRange);
    const tiny = new AdaptiveTilt(baseCal(p, 12, 12));
    for (let u = 0; u < 60; u += DT) tiny.update(at(p, play(u, 0, 5, 5)), DT, true);
    expect(tiny.cal.left).toBeGreaterThanOrEqual(ADAPT.minRange);
  });

  it('a rolling window forgets old extremes (a calmer player gets a smaller range after ~20 s)', () => {
    const p = LYING;
    const a = new AdaptiveTilt(baseCal(p, 25, 25));
    for (let t = 0; t < 60; t += DT) a.update(at(p, play(t, 0, 14, 14)), DT, true);
    expect(a.cal.left).toBeLessThan(17);
  });
});

describe('adaptive: posture change mid-stream', () => {
  /** Rotate the whole gravity frame by `deg` about `axis`, ramped in over 1 s starting at tChange. */
  const rot = (g: Vec3, t: number, tChange: number, axis: Vec3, deg: number): Vec3 => normalize(rotateAbout(g, axis, deg * Math.min(1, Math.max(0, t - tChange))));

  for (const axis of [[1, 0, 0], [0, 0, 1], normalize([1, 1, 0])] as Vec3[]) {
    it(`settles within ~20 s after a 60 degree posture change (frame rotated about [${axis.map((v) => v.toFixed(1))}])`, () => {
      const p = POSTURES[0];
      const a = new AdaptiveTilt(baseCal(p));
      const tChange = 20;
      const frame = (g: Vec3, t: number): Vec3 => rot(g, t, tChange, axis, 60);
      const trueN = rotateAbout(p.nEq, axis, 60);
      const trueG0 = normalize(rotateAbout(p.g0, axis, 60));
      let settledAt = -1;
      const trace: string[] = [];
      for (let t = 0; t < 90; t += DT) {
        a.update(frame(at(p, play(t)), t), DT, true);
        if (t >= tChange && Math.round((t - tChange) * 60) % 60 === 0) {
          const nErr = angleBetween(a.cal.n, trueN);
          const gErr = angleBetween(a.cal.g0, trueG0);
          void gErr;
          const eL = tiltAngle(frame(at(p, -18), t), a.cal);
          const eR = tiltAngle(frame(at(p, 18), t), a.cal);
          trace.push(`${(t - tChange).toFixed(0)}s n=${nErr.toFixed(1)} g0=${gErr.toFixed(1)} L=${eL.toFixed(1)}/${a.cal.left.toFixed(1)} R=${eR.toFixed(1)}/${a.cal.right.toFixed(1)}`);
          const ok = nErr < 8 && eL < -0.5 * a.cal.left && eR > 0.5 * a.cal.right;
          if (ok && settledAt < 0) settledAt = t - tChange;
          if (!ok) settledAt = -1;
        }
      }
      if (process.env.TRACE) console.log(trace.join("\n"), "SETTLED_AT", settledAt);
      expect(settledAt).toBeGreaterThanOrEqual(0);
      expect(settledAt).toBeLessThanOrEqual(20);
      expect(dot(a.cal.n, trueN)).toBeGreaterThan(0.97);
    });
  }
});
