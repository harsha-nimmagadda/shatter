import type { RunResult } from './run';

export interface GroupSummary {
  level: string;
  power: string;
  bot: string;
  count: number;
  winRate: number;
  gameovers: number;
  timeouts: number;
  timeMean: number;
  timeMedian: number;
  timeP10: number;
  timeP90: number;
  livesLostMean: number;
  scoreMean: number;
  scoreP50: number;
  scoreP80: number;
  maxComboMean: number;
  maxLongestNoBreakSec: number;
  clipPops: number;
  hazardDeaths: number;
}

/** Linear-interpolated percentile of an ascending array, q in [0, 1]. */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const mean = (a: readonly number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const r3 = (v: number): number => Math.round(v * 1e3) / 1e3;

export function summarize(results: readonly RunResult[]): GroupSummary[] {
  const groups = new Map<string, RunResult[]>();
  for (const r of results) {
    const key = `${r.level}\u0000${r.forcedPower}\u0000${r.bot}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: GroupSummary[] = [];
  for (const rs of groups.values()) {
    const first = rs[0]!;
    const times = rs.map((r) => r.timeSec).sort((a, b) => a - b);
    const scores = rs.map((r) => r.score).sort((a, b) => a - b);
    out.push({
      level: first.level,
      power: first.forcedPower,
      bot: first.bot,
      count: rs.length,
      winRate: r3(rs.filter((r) => r.outcome === 'won').length / rs.length),
      gameovers: rs.filter((r) => r.outcome === 'gameover').length,
      timeouts: rs.filter((r) => r.outcome === 'timeout').length,
      timeMean: r3(mean(times)),
      timeMedian: r3(percentile(times, 0.5)),
      timeP10: r3(percentile(times, 0.1)),
      timeP90: r3(percentile(times, 0.9)),
      livesLostMean: r3(mean(rs.map((r) => r.livesLost))),
      scoreMean: r3(mean(scores)),
      scoreP50: r3(percentile(scores, 0.5)),
      scoreP80: r3(percentile(scores, 0.8)),
      maxComboMean: r3(mean(rs.map((r) => r.maxCombo))),
      maxLongestNoBreakSec: Math.max(...rs.map((r) => r.longestNoBreakSec)),
      clipPops: rs.reduce((s, r) => s + r.clipPops, 0),
      hazardDeaths: rs.reduce((s, r) => s + r.hazardDeaths, 0),
    });
  }
  return out;
}
