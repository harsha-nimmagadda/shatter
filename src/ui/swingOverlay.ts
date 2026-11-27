import { QuickStart } from '../input/adaptive';
import type { TiltInput } from '../input/tilt';
import { enter, leave } from './motion';
import type { Nav } from './nav';
import { WIZ_ART } from './tiltWizard';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Time to read the card before the first cue, ms (shorter after a retry). */
const GET_READY_MS = 1100;
const RETRY_READY_MS = 700;

/**
 * Adaptive tilt quick start (modal): "Swing your phone left and right a few times" with a live meter, about 3 s or
 * until enough motion was seen. Resolves 'saved' once the learned calibration went into the TiltInput, or 'skipped'.
 */
export function runSwingOverlay(root: HTMLElement, nav: Nav | undefined, tilt: TiltInput, skipLabel = 'SKIP'): Promise<'saved' | 'skipped'> {
  return new Promise((resolve) => {
    const qs = new QuickStart();
    const ov = el('div', 'ui-overlay ui-wiz ui-swing');
    const card = el('div', 'ui-card ui-wizcard');
    const art = el('div', 'wiz-art s-swing');
    art.innerHTML = WIZ_ART;
    const text = el('div', 'wiz-text');
    const title = el('h2', 'ui-card-title wiz-title', 'Swing your phone left and right');
    const sub = el('p', 'wiz-sub', 'A few times, like steering a wheel. Any way you like to hold it.');
    const cue = el('div', 'swing-cue', 'GET READY');
    const meter = el('div', 'swing-meter');
    const fill = el('i');
    meter.append(fill);
    meter.setAttribute('role', 'progressbar');
    const msg = el('p', 'wiz-msg');
    const skip = el('button', 'ui-btn small', skipLabel);
    skip.dataset.sfx = 'back';
    skip.dataset.primary = '1';
    const btns = el('div', 'ui-card-btns');
    btns.append(skip);
    text.append(title, sub, cue, meter, msg, btns);
    card.append(art, text);
    ov.append(card);

    let raf = 0;
    let finished = false;
    let readyAt = performance.now() + GET_READY_MS;
    let shown = '';
    let doneAt = 0;

    const close = (r: 'saved' | 'skipped'): void => {
      if (finished && r === 'skipped') return;
      finished = true;
      cancelAnimationFrame(raf);
      void leave(ov);
      resolve(r);
    };

    const setCue = (c: string): void => {
      if (c === shown) return;
      shown = c;
      cue.textContent = c;
      cue.dataset.cue = c.toLowerCase().replace(/\W+/g, '');
      art.className = `wiz-art s-${c === 'LEFT' ? 'left' : c === 'RIGHT' ? 'right' : 'swing'}`;
    };

    const tick = (): void => {
      if (finished) return;
      const now = performance.now();
      const g = tilt.gravityFast() ?? tilt.gravity();
      if (!g) {
        msg.textContent = 'Waiting for the motion sensor…';
      } else if (now < readyAt) {
        // Reading time: ignore the motion so far.
        setCue('GET READY');
      } else if (qs.phase === 'left' || qs.phase === 'right') {
        msg.textContent = '';
        qs.feed(g, now);
        setCue(qs.phase === 'left' ? 'LEFT' : qs.phase === 'right' ? 'RIGHT' : '');
      }
      if (qs.phase === 'done' && qs.result) {
        if (!doneAt) {
          doneAt = now;
          setCue('GOT IT');
          title.textContent = 'All set!';
          sub.textContent = `Left ${Math.round(qs.result.left)}° · Right ${Math.round(qs.result.right)}° · it keeps adapting as you play`;
          tilt.startAdaptive(qs.result);
        }
        if (now - doneAt > 900) {
          finished = true;
          void leave(ov);
          resolve('saved');
          return;
        }
      } else if (qs.phase === 'failed') {
        msg.textContent = qs.failure;
        setCue('TRY AGAIN');
        qs.reset();
        readyAt = now + RETRY_READY_MS + 900;
      }
      fill.style.width = `${Math.round(qs.meter * 100)}%`;
      meter.setAttribute('aria-valuenow', String(Math.round(qs.meter * 100)));
      raf = requestAnimationFrame(tick);
    };

    skip.addEventListener('click', () => close('skipped'));
    nav?.register(ov, () => close('skipped'));
    root.appendChild(ov);
    void enter(ov);
    nav?.focusInitial(ov);
    raf = requestAnimationFrame(tick);
  });
}
