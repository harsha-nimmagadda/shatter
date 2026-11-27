import type { BrickType } from '../engine';
import { roundRect, heartPath } from './icons';
import { C, brickHue, font, rgba, shade } from './palette';

/** Sprite paddings (logical units) so baked glows are not clipped. */
export const BRICK_PAD = 9;
export const BALL_PAD = 12;
export const PADDLE_PAD = 16;
export const CAPSULE_SIZE = 36;
export const CAPSULE_PAD = 10;
export const HUD_ICON = 24;
export const HUD_PAD = 4;

const RADIUS = 5;

/** Deterministic tiny PRNG for sprite details (cracks etc.); only used while building sprites. */
function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Halo only (the shape itself is drawn off-canvas and only its shadow lands): used for live pulsing glows. */
export function renderHalo(g: CanvasRenderingContext2D, w: number, h: number, color: string, blur: number, px: number, round = RADIUS): void {
  const off = 4000;
  g.save();
  g.shadowColor = color;
  g.shadowBlur = blur * px;
  g.shadowOffsetX = off * px;
  roundRect(g, -off, 0, w, h, round);
  g.fillStyle = color;
  g.fill();
  g.restore();
}

/**
 * Brick body (content box 0..w x 0..h): a neon glass tile. Colour by type, HP pips for multi-hit bricks,
 * glass cracks once damaged, and a glyph for every special type so each kind reads at a glance.
 */
export function renderBrick(
  g: CanvasRenderingContext2D,
  type: BrickType,
  hp: number,
  maxHp: number,
  w: number,
  h: number,
  variant: number,
  px: number,
): void {
  if (type === 'steel') {
    renderSteel(g, w, h, px);
    return;
  }
  const hue = brickHue(type, maxHp);
  const holo = type === 'hidden';
  // Glow + body.
  g.save();
  g.shadowColor = hue;
  g.shadowBlur = 7 * px;
  roundRect(g, 0.5, 0.5, w - 1, h - 1, RADIUS);
  const body = g.createLinearGradient(0, 0, 0, h);
  if (holo) {
    body.addColorStop(0, '#5C2A8A');
    body.addColorStop(0.5, '#1E6C8C');
    body.addColorStop(1, '#7A1E5E');
  } else {
    body.addColorStop(0, shade(hue, -0.38));
    body.addColorStop(0.55, shade(hue, -0.62));
    body.addColorStop(1, shade(hue, -0.8));
  }
  g.fillStyle = body;
  g.fill();
  g.restore();
  if (holo) {
    // Iridescent diagonal bands.
    g.save();
    roundRect(g, 0.5, 0.5, w - 1, h - 1, RADIUS);
    g.clip();
    const bands = [C.cyan, C.pink, C.yellow, C.mint];
    g.globalAlpha = 0.28;
    for (let k = 0; k < 7; k++) {
      g.fillStyle = bands[k % bands.length];
      g.beginPath();
      const x0 = -h + k * 11;
      g.moveTo(x0, h);
      g.lineTo(x0 + h, 0);
      g.lineTo(x0 + h + 5, 0);
      g.lineTo(x0 + 5, h);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
  // Glass gloss on the top half.
  g.save();
  roundRect(g, 2.5, 2, w - 5, h * 0.42, RADIUS - 2);
  const gloss = g.createLinearGradient(0, 2, 0, h * 0.45);
  gloss.addColorStop(0, rgba('#FFFFFF', 0.34));
  gloss.addColorStop(1, rgba('#FFFFFF', 0.03));
  g.fillStyle = gloss;
  g.fill();
  g.restore();
  // Neon edge + thin inner white line.
  roundRect(g, 1, 1, w - 2, h - 2, RADIUS);
  g.lineWidth = 2;
  g.strokeStyle = holo ? C.white : hue;
  g.stroke();
  roundRect(g, 3, 3, w - 6, h - 6, RADIUS - 2);
  g.lineWidth = 0.7;
  g.strokeStyle = rgba('#FFFFFF', 0.35);
  g.stroke();

  // Type glyphs.
  g.save();
  g.translate(w / 2, h / 2);
  g.fillStyle = C.white;
  g.strokeStyle = C.white;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.shadowColor = hue;
  g.shadowBlur = 4 * px;
  if (type === 'explosive') glyphBomb(g);
  else if (type === 'moving') glyphArrows(g, w);
  else if (type === 'regen') glyphCycle(g);
  g.restore();

  // HP pips (remaining = filled) for multi-hit bricks.
  if (maxHp > 1) {
    const n = maxHp;
    const sp = 6;
    const x0 = w / 2 - ((n - 1) * sp) / 2;
    for (let k = 0; k < n; k++) {
      g.beginPath();
      g.arc(x0 + k * sp, h - 5.5, 1.8, 0, Math.PI * 2);
      if (k < hp) {
        g.fillStyle = C.white;
        g.fill();
      } else {
        g.lineWidth = 0.8;
        g.strokeStyle = rgba('#FFFFFF', 0.5);
        g.stroke();
      }
    }
  }
  // Glass cracks for lost HP.
  const lost = maxHp - hp;
  if (lost > 0 && type !== 'hidden') renderCracks(g, w, h, lost, variant);
}

function renderCracks(g: CanvasRenderingContext2D, w: number, h: number, lost: number, variant: number): void {
  const r = prng(0x9e37 + variant * 7919 + lost * 131);
  g.save();
  roundRect(g, 1, 1, w - 2, h - 2, RADIUS);
  g.clip();
  g.strokeStyle = rgba('#FFFFFF', 0.85);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let c = 0; c < lost; c++) {
    const ix = w * (0.25 + r() * 0.5);
    const iy = h * (0.3 + r() * 0.4);
    const arms = 4 + Math.floor(r() * 2);
    for (let a = 0; a < arms; a++) {
      const ang = (a / arms) * Math.PI * 2 + r() * 0.8;
      const len = 8 + r() * 16;
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(ix, iy);
      const mx = ix + Math.cos(ang) * len * 0.5 + (r() - 0.5) * 3;
      const my = iy + Math.sin(ang) * len * 0.5 + (r() - 0.5) * 3;
      g.lineTo(mx, my);
      g.lineTo(ix + Math.cos(ang) * len, iy + Math.sin(ang) * len);
      g.stroke();
    }
    g.fillStyle = rgba('#FFFFFF', 0.9);
    g.beginPath();
    g.arc(ix, iy, 1.4, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function glyphBomb(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.arc(-1, 1.5, 6.2, 0, Math.PI * 2);
  g.fillStyle = C.ink;
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = C.white;
  g.stroke();
  g.beginPath();
  g.moveTo(3.5, -3);
  g.quadraticCurveTo(6, -7, 9, -6);
  g.lineWidth = 1.4;
  g.stroke();
  // Spark.
  g.fillStyle = C.yellow;
  g.shadowColor = C.yellow;
  g.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const rr = k % 2 ? 1.2 : 3.2;
    const x = 9.5 + Math.cos(a) * rr;
    const y = -6.5 + Math.sin(a) * rr;
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.fillStyle = rgba('#FFFFFF', 0.8);
  g.beginPath();
  g.arc(-3, -1, 1.5, 0, Math.PI * 2);
  g.fill();
}

function glyphArrows(g: CanvasRenderingContext2D, w: number): void {
  g.lineWidth = 2;
  const ex = w / 2 - 8;
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(d * (ex - 4), -4.5);
    g.lineTo(d * ex, 0);
    g.lineTo(d * (ex - 4), 4.5);
    g.moveTo(d * (ex - 10), -4.5);
    g.lineTo(d * (ex - 6), 0);
    g.lineTo(d * (ex - 10), 4.5);
    g.stroke();
  }
}

function glyphCycle(g: CanvasRenderingContext2D): void {
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, 6, -Math.PI * 0.15, Math.PI * 1.35);
  g.stroke();
  const a = -Math.PI * 0.15;
  const tx = Math.cos(a) * 6;
  const ty = Math.sin(a) * 6;
  g.beginPath();
  g.moveTo(tx + 3.8, ty - 0.5);
  g.lineTo(tx - 1.2, ty - 3.8);
  g.lineTo(tx - 0.6, ty + 2.6);
  g.closePath();
  g.fill();
}

/** Indestructible chrome plate with rivets and a diagonal sheen. */
function renderSteel(g: CanvasRenderingContext2D, w: number, h: number, px: number): void {
  g.save();
  g.shadowColor = rgba('#C8D8FF', 0.6);
  g.shadowBlur = 5 * px;
  roundRect(g, 0.5, 0.5, w - 1, h - 1, 3);
  const body = g.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, '#F2F6FF');
  body.addColorStop(0.35, '#9AA6BC');
  body.addColorStop(0.5, '#5B6478');
  body.addColorStop(0.75, '#8F9AB0');
  body.addColorStop(1, '#3B4255');
  g.fillStyle = body;
  g.fill();
  g.restore();
  g.save();
  roundRect(g, 0.5, 0.5, w - 1, h - 1, 3);
  g.clip();
  g.fillStyle = rgba('#FFFFFF', 0.35);
  g.beginPath();
  g.moveTo(w * 0.55, 0);
  g.lineTo(w * 0.7, 0);
  g.lineTo(w * 0.5, h);
  g.lineTo(w * 0.35, h);
  g.closePath();
  g.fill();
  // Brushed lines.
  g.strokeStyle = rgba('#FFFFFF', 0.12);
  g.lineWidth = 0.5;
  for (let y = 3; y < h; y += 2.5) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.restore();
  roundRect(g, 1, 1, w - 2, h - 2, 3);
  g.lineWidth = 1.5;
  g.strokeStyle = '#2A3040';
  g.stroke();
  roundRect(g, 2, 2, w - 4, h - 4, 2);
  g.lineWidth = 0.6;
  g.strokeStyle = rgba('#FFFFFF', 0.6);
  g.stroke();
  for (const [x, y] of [[5, 5], [w - 5, 5], [5, h - 5], [w - 5, h - 5]]) {
    g.beginPath();
    g.arc(x, y, 1.7, 0, Math.PI * 2);
    g.fillStyle = '#2A3040';
    g.fill();
    g.beginPath();
    g.arc(x - 0.4, y - 0.4, 0.7, 0, Math.PI * 2);
    g.fillStyle = '#FFFFFF';
    g.fill();
  }
}

/** Unrevealed phantom brick: faint dashed outline (the renderer flickers its alpha). */
export function renderPhantom(g: CanvasRenderingContext2D, w: number, h: number, px: number): void {
  g.save();
  g.shadowColor = C.white;
  g.shadowBlur = 4 * px;
  roundRect(g, 1.5, 1.5, w - 3, h - 3, RADIUS);
  g.setLineDash([3, 3]);
  g.lineWidth = 1.2;
  g.strokeStyle = C.white;
  g.stroke();
  g.restore();
  g.fillStyle = rgba('#FFFFFF', 0.6);
  g.font = font(12, false);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('?', w / 2, h / 2 + 0.5);
}

/** Outline used while a regenerating brick re-forms. */
export function renderGhost(g: CanvasRenderingContext2D, w: number, h: number, px: number): void {
  g.save();
  g.shadowColor = C.mint;
  g.shadowBlur = 5 * px;
  roundRect(g, 1, 1, w - 2, h - 2, RADIUS);
  g.setLineDash([4, 4]);
  g.lineWidth = 1.4;
  g.strokeStyle = C.mint;
  g.stroke();
  g.restore();
}

/** Ball: white-hot core with a coloured rim and glow (content box 0..2r). */
export function renderBall(g: CanvasRenderingContext2D, r: number, color: string, px: number, meteor: boolean): void {
  g.save();
  g.translate(r, r);
  g.shadowColor = color;
  g.shadowBlur = (meteor ? 16 : 11) * px;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  const core = g.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
  if (meteor) {
    core.addColorStop(0, '#FFFFFF');
    core.addColorStop(0.35, C.yellow);
    core.addColorStop(0.75, C.orange);
    core.addColorStop(1, '#C0200A');
  } else {
    core.addColorStop(0, '#FFFFFF');
    core.addColorStop(0.55, '#FFFFFF');
    core.addColorStop(1, color);
  }
  g.fillStyle = core;
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 1.2;
  g.strokeStyle = shade(color, 0.3);
  g.stroke();
  g.restore();
}

/** Soft additive dot used for trails and sparkles (content box 0..2r). */
export function renderGlowDot(g: CanvasRenderingContext2D, r: number, color: string): void {
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, rgba('#FFFFFF', 0.95));
  grd.addColorStop(0.25, rgba(color, 0.9));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, r * 2, r * 2);
}

export type PaddleStyle = 'normal' | 'wide';

/**
 * Hover-bar paddle (content box 0..w x 0..h): dark glass capsule, neon top edge, glowing end caps and an
 * under-glow. WIDE turns it green with ruler ticks.
 */
export function renderPaddle(g: CanvasRenderingContext2D, w: number, h: number, style: PaddleStyle, px: number): void {
  const edge = style === 'wide' ? C.green : C.cyan;
  const cap = style === 'wide' ? C.mint : C.pink;
  const r = h / 2;
  g.save();
  g.shadowColor = edge;
  g.shadowBlur = 12 * px;
  roundRect(g, 0, 0, w, h, r);
  const body = g.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, shade(edge, -0.25));
  body.addColorStop(0.3, '#1A1440');
  body.addColorStop(1, '#0A0620');
  g.fillStyle = body;
  g.fill();
  g.restore();
  // Caps.
  for (const x of [0, w - h * 1.3]) {
    g.save();
    roundRect(g, 0, 0, w, h, r);
    g.clip();
    const cg = g.createLinearGradient(0, 0, 0, h);
    cg.addColorStop(0, shade(cap, 0.5));
    cg.addColorStop(0.5, cap);
    cg.addColorStop(1, shade(cap, -0.5));
    g.fillStyle = cg;
    g.fillRect(x, 0, h * 1.3, h);
    g.restore();
  }
  // Centre light strip.
  g.save();
  g.shadowColor = edge;
  g.shadowBlur = 6 * px;
  roundRect(g, h * 1.6, h * 0.42, w - h * 3.2, h * 0.22, h * 0.11);
  g.fillStyle = shade(edge, 0.55);
  g.fill();
  g.restore();
  if (style === 'wide') {
    g.strokeStyle = rgba('#FFFFFF', 0.7);
    g.lineWidth = 1;
    g.beginPath();
    for (let x = h * 1.5; x < w - h * 1.4; x += 8) {
      const big = Math.round((x - h * 1.5) / 8) % 4 === 0;
      g.moveTo(x, 2);
      g.lineTo(x, big ? 6 : 4);
    }
    g.stroke();
  }
  // Top highlight edge.
  roundRect(g, 0.75, 0.75, w - 1.5, h - 1.5, r);
  g.lineWidth = 1.5;
  g.strokeStyle = edge;
  g.stroke();
  g.beginPath();
  g.moveTo(r, 2.2);
  g.lineTo(w - r, 2.2);
  g.lineWidth = 1;
  g.strokeStyle = rgba('#FFFFFF', 0.75);
  g.stroke();
}

export type OverlayKind = 'sticky' | 'lasers';

/** Power overlays on the paddle (content box 0..w x 0..h). */
export function renderPaddleOverlay(g: CanvasRenderingContext2D, kind: OverlayKind, w: number, h: number, px: number): void {
  if (kind === 'sticky') {
    // Green goo along the top with drips.
    g.save();
    g.shadowColor = C.green;
    g.shadowBlur = 6 * px;
    g.fillStyle = rgba(C.green, 0.85);
    g.beginPath();
    g.moveTo(h * 0.6, 1);
    const n = Math.max(3, Math.floor(w / 18));
    for (let k = 0; k <= n; k++) {
      const x = h * 0.6 + ((w - h * 1.2) * k) / n;
      g.lineTo(x, k % 2 ? -1.5 : 0.5);
    }
    g.lineTo(w - h * 0.6, 4);
    g.lineTo(h * 0.6, 4);
    g.closePath();
    g.fill();
    for (let k = 1; k < n; k += 2) {
      const x = h * 0.6 + ((w - h * 1.2) * k) / n;
      g.beginPath();
      g.ellipse(x, 6 + (k % 3), 1.8, 3 + (k % 3), 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  } else {
    // Laser turrets on both ends.
    for (const cx of [h * 0.65, w - h * 0.65]) {
      g.save();
      g.shadowColor = C.red;
      g.shadowBlur = 6 * px;
      roundRect(g, cx - 4, -9, 8, 11, 2);
      g.fillStyle = '#2A2F45';
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = C.red;
      g.stroke();
      g.fillStyle = C.red;
      g.fillRect(cx - 2, -12, 4, 4);
      g.restore();
    }
  }
}

/** Shield barrier across the bottom (content box 0..w x 0..h): a hex-patterned energy line. */
export function renderShield(g: CanvasRenderingContext2D, w: number, h: number, px: number): void {
  const mid = h / 2;
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, rgba(C.cyan, 0));
  grd.addColorStop(0.5, rgba(C.cyan, 0.35));
  grd.addColorStop(1, rgba(C.cyan, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = rgba(C.cyan, 0.55);
  g.lineWidth = 0.8;
  const s = 7;
  g.beginPath();
  for (let x = 0; x < w + s * 2; x += s * 1.5) {
    for (let row = 0; row < 2; row++) {
      const cx = x + (row ? s * 0.75 : 0);
      const cy = mid + (row ? s * 0.45 : -s * 0.45);
      for (let k = 0; k <= 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const px2 = cx + Math.cos(a) * s * 0.5;
        const py2 = cy + Math.sin(a) * s * 0.5;
        if (k === 0) g.moveTo(px2, py2);
        else g.lineTo(px2, py2);
      }
    }
  }
  g.stroke();
  g.save();
  g.shadowColor = C.cyan;
  g.shadowBlur = 8 * px;
  g.strokeStyle = shade(C.cyan, 0.5);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, mid);
  g.lineTo(w, mid);
  g.stroke();
  g.restore();
}

/** Neon heart (content box 0..s). */
export function renderHeart(g: CanvasRenderingContext2D, s: number, px: number, empty = false): void {
  g.save();
  g.shadowColor = C.pink;
  g.shadowBlur = empty ? 0 : 7 * px;
  heartPath(g, s / 2, s / 2 + s * 0.04, s * 0.48);
  if (empty) {
    g.lineWidth = 1.4;
    g.strokeStyle = rgba(C.pink, 0.35);
    g.stroke();
  } else {
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, '#FF8BE0');
    grd.addColorStop(1, '#E0157A');
    g.fillStyle = grd;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 1.2;
    g.strokeStyle = '#FFD3F3';
    g.stroke();
  }
  g.restore();
}

/**
 * Centre-screen neon sign: big title + optional subtitle (content box 0..w x 0..h).
 * `color` is the title glow; text is white-hot with a coloured stroke.
 */
export function renderSign(g: CanvasRenderingContext2D, title: string, sub: string, w: number, h: number, px: number, color: string, titlePx: number): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const ty = sub ? h * 0.36 : h / 2;
  g.font = font(titlePx);
  g.lineJoin = 'round';
  g.save();
  g.shadowColor = color;
  g.shadowBlur = 18 * px;
  g.lineWidth = 6;
  g.strokeStyle = color;
  g.strokeText(title, w / 2, ty);
  g.restore();
  const grd = g.createLinearGradient(0, ty - titlePx / 2, 0, ty + titlePx / 2);
  grd.addColorStop(0, '#FFFFFF');
  grd.addColorStop(0.6, shade(color, 0.75));
  grd.addColorStop(1, shade(color, 0.35));
  g.fillStyle = grd;
  g.fillText(title, w / 2, ty);
  if (sub) {
    g.font = font(Math.round(titlePx * 0.42), false);
    g.save();
    g.shadowColor = C.cyan;
    g.shadowBlur = 8 * px;
    g.fillStyle = C.white;
    g.fillText(sub, w / 2, h * 0.8);
    g.restore();
  }
}
