import { readStore, writeStore } from '../ui/storage';

export const IOS_HINT_KEY = 'shatter.iosHint.v1';

/** Pure: iPhone / iPad Safari (iPadOS 13+ reports itself as a touch-capable Mac). Other iOS browsers cannot install. */
export function isIosSafari(ua: string, platform: string, maxTouchPoints: number): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (!ios) return false;
  return /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
}

export interface IosHintInput {
  iosSafari: boolean;
  standalone: boolean;
  dismissed: boolean;
  /** At least one level has been completed. */
  completedLevel: boolean;
}

/** Pure: show the Add-to-Home-Screen hint on the title? Once, after the first completed level, never when installed. */
export const iosHintEligible = (i: IosHintInput): boolean => i.iosSafari && !i.standalone && !i.dismissed && i.completedLevel;

export interface InstallButtonInput {
  standalone: boolean;
  installed: boolean;
  promptAvailable: boolean;
}

/** Pure: show the INSTALL APP button (needs a captured beforeinstallprompt; hidden once installed or running standalone). */
export const installButtonVisible = (i: InstallButtonInput): boolean => i.promptAvailable && !i.installed && !i.standalone;

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return ['standalone', 'fullscreen', 'minimal-ui'].some((m) => window.matchMedia(`(display-mode: ${m})`).matches);
  } catch {
    return false;
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Captures `beforeinstallprompt` (create it at startup: the event can fire early) and exposes it as a button state. */
export class Installer {
  private ev: BeforeInstallPromptEvent | null = null;
  private installed = false;
  private readonly listeners = new Set<() => void>();

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.ev = e as BeforeInstallPromptEvent;
      this.emit();
    });
    window.addEventListener('appinstalled', () => {
      this.installed = true;
      this.ev = null;
      this.emit();
    });
  }

  get canInstall(): boolean {
    return installButtonVisible({ standalone: isStandalone(), installed: this.installed, promptAvailable: this.ev !== null });
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** Must run from a tap. */
  async prompt(): Promise<void> {
    const e = this.ev;
    if (!e) return;
    this.ev = null; // the event can be used once
    this.emit();
    try {
      await e.prompt();
      const r = await e.userChoice;
      if (r.outcome === 'accepted') this.installed = true;
    } catch {
      /* dismissed or unsupported */
    }
    this.emit();
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }
}

export const iosHintDismissed = (): boolean => readStore(IOS_HINT_KEY) !== null;
export const dismissIosHint = (): void => writeStore(IOS_HINT_KEY, '1');

export function iosHintNow(completedLevel: boolean): boolean {
  if (typeof navigator === 'undefined') return false;
  return iosHintEligible({
    iosSafari: isIosSafari(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0),
    standalone: isStandalone(),
    dismissed: iosHintDismissed(),
    completedLevel,
  });
}
