import { describe, expect, it } from 'vitest';
import { continueRun, parseRun, startRun } from '../src/game/run';
import { introHint } from '../src/game/hints';
import { QualityGovernor, effectiveQuality } from '../src/game/quality';
import { parseSettings } from '../src/input/settings';

describe('saved run', () => {
  it('round-trips and clamps', () => {
    const r = { levelIndex: 4, startLives: 2, startScore: 12345 };
    expect(parseRun(JSON.stringify(r), 15)).toEqual(r);
    expect(parseRun(JSON.stringify({ levelIndex: 99, startLives: 0, startScore: -5 }), 15)).toEqual({ levelIndex: 14, startLives: 1, startScore: 0 });
  });
  it('rejects garbage', () => {
    expect(parseRun(null, 15)).toBeNull();
    expect(parseRun('{x', 15)).toBeNull();
    expect(parseRun('[1]', 15)).toBeNull();
    expect(parseRun(JSON.stringify({ levelIndex: 'a', startLives: 3, startScore: 0 }), 15)).toBeNull();
  });
  it('continue prefers the saved run, then the highest unlocked level', () => {
    const saved = { levelIndex: 6, startLives: 2, startScore: 900 };
    expect(continueRun(saved, 9)).toEqual(saved);
    expect(continueRun(null, 9)).toEqual(startRun(9));
    expect(continueRun(null, 0)).toBeNull();
    expect(continueRun(startRun(0), 0)).toBeNull();
    expect(continueRun(startRun(0), 3)).toEqual(startRun(3));
  });
});

describe('first-run hint', () => {
  it('adds the control hint only on the first launch', () => {
    expect(introHint('Break every brick', false, 'tilt')).toBe('Break every brick');
    expect(introHint('Break every brick', true, 'tilt')).toContain('Tilt');
    expect(introHint('Break every brick', true, 'drag')).toContain('Drag');
  });
});

describe('quality governor', () => {
  const run = (g: QualityGovernor, t0: number, secs: number, fps: number): number => {
    let t = t0;
    const end = t0 + secs;
    while (t < end) {
      g.frame(t);
      t += 1 / fps;
    }
    return t;
  };
  it('steps down after ~2 s under 50 fps, one level at a time', () => {
    const g = new QualityGovernor(0);
    let t = run(g, 1, 1.5, 40);
    expect(g.level).toBe(0);
    t = run(g, t, 1.5, 40);
    expect(g.level).toBe(1);
    run(g, t, 12, 40);
    expect(g.level).toBe(2);
  });
  it('steps up only after ~10 s stable above 58 fps', () => {
    const g = new QualityGovernor(0);
    let t = run(g, 1, 3, 30);
    expect(g.level).toBe(1);
    t = run(g, t, 8, 60);
    expect(g.level).toBe(1);
    run(g, t, 6, 60);
    expect(g.level).toBe(0);
  });
  it('does not flap on a mediocre rate and ignores pauses', () => {
    const g = new QualityGovernor(0);
    let t = run(g, 1, 30, 54);
    expect(g.level).toBe(0);
    t = run(g, t, 1, 20);
    g.frame(t + 5);
    run(g, t + 5, 1.5, 20);
    expect(g.level).toBe(0);
  });
  it('ignores the warm-up period', () => {
    const g = new QualityGovernor();
    run(g, 1, 3, 20);
    expect(g.level).toBe(0);
    run(g, 4, 3, 20);
    expect(g.level).toBe(1);
  });
  it('maps the graphics setting', () => {
    expect(effectiveQuality('auto', 1)).toBe(1);
    expect(effectiveQuality('high', 2)).toBe(0);
    expect(effectiveQuality('low', 0)).toBe(2);
    expect(parseSettings(null, false).graphics).toBe('auto');
    expect(parseSettings('{"graphics":"low"}', false).graphics).toBe('low');
    expect(parseSettings('{"graphics":"x"}', false).graphics).toBe('auto');
  });
});
