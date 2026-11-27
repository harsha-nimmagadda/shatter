/** Pure: should the screen wake lock be held right now? Only while a level is actively serving or playing. */
export function shouldHoldWakeLock(s: { started: boolean; paused: boolean; hidden: boolean; status: string }): boolean {
  return s.started && !s.paused && !s.hidden && (s.status === 'serve' || s.status === 'playing');
}

interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}
type WakeNav = Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };

/** Keeps the screen awake while wanted. Safe on browsers without the API; rejected requests are swallowed. */
export class WakeLock {
  private sentinel: Sentinel | null = null;
  private pending = false;
  private wanted = false;
  /** After a refused request, wait this long before asking again (update() runs every frame). */
  private retryAt = 0;

  constructor() {
    if (typeof document !== 'undefined') {
      // The browser drops the lock when the tab hides; take it again when we come back.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.sync();
        else this.drop();
      });
    }
  }

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!(navigator as WakeNav).wakeLock;
  }

  /** Call every frame (cheap) or on state change. */
  update(want: boolean): void {
    this.wanted = want;
    this.sync();
  }

  private sync(): void {
    if (this.wanted && document.visibilityState === 'visible') this.acquire();
    else this.drop();
  }

  private acquire(): void {
    const wl = (navigator as WakeNav).wakeLock;
    if (!wl || this.sentinel || this.pending || performance.now() < this.retryAt) return;
    this.pending = true;
    wl.request('screen').then(
      (s) => {
        this.pending = false;
        if (!this.wanted) {
          s.release().catch(() => undefined);
          return;
        }
        this.sentinel = s;
        s.addEventListener('release', () => {
          if (this.sentinel === s) this.sentinel = null;
        });
      },
      () => {
        this.pending = false; // denied (battery saver, hidden tab, no gesture): back off before trying again
        this.retryAt = performance.now() + 5000;
      },
    );
  }

  private drop(): void {
    const s = this.sentinel;
    this.sentinel = null;
    if (s) s.release().catch(() => undefined);
  }
}
