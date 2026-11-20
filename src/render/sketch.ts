import type { Rng } from '../engine/rng';

export interface Pt {
  x: number;
  y: number;
}
export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Combines integers into a well-mixed 32-bit seed. */
export function mixSeed(a: number, b: number, c = 0): number {
  let h = 2166136261;
  h = Math.imul(h ^ ((a | 0) + 0x9e3779b9), 16777619);
  h = Math.imul(h ^ ((b | 0) + 0x85ebca6b), 16777619);
  h = Math.imul(h ^ ((c | 0) + 0xc2b2ae35), 16777619);
  return (h ^ (h >>> 15)) >>> 0;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- point generation (pure)

export interface WobbleOpts {
  /** Perpendicular jitter as a fraction of line length. */
  jitter?: number;
  /** Cap for the jitter, logical units. */
  maxJitter?: number;
  /** Max overshoot past either end, logical units (may also undershoot a little). */
  overshoot?: number;
  /** Target segment length. */
  segLen?: number;
}

/** A hand-drawn straight line: a few segments, perpendicular jitter, ragged ends. */
export function wobblyLinePoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rng: Rng,
  opts: WobbleOpts = {},
): Pt[] {
  const { jitter = 0.012, maxJitter = 2.2, overshoot = 3, segLen = 14 } = opts;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const jit = Math.min(maxJitter, len * jitter);
  const a = rng.range(-overshoot * 0.3, overshoot);
  const b = rng.range(-overshoot * 0.3, overshoot);
  const total = len + a + b;
  const n = clamp(Math.round(len / segLen), 2, 10);
  const bow = rng.range(-1, 1) * jit * 0.8;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const along = -a + total * t;
    const end = i === 0 || i === n ? 0.5 : 1;
    const off = rng.range(-jit, jit) * end + Math.sin(Math.PI * t) * bow;
    pts.push({ x: x1 + ux * along + nx * off, y: y1 + uy * along + ny * off });
  }
  return pts;
}

export interface RectOpts extends WobbleOpts {
  /** Max offset of the second pass. */
  passOffset?: number;
}

/**
 * Quick-pen-sketch rectangle: 4 independent wobbly sides whose corners overshoot.
 * Returns 2 passes (second one offset slightly), each with 4 side polylines.
 */
export function roughRectPaths(x: number, y: number, w: number, h: number, rng: Rng, opts: RectOpts = {}): Pt[][][] {
  const { passOffset = 1, ...wob } = opts;
  const passes: Pt[][][] = [];
  for (let p = 0; p < 2; p++) {
    const ox = p === 0 ? 0 : rng.range(-passOffset, passOffset);
    const oy = p === 0 ? 0 : rng.range(-passOffset, passOffset);
    const l = x + ox;
    const t = y + oy;
    const r = l + w;
    const b = t + h;
    passes.push([
      wobblyLinePoints(l, t, r, t, rng, wob),
      wobblyLinePoints(r, t, r, b, rng, wob),
      wobblyLinePoints(r, b, l, b, rng, wob),
      wobblyLinePoints(l, b, l, t, rng, wob),
    ]);
  }
  return passes;
}

/** Loose closed outline of a rect (corners and mid-edges jittered); used to clip fills / textures. */
export function roughPolygon(x: number, y: number, w: number, h: number, rng: Rng, jitter = 1.2): Pt[] {
  const xs = [x, x + w / 2, x + w, x + w, x + w, x + w / 2, x, x];
  const ys = [y, y, y, y + h / 2, y + h, y + h, y + h, y + h / 2];
  return xs.map((px, i) => ({ x: px + rng.range(-jitter, jitter), y: ys[i] + rng.range(-jitter, jitter) }));
}

/** Rounded-rect loop (paddle): jittered, slightly overlapping its start instead of closing exactly. */
export function roughRoundRectPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  rng: Rng,
  jitter = 0.9,
): Pt[] {
  const r = Math.min(radius, w / 2, h / 2);
  const pts: Pt[] = [];
  const add = (px: number, py: number): void => {
    pts.push({ x: px + rng.range(-jitter, jitter), y: py + rng.range(-jitter, jitter) });
  };
  const arc = (cx: number, cy: number, a0: number): void => {
    for (let k = 0; k <= 3; k++) {
      const a = a0 + (k * Math.PI) / 6;
      add(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  };
  add(x + w / 2, y);
  arc(x + w - r, y + r, -Math.PI / 2);
  add(x + w, y + h / 2);
  arc(x + w - r, y + h - r, 0);
  add(x + w / 2, y + h);
  arc(x + r, y + h - r, Math.PI / 2);
  add(x, y + h / 2);
  arc(x + r, y + r, Math.PI);
  add(x + w * 0.2, y);
  return pts;
}

/** Radius-jittered loop that overshoots its start a little instead of closing exactly. */
export function roughCirclePoints(cx: number, cy: number, r: number, rng: Rng, jitter = 0.07): Pt[] {
  const n = 14;
  const a0 = rng.range(0, Math.PI * 2);
  const sweep = Math.PI * 2 * 1.08;
  const count = Math.ceil(n * 1.08) + 1;
  const drift = rng.range(-1, 1) * r * 0.04;
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const a = a0 + sweep * t;
    const rr = r * (1 + rng.range(-jitter, jitter)) + drift * Math.sin(a * 2);
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return pts;
}

/**
 * Parallel jittered strokes clipped to the rect, computed mathematically (slab clipping).
 * Endpoints may only shrink inwards, so segments never leave the rect.
 */
export function hatchLines(x: number, y: number, w: number, h: number, angle: number, gap: number, rng: Rng): Seg[] {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const nx = -dy;
  const ny = dx;
  const proj = [x * nx + y * ny, (x + w) * nx + y * ny, x * nx + (y + h) * ny, (x + w) * nx + (y + h) * ny];
  const nmin = Math.min(...proj);
  const nmax = Math.max(...proj);
  const out: Seg[] = [];
  for (let t = nmin + gap * 0.5; t < nmax; t += gap) {
    const tt = t + rng.range(-gap * 0.18, gap * 0.18);
    // Point on the line closest to the origin, then solve for the parameter range inside the rect.
    const px = nx * tt;
    const py = ny * tt;
    let s0 = -Infinity;
    let s1 = Infinity;
    for (const [p, d, lo, hi] of [
      [px, dx, x, x + w],
      [py, dy, y, y + h],
    ] as const) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) {
          s0 = Infinity;
          s1 = -Infinity;
        }
      } else {
        const a = (lo - p) / d;
        const b = (hi - p) / d;
        s0 = Math.max(s0, Math.min(a, b));
        s1 = Math.min(s1, Math.max(a, b));
      }
    }
    if (!(s1 - s0 > 1)) continue;
    const shrinkA = Math.min(rng.range(0, gap * 0.5), (s1 - s0) * 0.25);
    const shrinkB = Math.min(rng.range(0, gap * 0.5), (s1 - s0) * 0.25);
    const a = s0 + shrinkA;
    const b = s1 - shrinkB;
    out.push({ x1: px + dx * a, y1: py + dy * a, x2: px + dx * b, y2: py + dy * b });
  }
  return out;
}

/** Zig-zag scribble fill inside the rect (all points stay inside). */
export function scribblePoints(x: number, y: number, w: number, h: number, rng: Rng, gap = 4): Pt[] {
  const pts: Pt[] = [];
  const rows = Math.max(2, Math.ceil(h / (gap * 0.5)));
  for (let i = 0; i <= rows; i++) {
    const left = i % 2 === 0;
    const px = left ? x + rng.range(0, gap) : x + w - rng.range(0, gap);
    const py = y + (h * i) / rows + rng.range(-gap * 0.2, gap * 0.2);
    pts.push({ x: clamp(px, x, x + w), y: clamp(py, y, y + h) });
  }
  return pts;
}

/** Zig-zag cracks starting on an edge and heading inwards; all points stay inside the rect. */
export function crackPaths(x: number, y: number, w: number, h: number, rng: Rng, count: number): Pt[][] {
  const out: Pt[][] = [];
  for (let c = 0; c < count; c++) {
    const edge = rng.int(0, 3);
    const f = rng.range(0.15, 0.85);
    let px: number;
    let py: number;
    let ang: number;
    if (edge === 0) {
      px = x + w * f;
      py = y;
      ang = Math.PI / 2;
    } else if (edge === 1) {
      px = x + w;
      py = y + h * f;
      ang = Math.PI;
    } else if (edge === 2) {
      px = x + w * f;
      py = y + h;
      ang = -Math.PI / 2;
    } else {
      px = x;
      py = y + h * f;
      ang = 0;
    }
    ang += rng.range(-0.5, 0.5);
    const pts: Pt[] = [{ x: px, y: py }];
    const steps = rng.int(3, 5);
    const step = Math.min(w, h) * rng.range(0.22, 0.34);
    for (let i = 0; i < steps; i++) {
      const a = ang + (i % 2 === 0 ? 1 : -1) * rng.range(0.35, 0.9);
      px = clamp(px + Math.cos(a) * step, x, x + w);
      py = clamp(py + Math.sin(a) * step, y, y + h);
      pts.push({ x: px, y: py });
    }
    out.push(pts);
  }
  return out;
}

// ---------------------------------------------------------------- drawing

/** Strokes a polyline with light quadratic smoothing, pencil feel (round caps, varied width and alpha). */
export function strokePath(
  ctx: CanvasRenderingContext2D,
  pts: readonly Pt[],
  rng: Rng,
  color: string,
  width: number,
  alphaScale = 1,
): void {
  if (pts.length < 2) return;
  ctx.globalAlpha = rng.range(0.8, 0.95) * alphaScale;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * rng.range(0.88, 1.15);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const m = pts[i];
    const n = pts[i + 1];
    ctx.quadraticCurveTo(m.x, m.y, (m.x + n.x) / 2, (m.y + n.y) / 2);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Strokes many straight segments in one path (hatching). */
export function strokeSegs(
  ctx: CanvasRenderingContext2D,
  segs: readonly Seg[],
  rng: Rng,
  color: string,
  width: number,
  alphaScale = 1,
): void {
  if (segs.length === 0) return;
  ctx.globalAlpha = rng.range(0.8, 0.95) * alphaScale;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * rng.range(0.9, 1.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const s of segs) {
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Traces a closed polygon path (no fill/stroke), e.g. for clipping. */
export function tracePolygon(ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

/** Draws a rough rect outline (both passes; the second is fainter). */
export function strokeRoughRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rng: Rng,
  color: string,
  width: number,
): void {
  const passes = roughRectPaths(x, y, w, h, rng);
  passes.forEach((sides, p) => {
    for (const s of sides) strokePath(ctx, s, rng, color, width, p === 0 ? 1 : 0.55);
  });
}
