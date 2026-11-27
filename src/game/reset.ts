import { SEEN_KEY } from './hints';
import { IOS_HINT_KEY } from './install';
import { PROGRESS_KEY } from './progress';
import { RUN_KEY } from './run';
import { TAUGHT_KEY } from './teaching';

/** What RESET PROGRESS clears: progress, the saved run and every first-run / teaching flag. Settings are kept. */
export const RESET_KEYS: readonly string[] = [PROGRESS_KEY, RUN_KEY, SEEN_KEY, TAUGHT_KEY, IOS_HINT_KEY];

export function resetProgressData(remove: (key: string) => void): void {
  for (const k of RESET_KEYS) remove(k);
}
