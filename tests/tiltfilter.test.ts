import { describe, expect, it } from 'vitest';
import { DEFAULT_STEADINESS, OneEuro, REST_ENTER_DEG, REST_EXIT_DEG, RestGate, STEADINESS, steadinessParams } from '../src/input/filter';
import { axisToPaddleX, tiltAxis, type TiltCalibration } from '../src/input/gravity';
import { defaultSettings, parseSettings } from '../src/input/settings';

const W = 540;
const PADDLE = 96;
const CAL: TiltCalibration = { g0: [0, 0, 1], n: [0, 1, 0], left: 26.7, right: 26.7 }; // the default range (sensitivity 5)

/** Tremor: three components between 8 and 12 Hz, `amp` degrees in total peak amplitude. */
const tremor = (t: number, amp: number): number =>
  amp * (0.5 * Math.sin(2 * Math.PI * 8 * t) + 0.3 * Math.sin(2 * Math.PI * 12 * t + 1) + 0.2 * Math.sin(2 * Math.PI * 10 * t + 2));

/** Runs the whole steering chain (One Euro -> rest gate -> axis -> paddle x) over `sec` seconds; returns paddle x samples. */
function chain(level: number, signal: (t: number) => number, sec: number, hz = 60): number[] {
  const f = new OneEuro(steadinessParams(level));
  const gate = new RestGate();
  const out: number[] = [];
  for (let i = 0; i < sec * hz; i++) {
    const t = i / hz;
    const a = gate.apply(f.filter(signal(t), 1 / hz));
    out.push(axisToPaddleX(tiltAxis(a, CAL), W, PADDLE));
  }
  return out;
}
const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
const rms = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

describe('One Euro filter: tremor', () => {
  for (const amp of [1, 2]) {
    for (let level = 0; level < 3; level++) {
      it(`${amp} deg tremor at rest does not move the paddle at all (steadiness ${level})`, () => {
        const xs = chain(level, (t) => tremor(t, amp), 5).slice(60);
        expect(spread(xs)).toBe(0);
      });
    }
  }
  it('even a hand holding 10 degrees of tilt (outside the rest zone) moves the paddle by about a pixel at Medium', () => {
    const raw = Array.from({ length: 300 }, (_, i) => 10 + tremor(i / 60, 2));
    const rawPx = raw.map((a) => axisToPaddleX(tiltAxis(a, CAL), W, PADDLE));
    const xs = chain(DEFAULT_STEADINESS, (t) => 10 + tremor(t, 2), 5).slice(120);
    expect(spread(rawPx)).toBeGreaterThan(15); // unfiltered: ~+-8 px of jitter
    expect(spread(xs)).toBeLessThan(2.2); // peak-to-peak
    expect(rms(xs)).toBeLessThan(0.8);
  });
  it('more steadiness means less residual jitter', () => {
    const r = [0, 1, 2].map((l) => rms(chain(l, (t) => 10 + tremor(t, 2), 5).slice(120)));
    expect(r[0]).toBeGreaterThan(r[1]);
    expect(r[1]).toBeGreaterThan(r[2]);
  });
});

describe('One Euro filter: responsiveness', () => {
  /** Time (ms) from the START of a 30 degree / 150 ms tilt until the output passes 90% (27 degrees); also from its end. */
  function t90(level: number, hz = 60): { fromStart: number; afterEnd: number } {
    const f = new OneEuro(steadinessParams(level));
    for (let i = 0; i < hz; i++) f.filter(0, 1 / hz); // settled at rest
    for (let i = 1; i < hz; i++) {
      const t = i / hz;
      const y = f.filter(Math.min(30, (30 * t) / 0.15), 1 / hz);
      if (y >= 27) return { fromStart: t * 1000, afterEnd: t * 1000 - 150 };
    }
    return { fromStart: Infinity, afterEnd: Infinity };
  }
  it('a 30 degree tilt in 150 ms reaches 90% within 120 ms of finishing (all steadiness levels)', () => {
    for (let level = 0; level < 3; level++) expect(t90(level).afterEnd).toBeLessThanOrEqual(120);
  });
  it('Medium reaches 90% about 20 ms after the tilt ends', () => {
    expect(t90(1).afterEnd).toBeLessThanOrEqual(40);
  });
  it('is frame-rate independent (30, 60 and 120 Hz agree within ~50 ms)', () => {
    const a = [30, 60, 120].map((hz) => t90(1, hz).fromStart);
    expect(Math.max(...a) - Math.min(...a)).toBeLessThanOrEqual(50);
  });
  it('a slow drift is followed with little lag; the first sample passes through', () => {
    const f = new OneEuro(steadinessParams(1));
    expect(f.filter(7, 1 / 60)).toBe(7);
    let y = 7;
    let x = 7;
    for (let i = 0; i < 600; i++) {
      x += 5 / 60; // 5 deg/s
      y = f.filter(x, 1 / 60);
    }
    expect(x - y).toBeLessThan(1.6);
  });
  it('presets are ordered Low < Medium < High smoothing and clamp bad levels', () => {
    expect(STEADINESS[0].minCutoff).toBeGreaterThan(STEADINESS[1].minCutoff);
    expect(STEADINESS[1].minCutoff).toBeGreaterThan(STEADINESS[2].minCutoff);
    expect(steadinessParams(-5)).toBe(STEADINESS[0]);
    expect(steadinessParams(99)).toBe(STEADINESS[2]);
    expect(steadinessParams(NaN)).toBe(STEADINESS[DEFAULT_STEADINESS]);
  });
});

describe('rest gate (dead zone with hysteresis)', () => {
  it('stays at rest inside the enter threshold, follows outside it, returns to rest below the exit threshold', () => {
    const g = new RestGate();
    expect(g.apply(REST_ENTER_DEG - 0.01)).toBe(0);
    expect(g.apply(-(REST_ENTER_DEG - 0.01))).toBe(0);
    expect(g.apply(REST_ENTER_DEG + 0.2)).toBeCloseTo(REST_ENTER_DEG + 0.2);
    expect(g.apply(REST_EXIT_DEG + 0.05)).toBeCloseTo(REST_EXIT_DEG + 0.05); // hysteresis: still following
    expect(g.apply(REST_EXIT_DEG - 0.05)).toBe(0);
    expect(g.apply(REST_EXIT_DEG + 0.05)).toBe(0); // and needs the bigger move again
  });
  it('a hand wobbling +-1.2 degrees around neutral never moves the paddle', () => {
    const g = new RestGate();
    for (let i = 0; i < 200; i++) expect(g.apply(1.2 * Math.sin(i))).toBe(0);
  });
});

describe('tilt settings', () => {
  it('defaults: automatic, Medium steadiness', () => {
    const d = defaultSettings(true);
    expect(d.tiltMode).toBe('auto');
    expect(d.tiltSteadiness).toBe(DEFAULT_STEADINESS);
  });
  it('old saves still parse: a saved calibration means calibrated, none means automatic', () => {
    expect(parseSettings(JSON.stringify({ mode: 'tilt', tiltSensitivity: 6 }), true).tiltMode).toBe('auto');
    const cal = { g0: [0, 0, 1], n: [0, 1, 0], left: 20, right: 20 };
    expect(parseSettings(JSON.stringify({ mode: 'tilt', tiltCal: cal }), true).tiltMode).toBe('calibrated');
  });
  it('persists adaptive and steadiness; garbage falls back', () => {
    const s = parseSettings(JSON.stringify({ tiltMode: 'adaptive', tiltSteadiness: 2 }), true);
    expect(s.tiltMode).toBe('adaptive');
    expect(s.tiltSteadiness).toBe(2);
    const g = parseSettings(JSON.stringify({ tiltMode: 'banana', tiltSteadiness: 'x' }), true);
    expect(g.tiltMode).toBe('auto');
    expect(g.tiltSteadiness).toBe(DEFAULT_STEADINESS);
    expect(parseSettings(JSON.stringify({ tiltSteadiness: 7 }), true).tiltSteadiness).toBe(2);
    // calibrated without a calibration cannot be honoured
    expect(parseSettings(JSON.stringify({ tiltMode: 'calibrated' }), true).tiltMode).toBe('auto');
  });
});
