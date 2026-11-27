import { CAMPAIGN } from '../engine/campaign';
import { readStore, writeStore } from '../ui/storage';

export const PROGRESS_KEY = 'shatter.progress.v1';

export interface Progress {
  /** Highest unlocked level index (0-based). Level 1 is always unlocked. */
  unlocked: number;
  /** Best stars per level, 0..3 (0 = never cleared). */
  stars: number[];
  /** Best level score per level. */
  best: number[];
}

export function defaultProgress(count: number = CAMPAIGN.length): Progress {
  return { unlocked: 0, stars: new Array<number>(count).fill(0), best: new Array<number>(count).fill(0) };
}

const clampInt = (v: unknown, lo: number, hi: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : lo;
  return Math.max(lo, Math.min(hi, n));
};

/** Coerce anything (parsed JSON, garbage) into a valid Progress. */
export function sanitizeProgress(raw: unknown, count: number = CAMPAIGN.length): Progress {
  const out = defaultProgress(count);
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  out.unlocked = clampInt(r.unlocked, 0, count - 1);
  for (let i = 0; i < count; i++) {
    if (Array.isArray(r.stars)) out.stars[i] = clampInt(r.stars[i], 0, 3);
    if (Array.isArray(r.best)) out.best[i] = clampInt(r.best[i], 0, Number.MAX_SAFE_INTEGER);
  }
  return out;
}

export function parseProgress(json: string | null, count: number = CAMPAIGN.length): Progress {
  if (!json) return defaultProgress(count);
  try {
    return sanitizeProgress(JSON.parse(json), count);
  } catch {
    return defaultProgress(count);
  }
}

/** Element-wise best of two progress records (never lowers anything). */
export function mergeProgress(a: Progress, b: Progress, count: number = CAMPAIGN.length): Progress {
  const x = sanitizeProgress(a, count);
  const y = sanitizeProgress(b, count);
  return {
    unlocked: Math.max(x.unlocked, y.unlocked),
    stars: x.stars.map((s, i) => Math.max(s, y.stars[i])),
    best: x.best.map((s, i) => Math.max(s, y.best[i])),
  };
}

/** Progress after clearing a level: records best stars/score and unlocks the next level. */
export function recordWin(p: Progress, levelIndex: number, stars: number, levelScore: number, count: number = CAMPAIGN.length): Progress {
  const upd = defaultProgress(count);
  if (levelIndex < 0 || levelIndex >= count) return mergeProgress(p, upd, count);
  upd.stars[levelIndex] = clampInt(stars, 0, 3);
  upd.best[levelIndex] = clampInt(levelScore, 0, Number.MAX_SAFE_INTEGER);
  upd.unlocked = Math.min(count - 1, levelIndex + 1);
  return mergeProgress(p, upd, count);
}

export function loadProgress(count: number = CAMPAIGN.length): Progress {
  return parseProgress(readStore(PROGRESS_KEY), count);
}

export function saveProgress(p: Progress): void {
  writeStore(PROGRESS_KEY, JSON.stringify(p));
}

/** Stars earned across all levels, and the most there are to earn (3 per level). */
export function totalStars(p: Progress, count: number = CAMPAIGN.length): { have: number; max: number } {
  let have = 0;
  for (let i = 0; i < count; i++) have += clampInt(p.stars[i], 0, 3);
  return { have, max: count * 3 };
}
