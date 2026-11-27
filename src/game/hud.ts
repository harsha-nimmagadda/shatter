import { LOGICAL_H, LOGICAL_W } from './view';

/**
 * The top HUD band as one set of fixed slots, so nothing can overlap at any aspect ratio:
 *
 *   [pause]  SCORE        LEVEL        hearts [fullscreen]
 *
 * The canvas draws SCORE / LEVEL / hearts in logical units; the DOM buttons are placed from the same numbers, so
 * both follow the letterboxed playfield (not the window edge) and respect the notch / safe-area insets.
 */

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface HudInput {
  /** Canvas CSS size. */
  cssW: number;
  cssH: number;
  /** CSS px per logical unit and the playfield offset inside the canvas (from the View transform). */
  scale: number;
  offsetX: number;
  offsetY: number;
  safe: SafeInsets;
  fullscreenSupported: boolean;
}

export interface HudLayout {
  /** Visual diameter of the icon buttons, CSS px (the touch target is always at least MIN_TOUCH). */
  v: number;
  /** Touch target size, CSS px. */
  touch: number;
  /** Logical y of the band's vertical centre (text baseline row). */
  cy: number;
  /** Logical y of the band's bottom edge. */
  bottom: number;
  /** Logical x where the left slot (pause button) ends: SCORE starts here. */
  scoreX: number;
  /** Logical x where the hearts end (the fullscreen slot starts, or the band's right edge when it collapses). */
  livesRight: number;
  /** Logical x of the band's right edge (combo text aligns here). */
  edgeRight: number;
  /** Pause button centre, CSS px in canvas coordinates. */
  pause: { x: number; y: number };
  /** Fullscreen button centre, or null when unsupported (the slot collapses). */
  fs: { x: number; y: number } | null;
}

export const MIN_TOUCH = 44;
const EDGE_PAD = 6;
const SLOT_GAP = 6;
/** Keep the band inside the engine's top wall (CONFIG.topWall = 64). */
const BAND_MAX_LOGICAL = 62;
const BAND_MIN_CSS = 38;
const V_MIN = 22;
const V_MAX = 34;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeHudLayout(i: HudInput): HudLayout {
  const s = i.scale > 0 ? i.scale : 1;
  // Band height in CSS px: at least a comfortable button, at most what the top wall leaves (tiny landscape fits).
  const bandCss = Math.min(Math.max(44 * s, BAND_MIN_CSS), BAND_MAX_LOGICAL * s);
  const v = clamp(bandCss - 4, V_MIN, V_MAX);
  const slot = EDGE_PAD + v + SLOT_GAP; // CSS px a button slot occupies from the band edge
  // Band edges in canvas CSS px: the playfield edge, or further in where a notch / rounded corner eats it.
  const leftCss = Math.max(i.offsetX, i.safe.left);
  const rightCss = Math.min(i.cssW - i.offsetX, i.cssW - i.safe.right);
  const topCss = Math.max(i.offsetY, i.safe.top);
  const cyCss = topCss + bandCss / 2;
  const toLx = (x: number): number => (x - i.offsetX) / s;
  const toLy = (y: number): number => (y - i.offsetY) / s;
  const pause = { x: leftCss + EDGE_PAD + v / 2, y: cyCss };
  const fs = i.fullscreenSupported ? { x: rightCss - EDGE_PAD - v / 2, y: cyCss } : null;
  const edgeRight = toLx(rightCss) - 10;
  const livesRight = fs ? toLx(rightCss - slot) + 2 : edgeRight;
  return {
    v,
    touch: Math.max(MIN_TOUCH, v),
    cy: toLy(cyCss),
    bottom: toLy(topCss + bandCss),
    scoreX: toLx(leftCss + slot) + 2,
    livesRight,
    edgeRight,
    pause,
    fs,
  };
}

/** Layout for an exact 540x960 canvas with fullscreen available (tests and the first frame before the View reports). */
export const DEFAULT_HUD: HudLayout = computeHudLayout({
  cssW: LOGICAL_W,
  cssH: LOGICAL_H,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  safe: { top: 0, right: 0, bottom: 0, left: 0 },
  fullscreenSupported: true,
});

let probe: HTMLElement | null = null;

/** Reads the safe-area insets (notch, home indicator) in CSS px. All zero where unsupported. */
export function readSafeInsets(): SafeInsets {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof document === 'undefined' || !document.body) return zero;
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  const px = (v: string): number => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
}
