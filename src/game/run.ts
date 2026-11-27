import { CAMPAIGN } from '../engine/campaign';
import { readStore, removeStore, writeStore } from '../ui/storage';
import { levelStars } from './campaign';

/** Lives at the start of a run and after a retry. */
export const RUN_LIVES = 3;

/** Where a campaign run stands at the START of the current level. */
export interface RunState {
  levelIndex: number;
  /** Lives the level begins with. */
  startLives: number;
  /** Total score the level begins with (carried over the run). */
  startScore: number;
}

export interface WinOutcome {
  levelScore: number;
  totalScore: number;
  stars: 1 | 2 | 3;
  /** True when the cleared level was the last one. */
  worldComplete: boolean;
  /** State for the next level, carrying lives and total score (null when the world is complete). */
  next: RunState | null;
}

/** A fresh run beginning at a level: 3 lives, score 0. */
export function startRun(levelIndex: number): RunState {
  return { levelIndex, startLives: RUN_LIVES, startScore: 0 };
}

/** Level cleared with `endLives` and total `endScore`. */
export function winLevel(
  run: RunState,
  endLives: number,
  endScore: number,
  thresholds: readonly [number, number],
  levelCount: number,
): WinOutcome {
  const levelScore = Math.max(0, endScore - run.startScore);
  const worldComplete = run.levelIndex >= levelCount - 1;
  return {
    levelScore,
    totalScore: endScore,
    stars: levelStars(levelScore, thresholds),
    worldComplete,
    next: worldComplete ? null : { levelIndex: run.levelIndex + 1, startLives: endLives, startScore: endScore },
  };
}

/** Game over: restart the same level with 3 lives and the score the run had when it began. */
export function retryLevel(run: RunState): RunState {
  return { levelIndex: run.levelIndex, startLives: RUN_LIVES, startScore: run.startScore };
}

export const RUN_KEY = 'shatter.run.v1';
const MAX_LIVES = 99;

/** Pure: a stored run, or null for missing/corrupt data. Out-of-range values are clamped. */
export function parseRun(json: string | null, levelCount: number = CAMPAIGN.length): RunState | null {
  if (!json) return null;
  let o: unknown;
  try {
    o = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const r = o as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null);
  const li = num(r.levelIndex);
  const lives = num(r.startLives);
  const score = num(r.startScore);
  if (li === null || lives === null || score === null) return null;
  return {
    levelIndex: Math.max(0, Math.min(levelCount - 1, li)),
    startLives: Math.max(1, Math.min(MAX_LIVES, lives)),
    startScore: Math.max(0, score),
  };
}

/** What PLAY -> Continue resumes: the saved run, else the highest unlocked level; null when there is nothing to continue. */
export function continueRun(saved: RunState | null, unlocked: number): RunState | null {
  const fresh = saved !== null && saved.levelIndex === 0 && saved.startLives === RUN_LIVES && saved.startScore === 0;
  if (saved && !fresh) return saved;
  return unlocked > 0 ? startRun(unlocked) : null;
}

export const loadRun = (): RunState | null => parseRun(readStore(RUN_KEY));
export const saveRun = (r: RunState): void => writeStore(RUN_KEY, JSON.stringify(r));
export const clearRun = (): void => removeStore(RUN_KEY);
