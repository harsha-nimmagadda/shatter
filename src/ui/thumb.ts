import { CAMPAIGN } from '../engine/campaign';
import type { BrickType } from '../engine';
import { brickHue, shade } from '../render/palette';

export interface ThumbCell {
  col: number;
  row: number;
  color: string;
  alpha: number;
}

/** Pure: a level-row character -> brick colour (same hues as the game: hp 1/2/3, metal, bomb, slider, regrow, hidden). */
export function thumbColor(ch: string): { color: string; alpha: number } | null {
  switch (ch) {
    case '1':
    case '2':
    case '3':
      return { color: brickHue('normal', Number(ch)), alpha: 1 };
    case '#':
      return { color: brickHue('steel', 1), alpha: 1 };
    case 'x':
      return { color: brickHue('explosive', 1), alpha: 1 };
    case 'm':
      return { color: brickHue('moving' as BrickType, 1), alpha: 1 };
    case 'r':
      return { color: brickHue('regen', 1), alpha: 1 };
    case 'h':
      return { color: brickHue('hidden', 2), alpha: 0.5 };
    default:
      return null;
  }
}

/** Pure: the coloured cells of a level picture. */
export function thumbCells(rows: readonly string[]): ThumbCell[] {
  const out: ThumbCell[] = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const k = thumbColor(row[c]);
      if (k) out.push({ col: c, row: r, ...k });
    }
  });
  return out;
}

/** Canvas pixels per brick; shown at half size so it stays crisp on 2x screens. */
const CW = 12;
const CH = 6;
export const THUMB_COLS = 10;
export const THUMB_MAX_ROWS = 9;
/** CSS size of one thumbnail cell. */
export const THUMB_CSS = { w: CW / 2, h: CH / 2 };

const cache = new Map<number, string>();

/** Cached data-URL picture of campaign level `index` (drawn once, on first use). Empty string without a canvas. */
export function thumbUrl(index: number): string {
  const hit = cache.get(index);
  if (hit !== undefined) return hit;
  const lv = CAMPAIGN[index];
  if (!lv || typeof document === 'undefined') return '';
  const cv = document.createElement('canvas');
  cv.width = THUMB_COLS * CW;
  cv.height = lv.rows.length * CH;
  const g = cv.getContext('2d');
  if (!g) return '';
  for (const c of thumbCells(lv.rows)) {
    g.globalAlpha = c.alpha;
    g.fillStyle = c.color;
    g.fillRect(c.col * CW + 0.5, c.row * CH + 0.5, CW - 1, CH - 1);
    g.fillStyle = shade(c.color, 0.45);
    g.fillRect(c.col * CW + 0.5, c.row * CH + 0.5, CW - 1, 1.5);
  }
  const url = cv.toDataURL('image/png');
  cache.set(index, url);
  return url;
}

/** An <img> of a level's picture, sized in CSS px. */
export function thumbImg(index: number, cls = 'thumb'): HTMLImageElement {
  const img = document.createElement('img');
  img.className = cls;
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  img.src = thumbUrl(index);
  const rows = CAMPAIGN[index]?.rows.length ?? 1;
  img.style.width = `${THUMB_COLS * THUMB_CSS.w}px`;
  img.style.height = `${rows * THUMB_CSS.h}px`;
  return img;
}
