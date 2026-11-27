import { enter, leave } from './motion';

let cur: HTMLElement | null = null;
let finish: (() => void) | null = null;

/** Dismisses the callout on screen, if any. */
export function dismissCallout(instant = false): void {
  const c = cur;
  if (!c) return;
  cur = null;
  void leave(c, instant);
  finish?.();
  finish = null;
}

/**
 * A short teaching pill ("NEW: BOMB — explodes its neighbours") under the level intro. One at a time; a tap on it
 * (or anything calling dismissCallout) skips it. Resolves when it is gone.
 */
export function showCallout(root: HTMLElement, text: string, ms = 2600): Promise<void> {
  dismissCallout(true);
  const d = document.createElement('div');
  d.className = 'ui-callout';
  d.setAttribute('role', 'status');
  d.textContent = text;
  root.appendChild(d);
  cur = d;
  void enter(d);
  return new Promise((resolve) => {
    const t = window.setTimeout(() => dismissCallout(), ms);
    finish = () => {
      window.clearTimeout(t);
      resolve();
    };
    d.addEventListener('pointerdown', () => dismissCallout(), { once: true });
  });
}
