import { Calibrator } from '../input/calibration';
import type { TiltInput } from '../input/tilt';
import { enter, leave } from './motion';
import type { Nav } from './nav';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const RING = 2 * Math.PI * 74;

/** A phone with a tiny paddle on its screen, tilting left or right; the ring fills while a pose is being held. */
export const WIZ_ART = `
<svg viewBox="0 0 220 170" aria-hidden="true">
  <circle class="wiz-track" cx="110" cy="85" r="74" fill="none" stroke-width="5"/>
  <circle class="wiz-ring" cx="110" cy="85" r="74" fill="none" stroke-width="5" stroke-linecap="round"
    stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="${RING.toFixed(1)}" transform="rotate(-90 110 85)"/>
  <path class="wiz-arrow wiz-al" d="M34 85l16-14v28z"/>
  <path class="wiz-arrow wiz-ar" d="M186 85l-16-14v28z"/>
  <g class="wiz-phone">
    <rect x="78" y="30" width="64" height="110" rx="13" class="wiz-body"/>
    <rect x="84" y="40" width="52" height="88" rx="6" class="wiz-screen"/>
    <rect x="102" y="33.5" width="16" height="3" rx="1.5" class="wiz-notch"/>
    <g class="wiz-pad"><rect x="97" y="116" width="26" height="5" rx="2.5"/></g>
    <circle cx="110" cy="100" r="3.2" class="wiz-ball"/>
  </g>
</svg>`;

const COPY: Record<'neutral' | 'left' | 'right' | 'done', { title: string; sub: string }> = {
  neutral: {
    title: 'Hold the phone the way you like to play',
    sub: 'Any position works: sitting up, on the couch, lying down. Tap READY and stay roughly still for a moment.',
  },
  left: { title: 'Swing fully LEFT', sub: 'Tilt as far left as the paddle should reach, then come back. No need to hold it.' },
  right: { title: 'Swing fully RIGHT', sub: 'Now the other way: as far right as the paddle should reach, then come back.' },
  done: { title: 'All set!', sub: '' },
};

/**
 * The 3-step tilt calibration wizard (modal). Resolves 'saved' once a valid calibration was stored, or 'skipped'
 * when the player backs out (the automatic setup stays in effect).
 */
export function runTiltWizard(root: HTMLElement, nav: Nav | undefined, tilt: TiltInput, skipLabel = 'SKIP'): Promise<'saved' | 'skipped'> {
  return new Promise((resolve) => {
    const cal = new Calibrator();
    const ov = el('div', 'ui-overlay ui-wiz');
    const card = el('div', 'ui-card ui-wizcard');
    const dots = el('div', 'wiz-dots');
    const dotEls = [0, 1, 2].map(() => el('span'));
    dots.append(...dotEls);
    const art = el('div', 'wiz-art s-neutral');
    art.innerHTML = WIZ_ART;
    const ring = art.querySelector<SVGCircleElement>('.wiz-ring');
    const text = el('div', 'wiz-text');
    const title = el('h2', 'ui-card-title wiz-title');
    const sub = el('p', 'wiz-sub');
    const live = el('div', 'wiz-live');
    const msg = el('p', 'wiz-msg');
    const ready = el('button', 'ui-btn mid primary', 'READY');
    ready.dataset.primary = '1';
    const skip = el('button', 'ui-btn small', skipLabel);
    skip.dataset.sfx = 'back';
    const btns = el('div', 'ui-card-btns');
    btns.append(ready, skip);
    text.append(title, sub, live, msg, btns);
    card.append(dots, art, text);
    ov.append(card);

    let raf = 0;
    let finished = false;
    let shownStep = '';
    let shownArmed = false;

    const close = (r: 'saved' | 'skipped'): void => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      void leave(ov);
      resolve(r);
    };

    const render = (): void => {
      const step = cal.step;
      const stepIdx = step === 'neutral' ? 0 : step === 'left' ? 1 : step === 'right' ? 2 : 3;
      if (step !== shownStep || cal.armed !== shownArmed) {
        if (step !== shownStep) {
          art.className = `wiz-art s-${step}`;
          card.classList.remove('pop');
          void card.offsetWidth; // restart the pop animation
          card.classList.add('pop');
        }
        shownStep = step;
        shownArmed = cal.armed;
        title.textContent = COPY[step].title;
        sub.textContent =
          step === 'neutral' && cal.armed
            ? 'Almost there…'
            : step === 'done' && cal.result
              ? `Left ${Math.round(cal.result.left)}° · Right ${Math.round(cal.result.right)}°`
              : COPY[step].sub;
        ready.hidden = !(step === 'neutral' && !cal.armed);
        dotEls.forEach((d, i) => {
          d.className = i < stepIdx ? 'done' : i === stepIdx ? 'now' : '';
        });
        if (step === 'neutral' && !cal.armed) nav?.focusInitial(ov);
      }
      ring?.setAttribute('stroke-dashoffset', (RING * (1 - cal.progress)).toFixed(1));
      msg.textContent = cal.message;
      live.textContent = step === 'left' || step === 'right' ? `${Math.round(cal.deviation)}° from the middle` : '';
    };

    const tick = (): void => {
      if (finished) return;
      const g = tilt.gravityFast() ?? tilt.gravity();
      if (g) cal.feed(g, performance.now());
      else if (cal.armed) cal.message = 'Waiting for the motion sensor…';
      render();
      if (cal.step === 'done' && cal.result) {
        finished = true;
        tilt.setCalibration(cal.result);
        window.setTimeout(() => {
          void leave(ov);
          resolve('saved');
        }, 1000);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    ready.addEventListener('click', () => {
      cal.arm(performance.now());
      render();
      skip.focus({ preventScroll: true });
    });
    skip.addEventListener('click', () => close('skipped'));
    nav?.register(ov, () => close('skipped'));
    root.appendChild(ov);
    void enter(ov);
    render();
    nav?.focusInitial(ov);
    raf = requestAnimationFrame(tick);
  });
}
