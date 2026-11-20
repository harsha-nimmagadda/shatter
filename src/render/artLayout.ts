import { createRng } from '../engine/rng';

/** Pure helpers for placing and sampling generated art. No canvas/DOM so they are unit-testable in Node. */

/** manifest.json -> { id: [relative file paths] }. Tolerates any garbage; bad entries are skipped. */
export function parseManifest(json: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return out;
  for (const [id, entry] of Object.entries(json as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const files = (entry as { files?: unknown }).files;
    if (!Array.isArray(files)) continue;
    const ok = files.filter((f): f is string => typeof f === 'string' && f.length > 0 && !/^[a-z]+:|^\/\//i.test(f));
    if (ok.length) out[id] = ok;
  }
  return out;
}

/** Deterministic index in [0, n) from a seed (0 when n <= 0). */
export function pickIndex(seed: number, n: number): number {
  if (n <= 0) return 0;
  return createRng(seed ^ 0x5bd1e995).int(0, n - 1);
}

export interface TexWindow {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Quarter turns clockwise to apply when drawing. */
  rot: 0 | 1 | 2 | 3;
}

/**
 * A seeded source window inside a texture. For quarter-turn rotations of 90/270 the window is taken
 * portrait (winH x winW) so that after rotating it has the brick's landscape aspect again.
 */
export function textureWindow(seed: number, texW: number, texH: number, winW = 140, winH = 70): TexWindow {
  const rng = createRng(seed ^ 0x2545f491);
  const rot = rng.int(0, 3) as 0 | 1 | 2 | 3;
  let sw = rot % 2 ? winH : winW;
  let sh = rot % 2 ? winW : winH;
  sw = Math.max(1, Math.min(sw, texW));
  sh = Math.max(1, Math.min(sh, texH));
  const sx = rng.range(0, Math.max(0, texW - sw));
  const sy = rng.range(0, Math.max(0, texH - sh));
  return { sx, sy, sw, sh, rot };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Source rect of an image that 'covers' dw x dh (centre crop). */
export function coverRect(srcW: number, srcH: number, dw: number, dh: number): Rect {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const k = Math.max(dw / srcW, dh / srcH);
  const w = dw / k;
  const h = dh / k;
  return { x: (srcW - w) / 2, y: (srcH - h) / 2, w, h };
}

export interface Doodle {
  /** Centre, logical units. */
  x: number;
  y: number;
  /** Longest side of the drawn image. */
  size: number;
  rot: number;
  /** Which margin image (index into the list of margin images). */
  image: number;
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export interface DoodleOpts {
  seed: number;
  count: number;
  imageCount: number;
  width: number;
  height: number;
  /** Rects (logical units) doodles must stay clear of: HUD band, brick grid, paddle zone, margin lines... */
  forbidden: Rect[];
  /** x extent of the left margin strip that the first doodles prefer. */
  leftStrip?: [number, number];
  minSize?: number;
  maxSize?: number;
}

/** Seeded doodle placement that never overlaps forbidden rects, the canvas edge or each other. May return fewer than asked. */
export function placeMarginDoodles(o: DoodleOpts): Doodle[] {
  const rng = createRng(o.seed ^ 0x9e3779b1);
  const out: Doodle[] = [];
  if (o.imageCount <= 0) return out;
  const minS = o.minSize ?? 28;
  const maxS = o.maxSize ?? 40;
  const [lx0, lx1] = o.leftStrip ?? [4, 54];
  const used = new Set<number>();
  for (let n = 0; n < o.count; n++) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const size = rng.range(minS, maxS);
      const half = size * 0.56; // slight rotation headroom
      const preferLeft = n < 2 && attempt < 80;
      const x0 = preferLeft ? lx0 + half : half + 2;
      const x1 = preferLeft ? lx1 - half : o.width - half - 2;
      if (x1 <= x0) continue;
      const x = rng.range(x0, x1);
      const y = rng.range(half + 2, o.height - half - 2);
      const box: Rect = { x: x - half, y: y - half, w: half * 2, h: half * 2 };
      if (o.forbidden.some((f) => overlaps(box, f))) continue;
      if (out.some((d) => Math.hypot(d.x - x, d.y - y) < (d.size + size) * 0.6)) continue;
      // Prefer distinct images while any are left.
      let image = rng.int(0, o.imageCount - 1);
      if (used.size < o.imageCount) {
        for (let k = 0; k < o.imageCount && used.has(image); k++) image = (image + 1) % o.imageCount;
      }
      used.add(image);
      out.push({ x, y, size, rot: rng.range(-0.25, 0.25), image });
      break;
    }
  }
  return out;
}

/** Bounding box of the bricks (logical units), or null if there are none. */
export function bricksBounds(bricks: readonly { x: number; y: number; w: number; h: number }[]): Rect | null {
  if (!bricks.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of bricks) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
