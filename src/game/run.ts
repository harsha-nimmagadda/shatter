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
