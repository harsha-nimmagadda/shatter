import { describe, expect, it } from 'vitest';
import { levelStars } from '../src/game/campaign';
import { defaultProgress, mergeProgress, parseProgress, recordWin } from '../src/game/progress';
import { retryLevel, startRun, winLevel } from '../src/game/run';

const N = 15;

describe('levelStars', () => {
  it('1 for a clear, 2 and 3 at the thresholds', () => {
    expect(levelStars(0, [1000, 2000])).toBe(1);
    expect(levelStars(999, [1000, 2000])).toBe(1);
    expect(levelStars(1000, [1000, 2000])).toBe(2);
    expect(levelStars(1999, [1000, 2000])).toBe(2);
    expect(levelStars(2000, [1000, 2000])).toBe(3);
  });
});

describe('progress store', () => {
  it('defaults on missing or corrupt data', () => {
    expect(parseProgress(null, N)).toEqual(defaultProgress(N));
    expect(parseProgress('{nope', N)).toEqual(defaultProgress(N));
    expect(parseProgress('[1,2]', N)).toEqual(defaultProgress(N));
    expect(parseProgress('"x"', N)).toEqual(defaultProgress(N));
  });
  it('sanitises bad fields', () => {
    const p = parseProgress(JSON.stringify({ unlocked: 99, stars: [5, -1, 'a', 2], best: [10, -5, null, 7.9] }), N);
    expect(p.unlocked).toBe(N - 1);
    expect(p.stars.slice(0, 4)).toEqual([3, 0, 0, 2]);
    expect(p.best.slice(0, 4)).toEqual([10, 0, 0, 7]);
    expect(p.stars).toHaveLength(N);
  });
  it('round-trips through JSON', () => {
    const p = recordWin(defaultProgress(N), 2, 2, 1234, N);
    expect(parseProgress(JSON.stringify(p), N)).toEqual(p);
  });
  it('recordWin unlocks next and never lowers best', () => {
    let p = recordWin(defaultProgress(N), 0, 3, 2000, N);
    expect(p.unlocked).toBe(1);
    expect(p.stars[0]).toBe(3);
    p = recordWin(p, 0, 1, 500, N);
    expect(p.stars[0]).toBe(3);
    expect(p.best[0]).toBe(2000);
    p = recordWin(p, 5, 1, 10, N);
    expect(p.unlocked).toBe(6);
    p = recordWin(p, 1, 2, 10, N);
    expect(p.unlocked).toBe(6);
  });
  it('last level does not unlock past the end', () => {
    expect(recordWin(defaultProgress(N), N - 1, 1, 5, N).unlocked).toBe(N - 1);
  });
  it('merge takes element-wise max', () => {
    const a = recordWin(defaultProgress(N), 0, 3, 100, N);
    const b = recordWin(defaultProgress(N), 3, 1, 900, N);
    const m = mergeProgress(a, b, N);
    expect(m.unlocked).toBe(4);
    expect(m.stars[0]).toBe(3);
    expect(m.best[3]).toBe(900);
  });
});

describe('run state', () => {
  it('starts with 3 lives and 0 score', () => {
    expect(startRun(4)).toEqual({ levelIndex: 4, startLives: 3, startScore: 0 });
  });
  it('win carries lives and total score to the next level', () => {
    const o = winLevel(startRun(0), 2, 1500, [1000, 2000], N);
    expect(o.levelScore).toBe(1500);
    expect(o.stars).toBe(2);
    expect(o.next).toEqual({ levelIndex: 1, startLives: 2, startScore: 1500 });
    const o2 = winLevel(o.next!, 4, 4000, [1000, 2000], N);
    expect(o2.levelScore).toBe(2500);
    expect(o2.stars).toBe(3);
    expect(o2.next).toEqual({ levelIndex: 2, startLives: 4, startScore: 4000 });
  });
  it('game over retry restores level-start score with 3 lives', () => {
    const r = { levelIndex: 3, startLives: 1, startScore: 7777 };
    expect(retryLevel(r)).toEqual({ levelIndex: 3, startLives: 3, startScore: 7777 });
  });
  it('finishing the last level is world complete', () => {
    const o = winLevel({ levelIndex: N - 1, startLives: 2, startScore: 100 }, 2, 900, [1, 2], N);
    expect(o.worldComplete).toBe(true);
    expect(o.next).toBeNull();
    expect(o.totalScore).toBe(900);
  });
});
