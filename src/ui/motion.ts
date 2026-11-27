/**
 * One motion language for every DOM screen, written once:
 *   overlay in   backdrop fades 180 ms; the panel scales 0.96 -> 1 and fades 220 ms (ease-out)
 *   overlay out  ~140 ms, slightly faster, ends with the overlay removed
 *   screen jump  a neon wipe (cover, switch, reveal) around a callback
 * Everything is a promise, driven by the Web Animations API, so nothing is a loose setTimeout. All of it is
 * skipped when the Reduce motion setting or `prefers-reduced-motion` is on (the work still happens, just instantly).
 */

export const MOTION = {
  backdropIn: 180,
  panelIn: 220,
  out: 140,
  wipe: 190,
  panelFrom: 0.96,
  panelTo: 0.97,
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
  easeIn: 'cubic-bezier(0.5, 0, 0.9, 0.5)',
} as const;

/** Panels inside an overlay that get the scale+fade; overlays without one (full screens) only fade. */
const PANEL = ':scope > .ui-card, :scope > .ui-pausecard, :scope > .ui-panel';

let settingOff = false;
let mq: MediaQueryList | null | undefined;

const prefersReduced = (): boolean => {
  if (mq === undefined) {
    try {
      mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    } catch {
      mq = null;
    }
  }
  return mq?.matches ?? false;
};

/** Pure: motion is off when either the in-game setting or the OS preference asks for it. */
export const motionIsOff = (setting: boolean, osPrefers: boolean): boolean => setting || osPrefers;

export const motionOff = (): boolean => motionIsOff(settingOff, prefersReduced());

/** Mirrors the Reduce motion / reduced effects setting; also flips `html[data-motion=off]` so CSS can stand still. */
export function setReduceMotion(on: boolean): void {
  settingOff = on;
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = motionOff() ? 'off' : 'on';
}

export interface Frames {
  keyframes: Keyframe[];
  opts: KeyframeAnimationOptions;
}

/** Pure: the keyframes and timing of the backdrop (overlay) or panel, entering or leaving. */
export function overlayFrames(part: 'backdrop' | 'panel', dir: 'in' | 'out'): Frames {
  const into = dir === 'in';
  if (part === 'backdrop') {
    return {
      keyframes: into ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
      opts: { duration: into ? MOTION.backdropIn : MOTION.out, easing: into ? 'ease-out' : 'ease-in', fill: into ? 'backwards' : 'forwards' },
    };
  }
  return {
    keyframes: into
      ? [{ opacity: 0, transform: `scale(${MOTION.panelFrom})` }, { opacity: 1, transform: 'scale(1)' }]
      : [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: `scale(${MOTION.panelTo})` }],
    opts: { duration: into ? MOTION.panelIn : MOTION.out, easing: into ? MOTION.ease : MOTION.easeIn, fill: into ? 'backwards' : 'forwards' },
  };
}

const running = new WeakMap<HTMLElement, Animation[]>();
const generation = new WeakMap<HTMLElement, number>();

/** Resolves when the animation ends or (safety net for hidden tabs / cancelled animations) a little after it should have. */
function settle(a: Animation, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(resolve, ms + 150);
    a.finished.then(
      () => {
        window.clearTimeout(t);
        resolve();
      },
      () => {
        window.clearTimeout(t);
        resolve();
      },
    );
  });
}

function play(ov: HTMLElement, dir: 'in' | 'out'): Promise<void>[] {
  const list: Promise<void>[] = [];
  const anims: Animation[] = [];
  const add = (el: Element, f: Frames): void => {
    const a = el.animate(f.keyframes, f.opts);
    anims.push(a);
    list.push(settle(a, Number(f.opts.duration)));
  };
  add(ov, overlayFrames('backdrop', dir));
  const panel = ov.querySelector<HTMLElement>(PANEL);
  if (panel) add(panel, overlayFrames('panel', dir));
  running.set(ov, anims);
  return list;
}

/** Stops a leave() that is still running (the overlay is being shown again). */
function cancelLeave(ov: HTMLElement): void {
  generation.set(ov, (generation.get(ov) ?? 0) + 1);
  for (const a of running.get(ov) ?? []) a.cancel();
  running.delete(ov);
  ov.classList.remove('closing');
  ov.removeAttribute('aria-hidden');
}

/** Call right after appending the overlay: fades the backdrop in and scales the panel up. */
export function enter(ov: HTMLElement): Promise<void> {
  cancelLeave(ov);
  if (motionOff() || typeof ov.animate !== 'function') return Promise.resolve();
  return Promise.all(play(ov, 'in')).then(() => {
    running.delete(ov);
  });
}

/**
 * Fades the overlay out and removes it. It is marked `.closing` straight away (inert, and skipped by Nav), so
 * whatever opens next can take focus immediately and cross-fade with it. `instant` skips the animation.
 */
export function leave(ov: HTMLElement, instant = false): Promise<void> {
  const gen = (generation.get(ov) ?? 0) + 1;
  generation.set(ov, gen);
  const finish = (): void => {
    if (generation.get(ov) !== gen) return;
    running.delete(ov);
    ov.remove();
    ov.classList.remove('closing');
    ov.removeAttribute('aria-hidden');
  };
  if (!ov.isConnected) {
    finish();
    return Promise.resolve();
  }
  ov.classList.add('closing');
  ov.setAttribute('aria-hidden', 'true');
  if (instant || motionOff() || typeof ov.animate !== 'function') {
    finish();
    return Promise.resolve();
  }
  return Promise.all(play(ov, 'out')).then(finish);
}

let wiping = false;

/**
 * Neon wipe between screens: a dark panel with a pink-to-cyan leading edge sweeps in (cover), `mid` switches the
 * screen underneath, then it sweeps out the other way (reveal). Input is blocked while it runs.
 */
export async function wipe(root: HTMLElement, mid: () => void | Promise<void>): Promise<void> {
  if (wiping || motionOff() || typeof root.animate !== 'function') {
    await mid();
    return;
  }
  wiping = true;
  const w = document.createElement('div');
  w.className = 'ui-wipe';
  w.innerHTML = '<i></i>';
  root.appendChild(w);
  const d = MOTION.wipe;
  try {
    const cover = w.animate([{ transform: 'translateX(-102%) scaleX(1)' }, { transform: 'translateX(0) scaleX(1)' }], { duration: d, easing: MOTION.easeIn, fill: 'forwards' });
    await settle(cover, d);
    await mid();
    const reveal = w.animate([{ transform: 'translateX(0) scaleX(-1)' }, { transform: 'translateX(102%) scaleX(-1)' }], { duration: d, easing: MOTION.ease, fill: 'forwards' });
    await settle(reveal, d);
  } finally {
    w.remove();
    wiping = false;
  }
}

/** iOS only applies :active when something listens for touchstart; harmless elsewhere. */
export function enablePressStates(): void {
  document.addEventListener('touchstart', () => undefined, { passive: true });
}
