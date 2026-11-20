import { createRng } from '../engine/rng';
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
}

export function brickColor(skin: Skin, kind: 'normal' | 'steel', hp: number): string {
  if (kind === 'steel') return skin.steel;
  return skin.brick[hp >= 3 ? 3 : hp <= 1 ? 1 : 2];
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
  const color = brickColor(skin, b.kind, b.hp);
  const { w, h } = b;

  const poly = roughPolygon(1, 1, w - 2, h - 2, rng, 1);
  if (!fillTextured(ctx, skin, brickTexture(b.kind, b.hp), poly)) {
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

  strokeRoughRect(ctx, 0, 0, w, h, rng, skin.ink, 1.9);

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
  } else if (b.maxHp === 1 && id.next() < 0.2) {
    smiley(ctx, skin, w * id.range(0.3, 0.7), h / 2, h * 0.2, rng);
  }
}

export function renderPaddle(ctx: CanvasRenderingContext2D, skin: Skin, w: number, h: number, variant: number): void {
  const rng = createRng(mixSeed(w, variant + 1, 11));
  const outline = roughRoundRectPoints(0, 0, w, h, h * 0.45, rng, 0.8);
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
