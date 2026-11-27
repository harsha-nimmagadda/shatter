import { CAMPAIGN } from '../engine/campaign';
import type { Progress } from '../game/progress';
import type { Nav } from './nav';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const LOCK_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

export interface CardButton {
  label: string;
  primary?: boolean;
  onClick(): void;
}

export interface CardOpts {
  kicker?: string;
  title: string;
  subtitle?: string;
  /** Rows of [label, value, highlight?]. */
  stats?: [string, string, boolean?][];
  /** Earned stars 0..3 (animate in one by one). Omit for no star row. */
  stars?: number;
  tone?: 'win' | 'lose';
  buttons: CardButton[];
  onBack?: () => void;
  /** Click the primary button after this many ms (autopilot). */
  autoMs?: number;
}

export interface LevelSelectOpts {
  onPick(index: number): void;
  onBack(): void;
}

const starRow = (n: number, anim: boolean, cls = 'ui-stars'): HTMLElement => {
  const row = el('div', anim ? `${cls} anim` : cls);
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', `${n} of 3 stars`);
  for (let i = 0; i < 3; i++) {
    const s = el('span', i < n ? 'star on' : 'star', '★');
    s.style.setProperty('--i', String(i));
    row.append(s);
  }
  return row;
};

/** DOM screens: level intro, continue choice, level select and the result cards. One screen at a time. */
export class Menus {
  private cur: HTMLElement | null = null;
  private autoTimer = 0;
  private introEl: HTMLElement | null = null;
  private introTimer = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly nav: Nav,
    private readonly onClosed: () => void,
    /** Called as each earned star pops in on a result card (index 0..2). */
    private readonly onStar?: (index: number) => void,
  ) {}
  private starTimers: number[] = [];

  open(): boolean {
    return this.cur !== null;
  }

  close(): void {
    window.clearTimeout(this.autoTimer);
    for (const t of this.starTimers) window.clearTimeout(t);
    this.starTimers = [];
    if (!this.cur) return;
    this.cur.remove();
    this.cur = null;
    this.onClosed();
  }

  private mount(ov: HTMLElement, back?: () => void): void {
    this.close();
    this.nav.register(ov, back);
    this.cur = ov;
    this.root.appendChild(ov);
    this.nav.focusInitial(ov);
  }

  // ---- Level intro ----
  introActive(): boolean {
    return this.introEl !== null;
  }

  dismissIntro(): void {
    window.clearTimeout(this.introTimer);
    this.introEl?.remove();
    this.introEl = null;
  }

  showIntro(num: number, name: string, hint: string, ms = 1600): void {
    this.dismissIntro();
    const d = el('div', 'ui-intro');
    d.append(el('div', 'k', `LEVEL ${num}`), el('div', 'n', name), el('div', 'h', hint));
    d.setAttribute('role', 'status');
    this.introEl = d;
    this.root.appendChild(d);
    this.introTimer = window.setTimeout(() => this.dismissIntro(), ms);
  }

  // ---- Generic card ----
  card(o: CardOpts): void {
    const ov = el('div', 'ui-overlay ui-cardov');
    const card = el('div', `ui-card ${o.tone ?? ''}`);
    if (o.kicker) card.append(el('div', 'ui-kicker', o.kicker));
    card.append(el('h2', 'ui-card-title', o.title));
    if (o.subtitle) card.append(el('div', 'ui-card-sub', o.subtitle));
    if (o.stars !== undefined) card.append(starRow(o.stars, true, 'ui-stars big'));
    if (o.stats?.length) {
      const list = el('div', 'ui-stats');
      for (const [k, v, hi] of o.stats) {
        const row = el('div', hi ? 'ui-stat hi' : 'ui-stat');
        row.append(el('span', undefined, k), el('b', undefined, v));
        list.append(row);
      }
      card.append(list);
    }
    const btns = el('div', 'ui-card-btns');
    let primary: HTMLButtonElement | null = null;
    for (const b of o.buttons) {
      const btn = el('button', b.primary ? 'ui-btn mid primary' : 'ui-btn mid', b.label);
      if (b.primary) {
        btn.dataset.primary = '1';
        primary = btn;
      }
      btn.addEventListener('click', () => b.onClick());
      btns.append(btn);
    }
    card.append(btns);
    ov.append(card);
    this.mount(ov, o.onBack);
    // Star pops follow the CSS animation delay (0.25 s + 0.4 s per star); chime on each earned star.
    if (o.stars) {
      for (let i = 0; i < o.stars; i++) {
        this.starTimers.push(window.setTimeout(() => this.onStar?.(i), 300 + i * 400));
      }
    }
    if (o.autoMs && primary) {
      const p = primary;
      this.autoTimer = window.setTimeout(() => {
        if (this.cur === ov) p.click();
      }, o.autoMs);
    }
  }

  showContinue(level: number, h: { onContinue(): void; onNew(): void; onBack(): void }, subtitle?: string): void {
    this.card({
      kicker: 'WELCOME BACK',
      title: 'World 1',
      ...(subtitle ? { subtitle } : {}),
      buttons: [
        { label: `Continue from level ${level}`, primary: true, onClick: h.onContinue },
        { label: 'New run', onClick: h.onNew },
        { label: 'Back', onClick: h.onBack },
      ],
      onBack: h.onBack,
    });
  }

  // ---- Level select ----
  showLevelSelect(p: Progress, o: LevelSelectOpts): void {
    const ov = el('div', 'ui-overlay ui-levels');
    const head = el('div', 'ui-levels-head');
    const back = el('button', 'ui-btn small', '‹ BACK');
    back.addEventListener('click', o.onBack);
    head.append(back, el('h2', 'ui-levels-title', 'LEVELS'), el('span', 'ui-levels-pad'));
    const grid = el('div', 'ui-grid');
    let focusIdx = Math.min(p.unlocked, CAMPAIGN.length - 1);
    CAMPAIGN.forEach((lv, i) => {
      const locked = i > p.unlocked;
      const t = el('button', `ui-tile${locked ? ' locked' : ''}`);
      t.append(el('span', 'tn', String(i + 1)), el('span', 'tm', lv.name));
      if (locked) {
        const l = el('span', 'tl');
        l.innerHTML = LOCK_SVG;
        t.append(l);
        t.setAttribute('aria-disabled', 'true');
        t.setAttribute('aria-label', `Level ${i + 1}, locked`);
      } else {
        t.append(starRow(p.stars[i], false, 'ui-stars tiny'));
        t.setAttribute('aria-label', `Level ${i + 1}, ${lv.name}, ${p.stars[i]} stars`);
      }
      if (i === focusIdx) t.dataset.primary = '1';
      t.addEventListener('click', () => {
        if (locked) {
          t.classList.remove('shake');
          void t.offsetWidth;
          t.classList.add('shake');
          return;
        }
        o.onPick(i);
      });
      grid.append(t);
    });
    focusIdx = -1;
    ov.append(head, grid);
    this.mount(ov, o.onBack);
  }
}
