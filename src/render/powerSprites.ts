import { createRng, type Rng } from '../engine/rng';
import { sourceSize } from './assets';
import { pickIndex } from './artLayout';
import {
  mixSeed,
  roughCirclePoints,
  roughRoundRectPoints,
  roughPolygon,
  strokePath,
  strokeRoughRect,
  strokeSegs,
  tracePolygon,
  hatchLines,
  type Pt,
} from './sketch';
import { isBadPower, powerLetter, resolveIcon } from './powerVisuals';
import type { Skin } from './skin';

/** Sprite content-box sizes and pads. */
export const CAPSULE_PAD = 9;
export const HUD_ICON = 22;
export const HUD_PAD = 3;
export const OVERLAY_PAD = 10;
export const NET_H = 18;
export const NET_PAD = 6;
export const ERASER_W = 72;
export const ERASER_H = 30;
export const PLANE_SIZE = 30;
export const GHOST_PAD = 4;

export const GOOD_COLOR = '#2f78b5';
export const GREEN_COLOR = '#3a9a5b';
export const BAD_COLOR = '#c93a3a';
export const EXPLOSIVE_COLOR = '#e8602c';
export const FIRE_COLOR = '#f2701c';

// ---------------------------------------------------------------- art helpers

const masks = new WeakMap<object, HTMLCanvasElement | null>();

/**
 * White-background doodle -> transparent-background canvas (alpha from darkness), so it can be drawn over
 * anything without a paper backing. Cached per image; null when pixels cannot be read.
 */
function artMask(img: CanvasImageSource): HTMLCanvasElement | null {
  const key = img as object;
  const hit = masks.get(key);
  if (hit !== undefined) return hit;
  let out: HTMLCanvasElement | null = null;
  try {
    const n = 96;
    const c = document.createElement('canvas');
    c.width = n;
    c.height = n;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (g) {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, n, n);
      g.drawImage(img, 0, 0, n, n);
      const data = g.getImageData(0, 0, n, n);
      const d = data.data;
      for (let i = 0; i < d.length; i += 4) {
        const lo = Math.min(d[i], d[i + 1], d[i + 2]);
        const a = Math.max(0, Math.min(255, (255 - lo) * 1.15));
        if (a < 10) {
          d[i + 3] = 0;
          continue;
        }
        const k = 255 / a;
        d[i] = Math.max(0, Math.min(255, (d[i] - 255 + a) * k));
        d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - 255 + a) * k));
        d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] - 255 + a) * k));
        d[i + 3] = a;
      }
      g.putImageData(data, 0, 0);
      out = c;
    }
  } catch {
    out = null;
  }
  masks.set(key, out);
  return out;
}

/**
 * Draws a manifest image centred at (cx, cy), `size` units square. Prefers an alpha-masked copy; if pixels
 * can't be read it falls back to 'multiply' (caller must have painted an opaque paper backing underneath).
 * Returns false when the id has no image.
 */
export function drawArt(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  id: string,
  seed: number,
  cx: number,
  cy: number,
  size: number,
  rot = 0,
): boolean {
  const imgs = skin.assets?.get(id) ?? [];
  if (!imgs.length) return false;
  const img = imgs[pickIndex(seed, imgs.length)];
  if (sourceSize(img).w < 8) return false;
  const mask = artMask(img);
  ctx.save();
  ctx.translate(cx, cy);
  if (rot) ctx.rotate(rot);
  if (mask) {
    ctx.drawImage(mask, -size / 2, -size / 2, size, size);
  } else {
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  }
  ctx.restore();
  return true;
}

export const hasArt = (skin: Skin) => (id: string): boolean => (skin.assets?.get(id).length ?? 0) > 0;

function arrow(ctx: CanvasRenderingContext2D, rng: Rng, x1: number, y1: number, x2: number, y2: number, color: string, w: number): void {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const hl = 4.5;
  strokePath(ctx, [{ x: x1, y: y1 }, { x: (x1 + x2) / 2 + rng.range(-0.5, 0.5), y: (y1 + y2) / 2 + rng.range(-0.5, 0.5) }, { x: x2, y: y2 }], rng, color, w);
  strokePath(ctx, [{ x: x2 - Math.cos(a - 0.5) * hl, y: y2 - Math.sin(a - 0.5) * hl }, { x: x2, y: y2 }, { x: x2 - Math.cos(a + 0.5) * hl, y: y2 - Math.sin(a + 0.5) * hl }], rng, color, w);
}

/** Power icon centred at (cx, cy) in a `size` box: art, procedural inward arrows (shrink) or a lettered doodle. */
export function drawPowerIcon(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  type: string,
  cx: number,
  cy: number,
  size: number,
  rng: Rng,
): void {
  const res = resolveIcon(type, hasArt(skin));
  if (res.source === 'art' && res.id && drawArt(ctx, skin, res.id, 1, cx, cy, size)) return;
  const bad = isBadPower(type);
  const color = bad ? BAD_COLOR : GOOD_COLOR;
  if (res.source === 'arrows') {
    const h = size * 0.32;
    arrow(ctx, rng, cx - h * 1.6, cy, cx - h * 0.25, cy, color, 2.2);
    arrow(ctx, rng, cx + h * 1.6, cy, cx + h * 0.25, cy, color, 2.2);
    return;
  }
  strokePath(ctx, roughCirclePoints(cx, cy, size * 0.36, rng, 0.06), rng, color, 1.8);
  ctx.font = `${Math.round(size * 0.5)}px ${skin.font}`;
  ctx.fillStyle = skin.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(powerLetter(type), cx, cy + size * 0.03);
}

// ---------------------------------------------------------------- drops / HUD

export function capsuleColor(type: string): string {
  if (isBadPower(type)) return BAD_COLOR;
  // TODO(render-revamp): category-coloured badges.
  return type === 'goldstar' || type === 'stickynote' || type === 'eraser' || type === 'correction' ? GREEN_COLOR : GOOD_COLOR;
}

/** Falling power-up capsule: rough rounded outline + icon (content box 36 x 20, icon overflows a little). */
export function renderCapsule(ctx: CanvasRenderingContext2D, skin: Skin, type: string, w: number, h: number, variant: number): void {
  const rng = createRng(mixSeed(type.length * 977 + type.charCodeAt(0), variant + 1, 41));
  const bad = isBadPower(type);
  const outline = roughRoundRectPoints(0.5, 0.5, w - 1, h - 1, h * 0.5, rng, 0.7);
  tracePolygon(ctx, outline);
  ctx.fillStyle = bad ? '#fbe2df' : '#e6f1fa';
  ctx.fill();
  strokePath(ctx, outline, rng, capsuleColor(type), 2.3);
  strokePath(ctx, roughRoundRectPoints(2.2, 2, w - 4.4, h - 4, h * 0.4, rng, 0.8), rng, capsuleColor(type), 1.1, 0.45);
  drawPowerIcon(ctx, skin, type, w / 2, h / 2, 30, rng);
}

/** Small HUD icon (content box HUD_ICON square). */
export function renderHudIcon(ctx: CanvasRenderingContext2D, skin: Skin, type: string, size: number, variant: number): void {
  const rng = createRng(mixSeed(type.charCodeAt(0), variant + 1, 42));
  drawPowerIcon(ctx, skin, type, size / 2, size / 2, size, rng);
}

// ---------------------------------------------------------------- paddle overlays

export type OverlayKind = 'glue' | 'cannons' | 'ink' | 'ticks';

export function renderPaddleOverlay(ctx: CanvasRenderingContext2D, skin: Skin, kind: OverlayKind, w: number, h: number, variant: number): void {
  const rng = createRng(mixSeed(Math.round(w), variant + 1, 50 + kind.length));
  switch (kind) {
    case 'ticks': {
      const segs = [];
      for (let x = 6, i = 1; x < w - 4; x += 6, i++) {
        const len = i % 5 === 0 ? 7 : 4;
        segs.push({ x1: x, y1: 1.5, x2: x + rng.range(-0.3, 0.3), y2: 1.5 + len });
      }
      strokeSegs(ctx, segs, rng, skin.ink, 1.1, 0.85);
      break;
    }
    case 'glue': {
      const pts: Pt[] = [];
      for (let x = 0; x <= w; x += 8) pts.push({ x, y: -1.5 + rng.range(-1.6, 1.2) });
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      for (let x = w; x >= 0; x -= 8) ctx.lineTo(x, 2.5 + rng.range(-0.5, 1));
      ctx.closePath();
      ctx.fillStyle = '#fff6c4';
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
      strokePath(ctx, pts, rng, skin.ink, 1.3, 0.8);
      const drips = Math.max(2, Math.round(w / 28));
      for (let i = 0; i < drips; i++) {
        const x = ((i + 0.5) / drips) * w + rng.range(-3, 3);
        const len = rng.range(4, 8);
        ctx.fillStyle = '#fff6c4';
        ctx.beginPath();
        ctx.moveTo(x - 2, 1);
        ctx.lineTo(x - 1.6, 1 + len);
        ctx.arc(x, 1 + len, 1.8, Math.PI, 0, true);
        ctx.lineTo(x + 2, 1);
        ctx.fill();
        strokePath(ctx, [{ x: x - 2, y: 1 }, { x: x - 1.8, y: 1 + len }, { x, y: 3 + len }, { x: x + 1.8, y: 1 + len }, { x: x + 2, y: 1 }], rng, skin.ink, 1, 0.8);
      }
      break;
    }
    case 'cannons': {
      for (const cx of [5, w - 5]) {
        const base = roughPolygon(cx - 4, -8, 8, 9, rng, 0.5);
        tracePolygon(ctx, base);
        ctx.fillStyle = '#b4b9c1';
        ctx.fill();
        strokePath(ctx, [...base, base[0]], rng, skin.ink, 1.5);
        strokePath(ctx, [{ x: cx - 1.4, y: -8 }, { x: cx - 1.4, y: -11 }, { x: cx + 1.4, y: -11 }, { x: cx + 1.4, y: -8 }], rng, skin.ink, 1.4);
      }
      break;
    }
    case 'ink': {
      const n = 14;
      const cx = w / 2;
      const cy = h / 2;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = (i % 2 ? 0.34 : 0.46) * w * rng.range(0.6, 1);
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * Math.min(rr * 0.5, h * 0.9);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.quadraticCurveTo(cx + Math.cos(a - 0.2) * rr * 1.1, cy + Math.sin(a - 0.2) * Math.min(rr * 0.55, h), px, py);
      }
      ctx.closePath();
      ctx.fillStyle = '#17171c';
      ctx.globalAlpha = 0.9;
      ctx.fill();
      for (let i = 0; i < 7; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0.3, 0.5) * w;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * Math.min(d * 0.45, h + 4), rng.range(0.8, 2), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
  }
}

// ---------------------------------------------------------------- balls

export type BallStyle = 'fire' | 'through' | 'crumpled';

export function renderStyledBall(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  style: BallStyle,
  r: number,
  variant: number,
  base: (g: CanvasRenderingContext2D, v: number) => void,
): void {
  const rng = createRng(mixSeed(Math.round(r * 10), variant + 1, 60 + style.length));
  if (style === 'crumpled') {
    const R = r * 1.35;
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R * 0.96, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f2ea';
    ctx.fill();
    ctx.clip();
    const drawn = drawArt(ctx, skin, 'ball-crumpled', variant, R, R, R * 2.15, (variant - 1) * 0.3);
    ctx.restore();
    if (!drawn) {
      ctx.save();
      ctx.translate(R - r, R - r);
      base(ctx, variant);
      ctx.restore();
    }
    strokePath(ctx, roughCirclePoints(R, R, R * 0.95, rng, 0.07), rng, skin.ink, 1.6, 0.9);
    return;
  }
  base(ctx, variant);
  if (style === 'fire') {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = FIRE_COLOR;
    ctx.fillRect(-4, -4, r * 2 + 8, r * 2 + 8);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    strokePath(ctx, roughCirclePoints(r, r, r * 1.12, rng, 0.08), rng, '#e8431f', 1.8);
    strokePath(ctx, roughCirclePoints(r, r, r * 1.3, rng, 0.12), rng, FIRE_COLOR, 1.1, 0.6);
  } else {
    ctx.setLineDash([2.5, 2.5]);
    strokePath(ctx, roughCirclePoints(r, r, r * 1.08, rng, 0.05), rng, skin.ink, 1.4);
    ctx.setLineDash([]);
  }
}

/** Paper-plane glyph pointing along +x, centred in a PLANE_SIZE square. */
export function renderPlane(ctx: CanvasRenderingContext2D, skin: Skin, variant: number): void {
  const rng = createRng(mixSeed(7, variant + 1, 70));
  const s = PLANE_SIZE;
  const c = s / 2;
  const wing: Pt[] = [
    { x: c + 13, y: c },
    { x: c - 12, y: c - 9 },
    { x: c - 7, y: c },
    { x: c - 12, y: c + 9 },
  ].map((p) => ({ x: p.x + rng.range(-0.5, 0.5), y: p.y + rng.range(-0.5, 0.5) }));
  tracePolygon(ctx, wing);
  ctx.fillStyle = '#fffdf3';
  ctx.globalAlpha = 0.95;
  ctx.fill();
  ctx.globalAlpha = 1;
  strokePath(ctx, [...wing, wing[0]], rng, skin.ink, 1.4);
  strokePath(ctx, [wing[0], wing[2]], rng, skin.ink, 1, 0.7);
}

// ---------------------------------------------------------------- brick extras

/** Dotted outline of a destroyed regenerating brick. */
export function renderGhostBrick(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, variant: number): void {
  const rng = createRng(mixSeed(Math.round(w), variant + 1, 80));
  ctx.setLineDash([1.5, 4]);
  strokeRoughRect(ctx, 0, 0, w, h, rng, skin.ink, 1.7);
  ctx.setLineDash([]);
}

export function renderEraser(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, variant: number): void {
  const rng = createRng(mixSeed(3, variant + 1, 81));
  const body = roughRoundRectPoints(0, 0, w, h, 8, rng, 0.8);
  tracePolygon(ctx, body);
  ctx.fillStyle = '#f2a6ad';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#5b8fd0';
  ctx.globalAlpha = 0.85;
  ctx.fillRect(w * 0.55, 0, w * 0.2, h);
  ctx.globalAlpha = 1;
  strokeSegs(ctx, hatchLines(0, 0, w * 0.55, h, 0.8, 5, rng), rng, '#d9787f', 1.1, 0.7);
  ctx.restore();
  strokePath(ctx, body, rng, skin.ink, 2);
}

/** Sticky-note strip across the playfield bottom: yellow, torn top edge, scribbled lines. */
export function renderNet(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, variant: number): void {
  const rng = createRng(mixSeed(11, variant + 1, 82));
  const top: Pt[] = [];
  for (let x = 0; x <= w; x += 12) top.push({ x, y: 2 + rng.range(-1.6, 1.6) });
  ctx.beginPath();
  ctx.moveTo(top[0].x, top[0].y);
  for (const p of top) ctx.lineTo(p.x, p.y);
  ctx.lineTo(w, h - 1 + rng.range(-1, 1));
  ctx.lineTo(0, h - 1 + rng.range(-1, 1));
  ctx.closePath();
  ctx.fillStyle = '#f9e46a';
  ctx.fill();
  ctx.save();
  ctx.clip();
  strokeSegs(ctx, hatchLines(0, 0, w, h, 0.05, 6, rng), rng, '#e3c63c', 1.2, 0.55);
  ctx.restore();
  strokePath(ctx, top, rng, skin.ink, 1.8);
  strokePath(ctx, [{ x: 0, y: top[0].y }, { x: 1, y: h - 1 }], rng, skin.ink, 1.4);
  strokePath(ctx, [{ x: w, y: top[top.length - 1].y }, { x: w - 1, y: h - 1 }], rng, skin.ink, 1.4);
  strokePath(ctx, [{ x: 0, y: h - 1 }, { x: w * 0.5, y: h - 0.2 }, { x: w, y: h - 1 }], rng, skin.ink, 1.2, 0.6);
}
