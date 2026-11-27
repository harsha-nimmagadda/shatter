import { CAMPAIGN } from '../engine/campaign';
import { totalStars, type Progress } from '../game/progress';
import { TallyTimeline, type TallyRow } from '../game/tally';
import type { UiFx } from './feedback';
import { enter, leave } from './motion';
import type { Nav } from './nav';
import { notice } from './toast';
import { thumbImg } from './thumb';

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
  /** Plays the back sound instead of the tap/confirm one. */
  back?: boolean;
  onClick(): void;
}

export interface CardOpts {
  kicker?: string;
  title: string;
  subtitle?: string;
  /** Rows of [label, value, highlight?]. With `tally` these appear after the count. */
  stats?: [string, string, boolean?][];
  /** Earned stars 0..3 (animate in one by one). Omit for no star row. */
  stars?: number;
  tone?: 'win' | 'lose';
  buttons: CardButton[];
  onBack?: () => void;
  /** Click the primary button after this many ms (autopilot). */
  autoMs?: number;
  /** Count these rows up one by one (ticks), then pop the stars; buttons unlock when it is done. */
  tally?: readonly TallyRow[];
  /** "NEW BEST!" badge after the stars. */
  badge?: string;
  /** "Next: Level N · Name" preview with the level's picture, below the buttons. */
  next?: { index: number };
  /** A short tip line (game over). */
  tip?: string;
}

export interface LevelSelectOpts {
  onPick(index: number): void;
  onBack(): void;
}

export interface MenuHooks {
  /** Called as each earned star pops in on a result card (index 0..2). */
  star(index: number): void;
  /** NEW BEST! badge appeared. */
  best(): void;
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

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** DOM screens: level intro, continue choice, level select and the result cards. One screen at a time. */
export class Menus {
  private cur: HTMLElement | null = null;
  private autoTimer = 0;
  private introEl: HTMLElement | null = null;
  private introTimer = 0;
  private timers: number[] = [];
  private raf = 0;
  /** Skips the running result tally / reveal; null when nothing is running. */
  private skipFn: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly nav: Nav,
    private readonly onClosed: () => void,
    private readonly fx: UiFx,
    private readonly hooks: MenuHooks,
  ) {
    nav.interrupt = () => this.skipTally();
  }

  open(): boolean {
    return this.cur !== null;
  }

  close(instant = false): void {
    window.clearTimeout(this.autoTimer);
    this.clearTimers();
    if (!this.cur) return;
    void leave(this.cur, instant);
    this.cur = null;
    this.onClosed();
  }

  private clearTimers(): void {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.skipFn = null;
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private mount(ov: HTMLElement, back?: () => void): void {
    this.close();
    this.nav.register(ov, back);
    this.cur = ov;
    this.root.appendChild(ov);
    void enter(ov);
    this.nav.focusInitial(ov);
  }

  /** Fast-forwards a running result tally (tap / Enter / A / Escape). True when it consumed the press. */
  skipTally(): boolean {
    if (!this.skipFn) return false;
    this.skipFn();
    return true;
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
    const tallied = !!o.tally?.length;
    let stars: HTMLElement | null = null;
    if (o.stars !== undefined) {
      stars = starRow(o.stars, true, 'ui-stars big');
      if (!tallied) stars.classList.add('run');
      card.append(stars);
    }

    const tallyEls: { row: HTMLElement; val: HTMLElement }[] = [];
    if (tallied) {
      const list = el('div', 'ui-stats tally');
      for (const r of o.tally ?? []) {
        const row = el('div', r.key === 'total' ? 'ui-stat total pending' : 'ui-stat pending');
        const val = el('b', undefined, '0');
        row.append(el('span', undefined, r.label), val);
        list.append(row);
        tallyEls.push({ row, val });
      }
      card.append(list);
    }
    const stats = el('div', tallied ? 'ui-stats after pending' : 'ui-stats');
    for (const [k, v, hi] of o.stats ?? []) {
      const row = el('div', hi ? 'ui-stat hi' : 'ui-stat');
      row.append(el('span', undefined, k), el('b', undefined, v));
      stats.append(row);
    }
    if (o.stats?.length) card.append(stats);
    let badge: HTMLElement | null = null;
    if (o.badge) {
      badge = el('div', 'ui-badge pending', o.badge);
      card.append(badge);
    }
    if (o.tip) card.append(el('p', 'ui-cardtip', o.tip));

    const btns = el('div', tallied ? 'ui-card-btns wait' : 'ui-card-btns');
    let primary: HTMLButtonElement | null = null;
    for (const b of o.buttons) {
      const btn = el('button', b.primary ? 'ui-btn mid primary' : 'ui-btn mid', b.label);
      if (b.primary) {
        btn.dataset.primary = '1';
        primary = btn;
      }
      if (b.back) btn.dataset.sfx = 'back';
      btn.addEventListener('click', () => b.onClick());
      btns.append(btn);
    }
    card.append(btns);
    let next: HTMLElement | null = null;
    if (o.next) {
      const lv = CAMPAIGN[o.next.index];
      next = el('div', tallied ? 'ui-next pending' : 'ui-next');
      const tx = el('div', 'tx');
      tx.append(el('span', 'k', 'NEXT'), el('b', undefined, `Level ${o.next.index + 1} · ${lv.name}`));
      next.append(thumbImg(o.next.index, 'thumb'), tx);
      card.append(next);
    }
    ov.append(card);
    this.mount(ov, o.onBack);
    this.fx.play('whoosh');

    const popStars = (fast: boolean): void => {
      if (!stars || !o.stars) return;
      stars.classList.toggle('fast', fast);
      stars.classList.add('run');
      const base = fast ? 150 : 300;
      const step = fast ? 150 : 400;
      for (let i = 0; i < o.stars; i++) this.later(base + i * step, () => this.hooks.star(i));
    };

    const autoClick = (): void => {
      if (o.autoMs && primary) {
        const p = primary;
        this.autoTimer = window.setTimeout(() => {
          if (this.cur === ov) p.click();
        }, o.autoMs);
      }
    };

    if (!tallied) {
      popStars(false);
      autoClick();
      return;
    }

    // ---- Tally: count the rows, pop the stars, show the badge, then unlock the buttons ----
    const rows = o.tally ?? [];
    const tl = new TallyTimeline(rows);
    const shownText: string[] = rows.map(() => '');
    let revealed = false;
    const reveal = (fast: boolean): void => {
      // After the count: stars, then stats + badge, then buttons + next preview.
      popStars(fast);
      const nStars = o.stars ?? 0;
      const t1 = (fast ? 150 : 300) + nStars * (fast ? 150 : 400) + 120;
      this.later(fast ? 60 : 200, () => stats.classList.remove('pending'));
      this.later(t1, () => {
        if (badge) {
          badge.classList.remove('pending');
          this.hooks.best();
        }
      });
      this.later(t1 + (badge ? (fast ? 200 : 450) : 0), () => {
        btns.classList.remove('wait');
        next?.classList.remove('pending');
        this.skipFn = null;
        this.nav.focusInitial(ov);
        autoClick();
      });
      this.skipFn = () => {
        // A tap while the stars pop: show everything now.
        this.clearTimers();
        stars?.classList.add('fast', 'run');
        stats.classList.remove('pending');
        badge?.classList.remove('pending');
        btns.classList.remove('wait');
        next?.classList.remove('pending');
        this.nav.focusInitial(ov);
        autoClick();
      };
    };
    const paint = (): void => {
      rows.forEach((_, i) => {
        const e = tallyEls[i];
        if (tl.visible(i)) e.row.classList.remove('pending');
        const t = fmt(tl.value(i));
        if (t !== shownText[i]) {
          shownText[i] = t;
          e.val.textContent = t;
        }
      });
    };
    const apply = (u: ReturnType<TallyTimeline['update']>, skipped: boolean): void => {
      if (!skipped && u.ticks > 0) {
        let row = 0;
        for (let i = 0; i < rows.length; i++) if (tl.visible(i)) row = i;
        this.fx.play('tick', 0.9 + 0.12 * row);
      }
      for (const i of u.finished) {
        tallyEls[i].row.classList.add('done');
        if (!skipped && rows[i].key === 'total') this.fx.play('total');
      }
      paint();
      if (u.completed && !revealed) {
        revealed = true;
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        reveal(skipped);
      }
    };
    paint();
    if (o.autoMs) {
      apply(tl.skip(), true); // autopilot: no waiting for the count
      return;
    }
    this.skipFn = () => {
      apply(tl.skip(), true);
    };
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      apply(tl.update(dt), false);
      if (!tl.done) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame((now) => {
      last = now;
      this.raf = requestAnimationFrame(frame);
    });
    // Tap anywhere on the card fast-forwards (buttons are hidden and unclickable until the tally is done).
    ov.addEventListener('pointerdown', (e) => {
      if (this.skipTally()) e.preventDefault();
    });
  }

  showContinue(level: number, h: { onContinue(): void; onNew(): void; onBack(): void }, subtitle?: string): void {
    this.card({
      kicker: 'WELCOME BACK',
      title: 'World 1',
      ...(subtitle ? { subtitle } : {}),
      buttons: [
        { label: `Continue from level ${level}`, primary: true, onClick: h.onContinue },
        { label: 'New run', onClick: h.onNew },
        { label: 'Back', back: true, onClick: h.onBack },
      ],
      onBack: h.onBack,
    });
  }

  // ---- Level select ----
  showLevelSelect(p: Progress, o: LevelSelectOpts): void {
    const ov = el('div', 'ui-overlay ui-levels');
    const head = el('div', 'ui-levels-head');
    const back = el('button', 'ui-btn small', '‹ BACK');
    back.dataset.sfx = 'back';
    back.addEventListener('click', o.onBack);
    const ts = totalStars(p);
    const total = el('span', 'ui-levels-stars');
    total.setAttribute('aria-label', `${ts.have} of ${ts.max} stars`);
    total.append(el('i', undefined, '★'), document.createTextNode(` ${ts.have} / ${ts.max}`));
    head.append(back, el('h2', 'ui-levels-title', 'LEVELS'), total);
    const grid = el('div', 'ui-grid');
    const focusIdx = Math.min(p.unlocked, CAMPAIGN.length - 1);
    let focusTile: HTMLElement | null = null;
    CAMPAIGN.forEach((lv, i) => {
      const locked = i > p.unlocked;
      const cur = i === focusIdx && p.stars[i] === 0;
      const t = el('button', `ui-tile${locked ? ' locked' : ''}${cur ? ' current' : ''}`);
      const pic = el('span', 'tp');
      pic.append(thumbImg(i, 'thumb'));
      const num = el('span', 'tn', String(i + 1));
      const name = el('span', 'tm', lv.name);
      t.append(pic, num, name);
      if (locked) {
        const l = el('span', 'tl');
        l.innerHTML = LOCK_SVG;
        t.append(l);
        t.setAttribute('aria-disabled', 'true');
        t.setAttribute('aria-label', `Level ${i + 1}, ${lv.name}, locked`);
      } else {
        t.append(starRow(p.stars[i], false, 'ui-stars tiny'), el('span', 'tb', p.best[i] > 0 ? fmt(p.best[i]) : ' '));
        t.setAttribute('aria-label', `Level ${i + 1}, ${lv.name}, ${p.stars[i]} stars${p.best[i] > 0 ? `, best ${fmt(p.best[i])}` : ''}`);
      }
      if (i === focusIdx) {
        t.dataset.primary = '1';
        focusTile = t;
      }
      t.addEventListener('click', () => {
        if (locked) {
          t.classList.remove('shake');
          void t.offsetWidth;
          t.classList.add('shake');
          this.fx.play('locked');
          notice(this.root, `Clear level ${p.unlocked + 1} to unlock`);
          return;
        }
        o.onPick(i);
      });
      grid.append(t);
    });
    ov.append(head, grid);
    this.mount(ov, o.onBack);
    // The level you are on (or the next one to play) starts in view.
    (focusTile as HTMLElement | null)?.scrollIntoView({ block: 'center' });
  }
}
