type FsDoc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

/** False on iPhone Safari (no Fullscreen API); installing to the Home Screen already runs fullscreen there. */
export function isFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FsDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Best-effort fullscreen plus portrait lock. Every failure is ignored. */
export async function enterFullscreen(): Promise<void> {
  try {
    const el = document.documentElement as FsEl;
    if (!isFullscreen()) {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    }
  } catch {
    /* ignore */
  }
  try {
    await screen.orientation?.lock?.('portrait');
  } catch {
    /* ignore */
  }
}

export async function exitFullscreen(): Promise<void> {
  try {
    const d = document as FsDoc;
    if (isFullscreen()) {
      if (d.exitFullscreen) await d.exitFullscreen();
      else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
    }
  } catch {
    /* ignore */
  }
}

export function toggleFullscreen(): Promise<void> {
  return isFullscreen() ? exitFullscreen() : enterFullscreen();
}

/** Subscribe to fullscreen changes (standard and webkit-prefixed). */
export function onFullscreenChange(fn: () => void): void {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
}
