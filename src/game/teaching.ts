import type { BrickType } from '../engine';
import { readStore, writeStore } from '../ui/storage';

export const TAUGHT_KEY = 'shatter.taught.v1';

/** Flags for the one-time teaching moments. */
export type TeachFlag = 'hazard' | `brick:${BrickType}`;

export const SPECIAL_BRICKS: readonly BrickType[] = ['steel', 'explosive', 'moving', 'regen', 'hidden'];

export const BRICK_CALLOUT: Record<string, string> = {
  steel: 'NEW: METAL CLIP — it never breaks',
  explosive: 'NEW: BOMB — explodes its neighbours',
  moving: 'NEW: SLIDER — it never sits still',
  regen: 'NEW: RE-SKETCH — grows back after 6 s',
  hidden: 'NEW: INVISIBLE INK — hit it twice',
};

/** Slow-motion on the first hazard: 0.3x time for 0.6 s (real time). */
export const SLOWMO = { factor: 0.3, seconds: 0.6 } as const;
/** Nothing is taught during the first second after launch. */
export const QUIET_MS = 1000;
export const HAZARD_TEXT = 'HAZARD — dodge the red saws!';
/** At most this many brick callouts are queued per level intro. */
export const MAX_BRICK_CALLOUTS = 2;

/** Pure: may a teaching callout show now? */
export const teachingAllowed = (enabled: boolean, msSinceLaunch: number): boolean => enabled && msSinceLaunch >= QUIET_MS;

/** Pure: time scale for the engine step, given the real seconds of slow-mo left. */
export const slowMoScale = (left: number): number => (left > 0 ? SLOWMO.factor : 1);

/** Pure: special brick types in this level not yet taught, in a fixed order, at most `max`. */
export function pendingBrickCallouts(present: Iterable<BrickType>, taught: ReadonlySet<string>, max = MAX_BRICK_CALLOUTS): BrickType[] {
  const have = new Set(present);
  return SPECIAL_BRICKS.filter((t) => have.has(t) && !taught.has(`brick:${t}`)).slice(0, max);
}

/** Pure: parses the stored flag list. */
export function parseTaught(json: string | null): Set<string> {
  if (!json) return new Set();
  try {
    const a: unknown = JSON.parse(json);
    return new Set(Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** The persisted set of teaching moments already shown. */
export class Taught {
  private set: Set<string>;
  constructor(private readonly read: () => string | null = () => readStore(TAUGHT_KEY), private readonly write: (s: string) => void = (s) => writeStore(TAUGHT_KEY, s)) {
    this.set = parseTaught(read());
  }
  has(f: TeachFlag): boolean {
    return this.set.has(f);
  }
  mark(f: TeachFlag): void {
    if (this.set.has(f)) return;
    this.set.add(f);
    this.write(JSON.stringify([...this.set]));
  }
  /** Re-reads storage (after a progress reset). */
  reload(): void {
    this.set = parseTaught(this.read());
  }
  get all(): ReadonlySet<string> {
    return this.set;
  }
}
