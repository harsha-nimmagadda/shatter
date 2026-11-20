import { createRng } from '../engine/rng';
import type { BrickType } from '../engine/state';
import {
  crackPaths,
  hatchLines,
  mixSeed,
  roughCirclePoints,
  roughPolygon,
  roughRoundRectPoints,
  scribblePoints,
  strokePath,
  strokeRoughRect,
  strokeSegs,
  tracePolygon,
  wobblyLinePoints,
  type Pt,
} from './sketch';
import { pickIndex, textureWindow } from './artLayout';
import { sourceSize } from './assets';
import type { Skin } from './skin';

export const BRICK_PAD = 5;
export const PADDLE_PAD = 6;
export const BALL_PAD = 4;
export const MSG_PAD = 8;

export interface BrickSpec {
  seed: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  kind: 'normal' | 'steel';
  /** Full brick type; when absent the coarse kind decides. */
  type?: BrickType;
}

export const EXPLOSIVE_FILL = '#e8602c';

export function brickColor(skin: Skin, kind: 'normal' | 'steel' | BrickType, hp: number): string {
  if (kind === 'steel') return skin.steel;
  if (kind === 'explosive') return EXPLOSIVE_FILL;
  return skin.brick[hp >= 3 ? 3 : hp <= 1 ? 1 : 2];
}

/**
 * Fills the polygon with a seeded window of a generated fill swatch: paper colour first (the sprite is
 * opaque), then the swatch with 'multiply' so its white disappears. Only runs while building cached sprites.
 */
function fillArt(ctx: CanvasRenderingContext2D, skin: Skin, id: string, seed: number, w: number, h: number, poly: Pt[]): boolean {
  const imgs = skin.assets?.get(id) ?? [];
  if (!imgs.length) return false;
  const img = imgs[pickIndex(seed, imgs.length)];
  const size = sourceSize(img);
  if (size.w < 8 || size.h < 8) return false;
  const win = textureWindow(seed, size.w, size.h, 140, 70);
  const k = (w + 4) / 140;
  ctx.save();
  tracePolygon(ctx, poly);
  ctx.clip();
  ctx.fillStyle = skin.paper;
  ctx.fillRect(-2, -2, w + 4, h + 4);
  ctx.globalCompositeOperation = 'multiply';
  ctx.translate(w / 2, h / 2);
  ctx.rotate((win.rot * Math.PI) / 2);
  ctx.drawImage(img, win.sx, win.sy, win.sw, win.sh, (-win.sw * k) / 2, (-win.sh * k) / 2, win.sw * k, win.sh * k);
  ctx.restore();
  return true;
}

function smiley(ctx: CanvasRenderingContext2D, skin: Skin, cx: number, cy: number, r: number, rng: ReturnType<typeof createRng>): void {
  strokePath(ctx, roughCirclePoints(cx, cy, r, rng, 0.06), rng, skin.ink, 1.1, 0.8);
  ctx.fillStyle = skin.ink;
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.25, 0.7, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.35, cy - r * 0.25, 0.7, 0, Math.PI * 2);
  ctx.fill();
  strokePath(
    ctx,
    [
      { x: cx - r * 0.45, y: cy + r * 0.2 },
      { x: cx, y: cy + r * 0.6 },
      { x: cx + r * 0.45, y: cy + r * 0.2 },
    ],
    rng,
    skin.ink,
    1,
    0.8,
  );
}

export const HIGHLIGHT_GREEN = '#39FF14';
const TAB_COLORS = ['#e8d27a', '#f2b9b0', '#a9d6c2'];

/** Faint crease / watermark of an unrevealed Invisible Ink brick (the caller draws it at low alpha). */
export function renderHiddenCrease(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, variant: number, seed: number): void {
  const rng = createRng(mixSeed(seed, variant + 1, 4));
  ctx.setLineDash([5, 4]);
  strokeRoughRect(ctx, 1, 1, w - 2, h - 2, rng, skin.graphite, 1.3);
  ctx.setLineDash([]);
  // A fold crease and a tiny "?" watermark.
  strokePath(ctx, [{ x: w * 0.12, y: h * 0.78 }, { x: w * 0.5, y: h * 0.5 }, { x: w * 0.88, y: h * 0.62 }], rng, skin.graphite, 1.1, 0.8);
  ctx.font = `${Math.round(h * 0.6)}px ${skin.font}`;
  ctx.fillStyle = skin.graphite;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.7;
  ctx.fillText('?', w * 0.5, h * 0.54);
  ctx.globalAlpha = 1;
}

/** Progressive crack and tear marks: the more hp lost, the more lines (plus a paper-coloured tear edge). */
function damageMarks(ctx: CanvasRenderingContext2D, skin: Skin, b: BrickSpec, w: number, h: number, dark: boolean): void {
  const lost = b.maxHp - b.hp;
  if (lost <= 0) return;
  const cr = createRng(mixSeed(b.seed, 0, 3));
  const ink = dark ? skin.paper : skin.ink;
  for (const c of crackPaths(2, 2, w - 4, h - 4, cr, lost)) {
    strokePath(ctx, c, cr, ink, 1.4);
    if (!dark) strokePath(ctx, c.map((p) => ({ x: p.x + 1.2, y: p.y + 0.8 })), cr, skin.paper, 1, 0.55);
  }
}

/** One boil variant of a brick. Identity (hatch angle, doodle, cracks) comes from the seed only. */
export function renderBrick(ctx: CanvasRenderingContext2D, skin: Skin, b: BrickSpec, variant: number): void {
  const id = createRng(mixSeed(b.seed, 0, 1));
  const rng = createRng(mixSeed(b.seed, variant + 1, 2));
  const steel = b.kind === 'steel';
  const type: BrickType = b.type ?? b.kind;
  const { w, h } = b;
  if (steel) {
    renderClip(ctx, skin, w, h, rng);
    return;
  }
  // Ink tier by max hp: pencil graphite, ballpoint blue, black marker.
  const tier = b.maxHp >= 3 ? 3 : b.maxHp <= 1 ? 1 : 2;
  const color = skin.brick[tier];
  const poly = roughPolygon(1, 1, w - 2, h - 2, rng, 1);

  if (type === 'explosive') {
    if (!fillArt(ctx, skin, 'fill-brick3', b.seed, w, h, poly)) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = EXPLOSIVE_FILL;
      tracePolygon(ctx, poly);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = EXPLOSIVE_FILL;
    tracePolygon(ctx, poly);
    ctx.fill();
    ctx.globalAlpha = 1;
    strokeRoughRect(ctx, 0, 0, w, h, rng, skin.ink, 1.9);
    if (b.hp < b.maxHp) damageMarks(ctx, skin, b, w, h, false);
    bombDoodle(ctx, skin, w, h, rng);
    return;
  }

  // Revealed Invisible Ink: bright highlighter-green fill.
  if (type === 'hidden') {
    tracePolygon(ctx, poly);
    ctx.fillStyle = HIGHLIGHT_GREEN;
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.save();
    tracePolygon(ctx, poly);
    ctx.clip();
    strokeSegs(ctx, hatchLines(2, 2, w - 4, h - 4, 0.9, 5, rng), rng, '#1f9d0a', 1.2, 0.5);
    ctx.restore();
    strokeRoughRect(ctx, 0, 0, w, h, rng, skin.ink, 1.7);
    return;
  }

  // Fill: pencil = light wash, pen = pale blue + diagonal hatching, marker = solid black.
  ctx.save();
  tracePolygon(ctx, poly);
  ctx.clip();
  if (type === 'moving') {
    ctx.fillStyle = TAB_COLORS[(b.seed >>> 0) % TAB_COLORS.length];
    ctx.fillRect(0, 0, w, h);
  } else if (tier === 3) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    strokeSegs(ctx, hatchLines(2, 2, w - 4, h - 4, -0.8, 5, rng), rng, '#4a4a52', 1.1, 0.7);
  } else if (tier === 2) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    strokeSegs(ctx, hatchLines(2, 2, w - 4, h - 4, 0.75, 3.6, rng), rng, color, 1.5, 0.85);
  } else {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    if (id.next() < 0.3) strokePath(ctx, scribblePoints(2, 2, w - 4, h - 4, rng, 5.5), rng, color, 1.1, 0.7);
    else strokeSegs(ctx, hatchLines(2, 2, w - 4, h - 4, id.range(0.5, 1.1), 6, rng), rng, color, 1.1, 0.6);
  }
  ctx.restore();

  if (type === 'regen') ctx.setLineDash([6, 3.5]);
  strokeRoughRect(ctx, 0, 0, w, h, rng, color, tier === 3 ? 3.2 : tier === 2 ? 2.2 : 1.8);
  if (type === 'regen') ctx.setLineDash([]);

  if (type === 'moving') {
    // Paper index-tab: coloured tab strip on the right edge with a notch.
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(w - 7, 2, 5, h - 4);
    ctx.globalAlpha = 1;
    strokePath(ctx, [{ x: w - 8, y: 2 }, { x: w - 8, y: h - 2 }], rng, skin.ink, 1.1, 0.8);
  }
  damageMarks(ctx, skin, b, w, h, tier === 3);
  if (b.hp === b.maxHp && b.maxHp === 1 && type === 'normal' && id.next() < 0.2) {
    smiley(ctx, skin, w * id.range(0.3, 0.7), h / 2, h * 0.2, rng);
  }
  if (type === 'moving') moveDoodle(ctx, skin, w - 8, h, rng);
  else if (type === 'regen') regenDoodle(ctx, skin, w, h, rng);
}

/** Metal clip: silver bar with a drop shadow and two pin heads. */
function renderClip(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, rng: ReturnType<typeof createRng>): void {
  const body = roughPolygon(1, 1, w - 3, h - 3, rng, 0.6);
  // Drop shadow.
  ctx.save();
  ctx.translate(2.2, 2.6);
  tracePolygon(ctx, body);
  ctx.fillStyle = '#000';
  ctx.globalAlpha = 0.22;
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
  tracePolygon(ctx, body);
  ctx.fillStyle = skin.steel;
  ctx.fill();
  ctx.save();
  tracePolygon(ctx, body);
  ctx.clip();
  // Brushed highlight and a darker lower edge.
  strokeSegs(ctx, [{ x1: 3, y1: h * 0.3, x2: w - 3, y2: h * 0.3 }], rng, '#d8dce2', 1.6, 0.9);
  strokeSegs(ctx, [{ x1: 3, y1: h * 0.78, x2: w - 3, y2: h * 0.78 }], rng, '#6e747d', 1.2, 0.6);
  ctx.restore();
  strokeRoughRect(ctx, 0, 0, w - 1, h - 1, rng, skin.ink, 1.5);
  for (const px of [6, w - 7]) {
    ctx.beginPath();
    ctx.arc(px, h / 2, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#5b6068';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px - 0.6, h / 2 - 0.6, 0.9, 0, Math.PI * 2);
    ctx.fillStyle = '#d8dce2';
    ctx.fill();
    strokePath(ctx, roughCirclePoints(px, h / 2, 2.6, rng, 0.05), rng, skin.ink, 1);
  }
}

function bombDoodle(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, rng: ReturnType<typeof createRng>): void {
  const cx = w / 2 - 2;
  const cy = h / 2 + 2;
  const r = h * 0.24;
  const body = roughCirclePoints(cx, cy, r, rng, 0.05);
  tracePolygon(ctx, body);
  ctx.fillStyle = skin.ink;
  ctx.globalAlpha = 0.88;
  ctx.fill();
  ctx.globalAlpha = 1;
  // Fuse and sparks.
  const fx = cx + r * 0.7;
  const fy = cy - r * 0.8;
  strokePath(ctx, [{ x: fx, y: fy }, { x: fx + 2.5, y: fy - 3 }, { x: fx + 1.5, y: fy - 5.5 }], rng, skin.ink, 1.4);
  const sx = fx + 1.5;
  const sy = fy - 5.5;
  const sparks = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.7;
    sparks.push({ x1: sx + Math.cos(a) * 1.5, y1: sy + Math.sin(a) * 1.5, x2: sx + Math.cos(a) * 4.2, y2: sy + Math.sin(a) * 4.2 });
  }
  strokeSegs(ctx, sparks, rng, '#ffd23f', 1.3);
  // "!" and a few spark ticks near the ends of the brick.
  ctx.font = `${Math.round(h * 0.7)}px ${skin.font}`;
  ctx.fillStyle = skin.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', w * 0.8, h * 0.55);
  strokeSegs(
    ctx,
    [
      { x1: 4, y1: 5, x2: 8, y2: 8 },
      { x1: 3, y1: 10, x2: 8, y2: 10.5 },
      { x1: w - 4, y1: h - 5, x2: w - 8, y2: h - 8 },
    ],
    rng,
    '#ffd23f',
    1.2,
  );
}

function moveDoodle(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, rng: ReturnType<typeof createRng>): void {
  const y = h / 2;
  strokePath(ctx, [{ x: w * 0.28, y }, { x: w * 0.5, y: y + 0.6 }, { x: w * 0.72, y }], rng, skin.ink, 1.4, 0.8);
  for (const sgn of [-1, 1]) {
    const x = w / 2 + sgn * w * 0.22;
    strokePath(ctx, [{ x: x - sgn * 3.5, y: y - 3.2 }, { x, y }, { x: x - sgn * 3.5, y: y + 3.2 }], rng, skin.ink, 1.4, 0.8);
  }
}

function regenDoodle(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, rng: ReturnType<typeof createRng>): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = h * 0.24;
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + 0.5 + (i / 10) * (Math.PI * 1.55);
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  strokePath(ctx, pts, rng, skin.ink, 1.5, 0.85);
  const e = pts[pts.length - 1];
  strokePath(ctx, [{ x: e.x - 1, y: e.y - 4 }, { x: e.x, y: e.y }, { x: e.x + 4, y: e.y - 1.5 }], rng, skin.ink, 1.5, 0.85);
}

export type PaddleStyle = 'pencil' | 'ruler';

export const PADDLE_JITTER = 0.35;

/** Default paddle: a yellow pencil (sharpened tip on the right, pink eraser on the left). Ruler style = the ruler art. */
export function renderPaddle(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, variant: number, style: PaddleStyle = 'pencil'): void {
  const rng = createRng(mixSeed(w, variant + 1, style === 'ruler' ? 11 : 12));
  const outline = roughRoundRectPoints(0, 0, w, h, h * 0.45, rng, PADDLE_JITTER);
  if (style === 'pencil') {
    renderPencil(ctx, skin, w, h, rng, outline);
    return;
  }
  const rulers = skin.assets?.get('paddle') ?? [];
  const ruler = rulers.length ? rulers[pickIndex(w, rulers.length)] : undefined;
  if (ruler && sourceSize(ruler).w > 8) {
    ctx.save();
    tracePolygon(ctx, outline);
    ctx.clip();
    // Warm wood base so the small ruler reads clearly against the paper.
    ctx.fillStyle = '#e9c27a';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(ruler, -1, -1, w + 2, h + 2);
    ctx.restore();
    strokePath(ctx, outline, rng, skin.ink, 2.2);
    return;
  }
  ctx.save();
  tracePolygon(ctx, outline);
  ctx.clip();
  ctx.fillStyle = '#ecd08a';
  ctx.fillRect(0, 0, w, h);
  strokeSegs(ctx, hatchLines(0, 0, w, h, 0.7, 4.5, rng), rng, skin.ink, 0.8, 0.25);
  ctx.restore();
  strokePath(ctx, outline, rng, skin.ink, 2.2);
}

function renderPencil(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, rng: ReturnType<typeof createRng>, outline: Pt[]): void {
  const pencils = skin.assets?.get('paddle-pencil') ?? [];
  const art = pencils.length ? pencils[0] : undefined;
  ctx.save();
  tracePolygon(ctx, outline);
  ctx.clip();
  if (art && sourceSize(art).w > 8) {
    ctx.fillStyle = '#f2cf4a';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(art, -1, -1, w + 2, h + 2);
    ctx.restore();
    strokePath(ctx, outline, rng, skin.ink, 2);
    return;
  }
  const tipW = Math.min(18, w * 0.22);
  const eraW = Math.min(11, w * 0.14);
  const ferW = 4;
  const bodyX0 = eraW + ferW;
  const bodyX1 = w - tipW;
  ctx.fillStyle = '#f5cf3d';
  ctx.fillRect(bodyX0, 0, bodyX1 - bodyX0, h);
  // Darker stripe along the lower half plus a highlight line on top.
  ctx.fillStyle = '#d9a91f';
  ctx.fillRect(bodyX0, h * 0.62, bodyX1 - bodyX0, h * 0.38);
  strokeSegs(ctx, [{ x1: bodyX0, y1: h * 0.28, x2: bodyX1, y2: h * 0.28 }], rng, '#fff3a6', 1.5, 0.9);
  // Wood cone and graphite point.
  ctx.beginPath();
  ctx.moveTo(bodyX1, 0);
  ctx.lineTo(w, h / 2);
  ctx.lineTo(bodyX1, h);
  ctx.closePath();
  ctx.fillStyle = '#efcf9a';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w - tipW * 0.38, h * 0.3);
  ctx.lineTo(w, h / 2);
  ctx.lineTo(w - tipW * 0.38, h * 0.7);
  ctx.closePath();
  ctx.fillStyle = skin.graphite;
  ctx.fill();
  // Ferrule and eraser.
  ctx.fillStyle = '#b4b9c1';
  ctx.fillRect(eraW, 0, ferW, h);
  ctx.fillStyle = '#f2a0a8';
  ctx.fillRect(0, 0, eraW, h);
  ctx.restore();
  strokePath(ctx, outline, rng, skin.ink, 2);
  strokePath(ctx, [{ x: bodyX1, y: 1 }, { x: bodyX1 + 1, y: h / 2 }, { x: bodyX1, y: h - 1 }], rng, skin.ink, 1.2, 0.7);
  strokePath(ctx, [{ x: eraW, y: 1 }, { x: eraW, y: h - 1 }], rng, skin.ink, 1, 0.7);
  strokePath(ctx, [{ x: eraW + ferW, y: 1 }, { x: eraW + ferW, y: h - 1 }], rng, skin.ink, 1, 0.7);
}

/** Scribbled graphite ball; content box is 2r x 2r. */
export function renderBall(ctx: CanvasRenderingContext2D, skin: Skin, r: number, variant: number): void {
  const rng = createRng(mixSeed(Math.round(r * 10), variant + 1, 21));
  const d = r * 2;
  const balls = skin.assets?.get('ball-graphite') ?? [];
  if (balls.length && sourceSize(balls[0]).w > 8) {
    // Same doodle for a given radius, nudged per boil variant so it still wobbles.
    const img = balls[pickIndex(Math.round(r * 10), balls.length)];
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r * 0.98, 0, Math.PI * 2);
    ctx.clip();
    // Mid-grey graphite base: the doodle alone shrinks to a faint grey at ball size.
    ctx.fillStyle = '#8a8a8a';
    ctx.fillRect(0, 0, d, d);
    ctx.globalCompositeOperation = 'multiply';
    ctx.translate(r + rng.range(-0.4, 0.4), r + rng.range(-0.4, 0.4));
    ctx.rotate((variant - 1) * 0.35 + rng.range(-0.08, 0.08));
    const bs = d * 1.08;
    ctx.drawImage(img, -bs / 2, -bs / 2, bs, bs);
    ctx.drawImage(img, -bs / 2, -bs / 2, bs, bs);
    ctx.restore();
    strokePath(ctx, roughCirclePoints(r, r, r * 0.95, rng, 0.02), rng, skin.ink, 1.6, 0.9);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r * 0.95, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = skin.ball;
  ctx.fillRect(0, 0, d, d);
  ctx.globalAlpha = 1;
  strokePath(ctx, scribblePoints(0, 0, d, d, rng, 2.4), rng, skin.ball, 1.5);
  strokeSegs(ctx, hatchLines(0, 0, d, d, 0.9, 2.6, rng), rng, skin.graphite, 1.1, 0.8);
  ctx.restore();
  strokePath(ctx, roughCirclePoints(r, r, r * 0.95, rng, 0.02), rng, skin.ink, 1.7);
  strokePath(ctx, roughCirclePoints(r, r, r * 0.9, rng, 0.03), rng, skin.ink, 1.1, 0.6);
}

/** Message text with a hand-drawn underline; content box is w x h. */
export function renderMessage(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  text: string,
  w: number,
  h: number,
  px: number,
  variant: number,
): void {
  const rng = createRng(mixSeed(text.length, variant + 1, 31));
  ctx.font = `${px}px ${skin.font}`;
  ctx.fillStyle = skin.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h * 0.42);
  strokePath(ctx, wobblyLinePoints(0, h - 4, w, h - 5, rng, { jitter: 0.01, maxJitter: 2.5, segLen: 30 }), rng, skin.ink, 2.4);
  strokePath(ctx, wobblyLinePoints(w * 0.08, h - 1, w * 0.92, h - 2, rng, { jitter: 0.01, maxJitter: 2.5, segLen: 30 }), rng, skin.ink, 1.6, 0.7);
}
