import { describe, expect, it } from 'vitest';
import { LEVEL_1 } from '../src/engine';
import { CSV_COLUMNS, buildCases, csvHeader, csvRow, runGame, summarize, type RunOpts } from '../src/sim';

const base = (over: Partial<RunOpts> = {}): RunOpts => ({
  caseId: 'level1|natural|pro', level: LEVEL_1, power: 'natural', bot: 'pro', seed: 1, ...over,
});
const seeds = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('sim', () => {
  it('is deterministic for the same args', () => {
    const a = runGame(base({ seed: 7, bot: 'casual' }));
    const b = runGame(base({ seed: 7, bot: 'casual' }));
    expect(b).toEqual(a);
    expect(runGame(base({ seed: 8, bot: 'casual' }))).not.toEqual(a);
  });

  it('pro bot clears LEVEL_1 for most of 10 seeds', () => {
    const wins = seeds(10).filter((seed) => runGame(base({ seed })).outcome === 'won').length;
    expect(wins).toBeGreaterThanOrEqual(7);
  });

  it('novice loses more lives than pro on average', () => {
    const avg = (bot: 'pro' | 'novice'): number =>
      seeds(10).reduce((s, seed) => s + runGame(base({ seed, bot, caseId: `level1|natural|${bot}` })).livesLost, 0) / 10;
    expect(avg('novice')).toBeGreaterThan(avg('pro'));
  });

  it('caps game time with a timeout outcome', () => {
    const r = runGame(base({ maxTimeSec: 2 }));
    expect(r.outcome).toBe('timeout');
    expect(r.timeSec).toBeGreaterThanOrEqual(2);
    expect(r.timeSec).toBeLessThan(2.1);
  });

  it('csv rows match the header column count', () => {
    const r = runGame(base({ power: 'photocopy', maxTimeSec: 20 }));
    const n = csvHeader().split(',').length;
    expect(n).toBe(CSV_COLUMNS.length);
    expect(csvRow(r).split(',').length).toBe(n);
  });

  it('builds the full matrix and summarizes runs', () => {
    expect(buildCases()).toHaveLength(6 * 16 * 3);
    const rs = [runGame(base({ maxTimeSec: 5 })), runGame(base({ seed: 2, maxTimeSec: 5 }))];
    const [g] = summarize(rs);
    expect(g!.count).toBe(2);
    expect(g!.timeouts).toBe(2);
  });
});
