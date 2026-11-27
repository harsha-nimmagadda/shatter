import { enter, leave } from './motion';

let cur: HTMLElement | null = null;
let timer = 0;

/** A small transient message pill near the bottom of the screen (e.g. "Clear level 4 to unlock"). One at a time. */
export function notice(root: HTMLElement, text: string, ms = 1900): void {
  window.clearTimeout(timer);
  if (cur) void leave(cur, true);
  const t = document.createElement('div');
  t.className = 'ui-notice';
  t.setAttribute('role', 'status');
  t.textContent = text;
  root.appendChild(t);
  cur = t;
  void enter(t);
  timer = window.setTimeout(() => {
    if (cur === t) {
      cur = null;
      void leave(t);
    }
  }, ms);
}
