type WebkitDocElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

/** Best-effort fullscreen and portrait lock. Every failure is ignored. */
export async function enterImmersive(): Promise<void> {
  try {
    const el = document.documentElement as WebkitDocElement;
    if (!document.fullscreenElement) {
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
