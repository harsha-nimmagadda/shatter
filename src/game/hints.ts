import { readStore, writeStore } from '../ui/storage';

export const SEEN_KEY = 'shatter.seen.v1';

/** Level-1 intro hint; on the very first launch it also says how to move. */
export function introHint(base: string, firstRun: boolean, mode: 'tilt' | 'drag' | 'stick'): string {
  if (!firstRun) return base;
  const how =
    mode === 'tilt'
      ? 'Tilt to move, tap to launch'
      : mode === 'stick'
        ? 'Hold anywhere to steer, tap to launch'
        : 'Drag to move, tap to launch';
  return `${base}. ${how}`;
}

/** True once, on the very first launch (marks it seen). */
export function takeFirstRun(): boolean {
  if (readStore(SEEN_KEY) !== null) return false;
  writeStore(SEEN_KEY, '1');
  return true;
}
