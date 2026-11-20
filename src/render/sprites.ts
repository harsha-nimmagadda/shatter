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
import { texturePattern, type Skin, type TextureKey } from './skin';

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

function brickFillId(kind: 'normal' | 'steel', hp: number): string {
  if (kind === 'steel') return 'fill-steel';
  return hp >= 3 ? 'fill-brick3' : hp <= 1 ? 'fill-brick1' : 'fill-brick2';
}

function brickTexture(kind: 'normal' | 'steel', hp: number): TextureKey {
  if (kind === 'steel') return 'steel';
  return hp >= 3 ? 'brick3' : hp <= 1 ? 'brick1' : 'brick2';
}

/** Fills the polygon with the skin texture if there is one; returns whether it did. */
function fillTextured(ctx: CanvasRenderingContext2D, skin: Skin, key: TextureKey, poly: Pt[]): boolean {
  const pat = texturePattern(ctx, skin, key);
  if (!pat) return false;
  ctx.save();
  tracePolygon(ctx, poly);
  ctx.clip();
  ctx.fillStyle = pat;
  const b = poly.reduce(
    (m, p) => ({ x0: Math.min(m.x0, p.x), y0: Math.min(m.y0, p.y), x1: Math.max(m.x1, p.x), y1: Math.max(m.y1, p.y) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  ctx.restore();
  return true;
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

/** One boil variant of a brick. Identity (hatch angle, doodle, cracks) comes from the seed only. */
export function renderBrick(ctx: CanvasRenderingContext2D, skin: Skin, b: BrickSpec, variant: number): void {
  const id = createRng(mixSeed(b.seed, 0, 1));
  const rng = createRng(mixSeed(b.seed, variant + 1, 2));
  const steel = b.kind === 'steel';
  const type: BrickType = b.type ?? b.kind;
  const color = brickColor(skin, type, b.hp);
  const { w, h } = b;

  const poly = roughPolygon(1, 1, w - 2, h - 2, rng, 1);
  if (!fillArt(ctx, skin, type === 'explosive' ? 'fill-brick3' : brickFillId(b.kind, b.hp), b.seed, w, h, poly) && !fillTextured(ctx, skin, brickTexture(b.kind, b.hp), poly)) {
    ctx.globalAlpha = steel ? 0.5 : 0.3;
    ctx.fillStyle = color;
    tracePolygon(ctx, poly);
    ctx.fill();
    ctx.globalAlpha = 1;
    const sign = id.next() < 0.5 ? 1 : -1;
    const angle = sign * id.range(0.5, 1.15);
    const gap = id.range(3.2, 4.6) * (steel ? 0.8 : 1);
    if (id.next() < 0.3 && !steel) {
      strokePath(ctx, scribblePoints(2, 2, w - 4, h - 4, rng, gap + 1), rng, color, 1.6);
    } else {
      strokeSegs(ctx, hatchLines(2, 2, w - 4, h - 4, angle, gap, rng), rng, color, steel ? 1.5 : 1.7);
    }
    if (steel) strokeSegs(ctx, hatchLines(2, 2, w - 4, h - 4, -angle, gap * 1.6, rng), rng, skin.ink, 1.1, 0.7);
  }

  if (type === 'explosive') {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = EXPLOSIVE_FILL;
    tracePolygon(ctx, poly);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Regenerating bricks get a dashed outline.
  if (type === 'regen') ctx.setLineDash([6, 3.5]);
  strokeRoughRect(ctx, 0, 0, w, h, rng, skin.ink, 1.9);
  if (type === 'regen') ctx.setLineDash([]);

  if (steel) {
    // Rivets.
    ctx.fillStyle = skin.ink;
    for (const rx of [5, w - 5]) {
      ctx.beginPath();
      ctx.arc(rx, h / 2, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  if (b.hp < b.maxHp) {
    const cr = createRng(mixSeed(b.seed, 0, 3));
    for (const c of crackPaths(2, 2, w - 4, h - 4, cr, b.maxHp - b.hp)) strokePath(ctx, c, cr, skin.ink, 1.3);
  } else if (b.maxHp === 1 && type === 'normal' && id.next() < 0.2) {
    smiley(ctx, skin, w * id.range(0.3, 0.7), h / 2, h * 0.2, rng);
  }
  if (type === 'explosive') bombDoodle(ctx, skin, w, h, rng);
  else if (type === 'moving') moveDoodle(ctx, skin, w, h, rng);
  else if (type === 'regen') regenDoodle(ctx, skin, w, h, rng);
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

export function renderPaddle(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, variant: number): void {
  const rng = createRng(mixSeed(w, variant + 1, 11));
  const outline = roughRoundRectPoints(0, 0, w, h, h * 0.45, rng, 0.8);
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
  if (!fillTextured(ctx, skin, 'paddle', outline)) {
    ctx.save();
    tracePolygon(ctx, outline);
    ctx.clip();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = skin.paddle;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    strokeSegs(ctx, hatchLines(0, 0, w, h, -0.8, 3, rng), rng, skin.paddle, 1.8);
    strokeSegs(ctx, hatchLines(0, 0, w, h, 0.7, 4.5, rng), rng, skin.ink, 1.2, 0.6);
    ctx.restore();
  }
  strokePath(ctx, outline, rng, skin.ink, 2.2);
  const second = roughRoundRectPoints(0.6, 0.5, w - 1, h - 1, h * 0.45, rng, 1);
  strokePath(ctx, second, rng, skin.ink, 1.4, 0.5);
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
    strokePath(ctx, roughCirclePoints(r, r, r * 0.95, rng, 0.05), rng, skin.ink, 1.6, 0.9);
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
  strokePath(ctx, roughCirclePoints(r, r, r * 0.95, rng, 0.05), rng, skin.ink, 1.7);
  strokePath(ctx, roughCirclePoints(r, r, r * 0.9, rng, 0.07), rng, skin.ink, 1.1, 0.6);
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
