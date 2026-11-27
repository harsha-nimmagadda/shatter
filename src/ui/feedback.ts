import type { SoundManager } from '../audio/sound';

/** UI sounds, one set for every menu (synth.ts recipes `ui_*`). */
export type UiSound = 'tap' | 'confirm' | 'back' | 'toggle' | 'tab' | 'locked' | 'whoosh' | 'tick' | 'count' | 'go' | 'total';

const HAPTIC_MS: Partial<Record<UiSound, number>> = { tap: 6, confirm: 9, toggle: 6 };

export interface ClickInfo {
  tag: string;
  /** input type, for inputs. */
  type?: string;
  classes: readonly string[];
  /** data-sfx override: a UiSound, or 'none'. */
  sfx?: string;
  primary: boolean;
  ariaDisabled: boolean;
}

const SOUNDS: readonly string[] = ['tap', 'confirm', 'back', 'toggle', 'tab', 'locked', 'whoosh', 'tick', 'count', 'go', 'total'];

/** Pure: the sound a click on this control makes (null = none; checkboxes sound on `change`, sliders are silent). */
export function classifyClick(i: ClickInfo): UiSound | null {
  if (i.sfx === 'none') return null;
  if (i.sfx && SOUNDS.includes(i.sfx)) return i.sfx as UiSound;
  if (i.tag === 'input') return null;
  if (i.ariaDisabled) return null;
  if (i.classes.includes('ui-tab')) return 'tab';
  if (i.primary || i.classes.includes('primary') || i.classes.includes('big')) return 'confirm';
  return 'tap';
}

/** Plays UI sounds and the light confirm tick through one object, honouring the sound and Vibration settings. */
export class UiFx {
  constructor(
    private readonly sound: Pick<SoundManager, 'play'>,
    private readonly settings: { haptics: boolean },
  ) {}

  play(kind: UiSound, pitch?: number): void {
    this.sound.play(`ui_${kind}`, pitch !== undefined ? { pitch } : {});
    const ms = HAPTIC_MS[kind];
    if (ms !== undefined) this.haptic(ms);
  }

  haptic(ms: number): void {
    if (!this.settings.haptics || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return;
    try {
      navigator.vibrate(ms);
    } catch {
      /* not allowed before a gesture */
    }
  }
}

const PRESSABLE = '.ui-btn, .ui-tile, .ui-ptile, .ui-choice, .ui-hud-btn';

/**
 * The one place buttons get their feel: a delegated click sound + haptic for every button under `root`, a switch
 * sound when a checkbox changes, and a pressed state (scale + glow, see CSS `.is-pressed`) while a pointer is down.
 */
export function installUiFeedback(root: HTMLElement, fx: UiFx): void {
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('button, input');
    if (!b || (b as HTMLButtonElement).disabled) return;
    const kind = classifyClick({
      tag: b.tagName.toLowerCase(),
      type: (b as HTMLInputElement).type,
      classes: Array.from(b.classList),
      ...(b.dataset.sfx ? { sfx: b.dataset.sfx } : {}),
      primary: b.hasAttribute('data-primary'),
      ariaDisabled: b.getAttribute('aria-disabled') === 'true',
    });
    if (kind) fx.play(kind);
  });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | null;
    if (t?.tagName === 'INPUT' && t.type === 'checkbox') fx.play('toggle');
  });

  let held: HTMLElement | null = null;
  const release = (): void => {
    held?.classList.remove('is-pressed');
    held = null;
  };
  root.addEventListener(
    'pointerdown',
    (e) => {
      release();
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(PRESSABLE);
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
      held = el;
      el.classList.add('is-pressed');
    },
    true,
  );
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', release);
}
