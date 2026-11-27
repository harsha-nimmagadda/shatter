import { EdgeDetector } from '../input/latch';

const AXIS_T = 0.6;

/**
 * Focus navigation for the DOM menus: arrow keys / d-pad / left stick move focus between buttons of the topmost
 * registered overlay, Enter/Space/A click the focused button, Escape/B runs the overlay's back handler.
 * Only acts while a registered overlay is the last `.ui-overlay` in the root, so it never interferes with play.
 */
export class Nav {
  /** Set when Escape/B ran a back handler; main reads it so the same Escape does not also toggle pause. */
  private backFlag = false;
  private readonly regs = new Map<Element, (() => void) | undefined>();
  private readonly edges = { a: new EdgeDetector(), b: new EdgeDetector(), u: new EdgeDetector(), d: new EdgeDetector(), l: new EdgeDetector(), r: new EdgeDetector() };
  private usingKeys = false;

  constructor(private readonly root: HTMLElement) {
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointerdown', () => this.setKeys(false), true);
  }

  register(el: HTMLElement, back?: () => void): void {
    this.regs.set(el, back);
  }

  takeBackFlag(): boolean {
    const f = this.backFlag;
    this.backFlag = false;
    return f;
  }

  private setKeys(on: boolean): void {
    this.usingKeys = on;
    this.root.classList.toggle('ui-nav-on', on);
  }

  top(): HTMLElement | null {
    for (let i = this.root.children.length - 1; i >= 0; i--) {
      const c = this.root.children[i] as HTMLElement;
      if (c.classList.contains('ui-overlay')) return this.regs.has(c) ? c : null;
    }
    return null;
  }

  private items(t: HTMLElement): HTMLElement[] {
    return Array.from(t.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')).filter(
      (i) => !i.hidden && (i.offsetWidth > 0 || i.offsetHeight > 0),
    );
  }

  /** Focus the overlay's primary button (data-primary) or its first button. */
  focusInitial(el: HTMLElement): void {
    const target = el.querySelector<HTMLElement>('[data-primary]:not(:disabled)') ?? this.items(el)[0];
    this.root.classList.toggle('ui-nav-on', this.usingKeys);
    target?.focus({ preventScroll: true });
  }

  private move(dx: number, dy: number): void {
    const t = this.top();
    if (!t) return;
    const items = this.items(t);
    const cur = items.find((i) => i === document.activeElement);
    if (!cur) {
      this.focusInitial(t);
      return;
    }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const it of items) {
      if (it === cur) continue;
      const q = it.getBoundingClientRect();
      const ddx = q.left + q.width / 2 - cx;
      const ddy = q.top + q.height / 2 - cy;
      let prim: number;
      let perp: number;
      if (dx !== 0) {
        if (ddx * dx <= 4) continue;
        prim = Math.abs(ddx);
        perp = Math.abs(ddy);
      } else {
        if (ddy * dy <= 4) continue;
        prim = Math.abs(ddy);
        perp = Math.abs(ddx);
      }
      const s = prim + perp * 2.5;
      if (s < bestScore) {
        bestScore = s;
        best = it;
      }
    }
    if (best) {
      best.focus({ preventScroll: true });
      best.scrollIntoView({ block: 'nearest' });
    }
  }

  private confirm(): void {
    const t = this.top();
    if (!t) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && t.contains(a) && (a.tagName === 'BUTTON' || (a as HTMLInputElement).type === 'checkbox')) a.click();
    else this.focusInitial(t);
  }

  private back(): void {
    const t = this.top();
    const fn = t ? this.regs.get(t) : undefined;
    if (fn) {
      this.backFlag = true;
      fn();
    }
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.top()) return;
    // Sliders keep Left/Right for changing their value.
    const tg = e.target as HTMLInputElement | null;
    if (tg?.type === 'range' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    switch (e.key) {
      case 'ArrowLeft': this.setKeys(true); this.move(-1, 0); break;
      case 'ArrowRight': this.setKeys(true); this.move(1, 0); break;
      case 'ArrowUp': this.setKeys(true); this.move(0, -1); break;
      case 'ArrowDown': this.setKeys(true); this.move(0, 1); break;
      case 'Enter':
      case ' ':
        this.setKeys(true);
        if (!e.repeat) this.confirm();
        break;
      case 'Escape':
        if (!e.repeat) this.back();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  /** Stop the browser's own space-on-keyup button click (we already clicked on keydown). */
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ' && this.top()) e.preventDefault();
  };

  /** Once per frame, after Controls.poll. Edge-tracks the pad every frame so held buttons never fire later. */
  poll(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected && p.mapping === 'standard') {
        pad = p;
        break;
      }
    }
    const btn = (i: number): boolean => !!pad?.buttons[i]?.pressed;
    const ax = pad?.axes[0] ?? 0;
    const ay = pad?.axes[1] ?? 0;
    const e = this.edges;
    const a = e.a.update(btn(0));
    const b = e.b.update(btn(1));
    const u = e.u.update(btn(12) || ay < -AXIS_T);
    const d = e.d.update(btn(13) || ay > AXIS_T);
    const l = e.l.update(btn(14) || ax < -AXIS_T);
    const r = e.r.update(btn(15) || ax > AXIS_T);
    if (!this.top()) return;
    if (u || d || l || r || a || b) this.setKeys(true);
    if (u) this.move(0, -1);
    if (d) this.move(0, 1);
    if (l) this.move(-1, 0);
    if (r) this.move(1, 0);
    if (a) this.confirm();
    if (b) this.back();
  }
}
