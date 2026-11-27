/** Result-card tally: the rows to count up and the pure timeline that drives the count (ticks, row reveals, skip). */

export interface TallyRow {
  key: 'bricks' | 'lives' | 'total';
  label: string;
  value: number;
}

/**
 * Pure: the rows for a won level. `levelScore` already includes the lives bonus (the engine adds
 * `bonusPerLife * lives` on the win), so Bricks is what is left after taking it out. The engine has no separate
 * combo bonus (combos multiply brick points as they happen), so there is no combo row.
 */
export function tallyRows(levelScore: number, lives: number, bonusPerLife: number): TallyRow[] {
  const score = Math.max(0, Math.round(levelScore));
  const bonus = Math.min(score, Math.max(0, Math.round(lives)) * bonusPerLife);
  const rows: TallyRow[] = [{ key: 'bricks', label: 'Bricks', value: score - bonus }];
  if (bonus > 0) rows.push({ key: 'lives', label: `Lives bonus ×${Math.round(lives)}`, value: bonus });
  rows.push({ key: 'total', label: 'Level score', value: score });
  return rows;
}

export interface TallyTiming {
  /** Pause before the first row, s. */
  lead: number;
  /** Count duration for a row, s: min .. max scaled by value / scaleAt. */
  min: number;
  max: number;
  scaleAt: number;
  /** Longer count for the final total. */
  totalSec: number;
  /** Pause after a row finishes, s. */
  gap: number;
  /** Seconds between ticks while counting. */
  tick: number;
}

export const TALLY_TIMING: TallyTiming = { lead: 0.35, min: 0.4, max: 0.9, scaleAt: 3000, totalSec: 0.95, gap: 0.28, tick: 0.055 };

export interface TallyUpdate {
  /** Ticks to sound this update (0 or more). */
  ticks: number;
  /** Row indices that started / finished counting this update. */
  started: number[];
  finished: number[];
  /** True on the update in which the whole tally became done. */
  completed: boolean;
}

const easeOut = (p: number): number => 1 - Math.pow(1 - p, 3);

/** Counts rows up one after another; `update(dt)` reports what happened, `skip()` jumps to the end. */
export class TallyTimeline {
  private t = 0;
  private readonly start: number[] = [];
  private readonly dur: number[] = [];
  private readonly ticked: number[] = [];
  private readonly began: boolean[] = [];
  private readonly ended: boolean[] = [];
  private fin = false;
  private end = 0;

  constructor(
    readonly rows: readonly TallyRow[],
    private readonly timing: TallyTiming = TALLY_TIMING,
  ) {
    let at = timing.lead;
    rows.forEach((r, i) => {
      const last = i === rows.length - 1 && r.key === 'total';
      const d = last ? timing.totalSec : timing.min + Math.min(1, r.value / timing.scaleAt) * (timing.max - timing.min);
      this.start.push(at);
      this.dur.push(d);
      this.ticked.push(0);
      this.began.push(false);
      this.ended.push(false);
      at += d + timing.gap;
    });
    this.end = rows.length ? this.start[rows.length - 1] + this.dur[rows.length - 1] : 0;
    if (!rows.length) this.fin = true;
  }

  get done(): boolean {
    return this.fin;
  }

  /** Total running time until the last row finishes, s. */
  get length(): number {
    return this.end;
  }

  /** Row i has appeared. */
  visible(i: number): boolean {
    return this.fin || this.t >= this.start[i];
  }

  /** The number to show for row i right now. */
  value(i: number): number {
    if (this.fin) return this.rows[i].value;
    const p = Math.max(0, Math.min(1, (this.t - this.start[i]) / this.dur[i]));
    return Math.round(this.rows[i].value * easeOut(p));
  }

  update(dt: number): TallyUpdate {
    return this.advance(this.t + Math.max(0, dt));
  }

  /** Jumps to the finished state (tap to fast-forward). Remaining rows still report as started/finished once. */
  skip(): TallyUpdate {
    return this.advance(this.end + 1, true);
  }

  private advance(to: number, skipping = false): TallyUpdate {
    const out: TallyUpdate = { ticks: 0, started: [], finished: [], completed: false };
    if (this.fin) return out;
    this.t = to;
    for (let i = 0; i < this.rows.length; i++) {
      if (!this.began[i] && this.t >= this.start[i]) {
        this.began[i] = true;
        out.started.push(i);
      }
      if (!skipping) {
        const n = Math.floor(Math.max(0, Math.min(this.t - this.start[i], this.dur[i])) / this.timing.tick);
        if (n > this.ticked[i]) {
          out.ticks += n - this.ticked[i];
          this.ticked[i] = n;
        }
      }
      if (!this.ended[i] && this.t >= this.start[i] + this.dur[i]) {
        this.ended[i] = true;
        out.finished.push(i);
      }
    }
    if (this.t >= this.end) {
      this.fin = true;
      out.completed = true;
    }
    return out;
  }
}
