// Generates the app icons and iOS startup images into public/ (no dependencies, no network).
//   node tools/genIcons.mjs
// Every shape is a signed-distance function in the 512x512 icon space of public/icon.svg, rasterised per pixel
// with analytic anti-aliasing and a soft exponential glow, then written with a tiny PNG encoder (node:zlib only).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ---------- PNG encoder ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
/** pixels: Uint8Array of w*h*ch bytes (ch 3 = RGB, 4 = RGBA). Rows use PNG filter "Up". */
export function encodePng(w, h, ch, pixels) {
  const stride = w * ch;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    raw[o] = y === 0 ? 0 : 2;
    for (let i = 0; i < stride; i++) {
      const v = pixels[y * stride + i];
      raw[o + 1 + i] = y === 0 ? v : (v - pixels[(y - 1) * stride + i]) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = ch === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- signed distance helpers (negative inside) ----------
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const rrect = (x, y, w, h, r) => {
  const cx = x + w / 2, cy = y + h / 2, hx = w / 2 - r, hy = h / 2 - r;
  return (px, py) => {
    const qx = Math.abs(px - cx) - hx, qy = Math.abs(py - cy) - hy;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
};
const circle = (cx, cy, r) => (px, py) => Math.hypot(px - cx, py - cy) - r;
const segment = (ax, ay, bx, by, w) => (px, py) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t) - w / 2;
};
const polygon = (pts) => (px, py) => {
  let d = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    const ex = bx - ax, ey = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, Math.hypot(px - ax - ex * t, py - ay - ey * t));
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside ? -d : d;
};

// ---------- the logo (same artwork as public/icon.svg) ----------
const CY = '#00E5FF', PK = '#FF3DCB', VI = '#9D6BFF', WH = '#FFFFFF';
const shape = (sdf, bbox, o) => ({ sdf, bbox, ...o });
const SHAPES = [
  shape(rrect(66, 92, 110, 54, 12), [66, 92, 176, 146], { fill: [...hex('#004A55'), 1], stroke: [hex(CY), 8], glow: [hex(CY), 0.55] }),
  shape(rrect(200, 92, 110, 54, 12), [200, 92, 310, 146], { fill: [...hex('#55124A'), 1], stroke: [hex(PK), 8], glow: [hex(PK), 0.55] }),
  shape(rrect(334, 92, 110, 54, 12), [334, 92, 444, 146], { fill: [...hex('#33215A'), 1], stroke: [hex(VI), 8], glow: [hex(VI), 0.55] }),
  shape(rrect(66, 166, 110, 54, 12), [66, 166, 176, 220], { fill: [...hex('#55124A'), 1], stroke: [hex(PK), 8], glow: [hex(PK), 0.55] }),
  shape(polygon([[200, 166], [244, 166], [234, 186], [252, 200], [236, 220], [200, 220]]), [200, 166, 252, 220], { fill: [...hex('#004A55'), 1], stroke: [hex(CY), 8], glow: [hex(CY), 0.55] }),
  shape(polygon([[334, 166], [444, 166], [444, 220], [346, 220], [360, 198], [340, 186]]), [334, 166, 444, 220], { fill: [...hex('#004A55'), 1], stroke: [hex(CY), 8], glow: [hex(CY), 0.55] }),
  shape(segment(262, 168, 288, 152, 7), [262, 152, 288, 168], { fill: [...hex(WH), 1], glow: [hex(WH), 0.3] }),
  shape(segment(282, 200, 312, 206, 7), [282, 200, 312, 206], { fill: [...hex(WH), 1], glow: [hex(WH), 0.3] }),
  shape(segment(270, 226, 280, 256, 7), [270, 226, 280, 256], { fill: [...hex(WH), 1], glow: [hex(WH), 0.3] }),
  shape(segment(232, 300, 172, 370, 22), [172, 300, 232, 370], { fill: [...hex('#7FD8FF'), 0.45] }),
  shape(rrect(150, 372, 212, 30, 15), [150, 372, 362, 402], { fill: [...hex('#1A1440'), 1], stroke: [hex(CY), 8], glow: [hex(CY), 0.55] }),
  shape(rrect(150, 372, 34, 30, 15), [150, 372, 184, 402], { fill: [...hex(PK), 1] }),
  shape(rrect(328, 372, 34, 30, 15), [328, 372, 362, 402], { fill: [...hex(PK), 1] }),
  shape(circle(248, 282, 30), [218, 252, 278, 312], { fill: [...hex(WH), 1], glow: [hex('#7FD8FF'), 0.85] }),
];
/** Centre of the artwork in icon space. */
const LOGO_C = [255, 247];
const GLOW_R = 14;
const GLOW_PAD = GLOW_R * 5;

const BG = [hex('#05010F'), hex('#12043A'), hex('#2A0848')];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const bgAt = (t) => (t < 0.6 ? lerp3(BG[0], BG[1], t / 0.6) : lerp3(BG[1], BG[2], (t - 0.6) / 0.4));

/**
 * Renders one picture. `view` places the logo: centre (cx, cy) in px and scale s (px per icon unit).
 * `round` > 0 makes transparent rounded corners (radius in px).
 */
function render(w, h, view, round = 0) {
  const ch = round > 0 ? 4 : 3;
  const out = new Uint8Array(w * h * ch);
  const { cx, cy, s } = view;
  const aa = 1 / s;
  const horizon = view.horizon * h;
  const lineW = Math.max(1.4, w * 0.006);
  const mask = round > 0 ? rrect(0, 0, w, h, round) : null;
  for (let y = 0; y < h; y++) {
    const [r0, g0, b0] = bgAt(y / (h - 1));
    const v = (y - cy) / s + LOGO_C[1];
    for (let x = 0; x < w; x++) {
      let r = r0, g = g0, b = b0;
      // Perspective grid floor.
      if (y > horizon) {
        const f = (y - horizon) / (h - horizon);
        let a = 0;
        for (let k = 0; k < 4; k++) {
          const ly = horizon + (h - horizon) * Math.pow((k + 0.55) / 3.4, 1.7);
          a = Math.max(a, 1 - Math.min(1, Math.abs(y - ly) / lineW));
        }
        for (let j = -2; j <= 2; j++) {
          const bx = w / 2 + j * w * 0.2, dx = bx - w / 2, dy = h - horizon;
          const dist = Math.abs((x - w / 2) * dy - (y - horizon) * dx) / Math.hypot(dx, dy);
          a = Math.max(a, 1 - Math.min(1, dist / lineW));
        }
        a *= 0.35 * Math.min(1, f * 4);
        r += (255 - r) * a;
        g += (43 - g) * a;
        b += (214 - b) * a;
      }
      const u = (x - cx) / s + LOGO_C[0];
      for (let i = 0; i < SHAPES.length; i++) {
        const sh = SHAPES[i];
        const bb = sh.bbox;
        if (u < bb[0] - GLOW_PAD || u > bb[2] + GLOW_PAD || v < bb[1] - GLOW_PAD || v > bb[3] + GLOW_PAD) continue;
        const d = sh.sdf(u, v);
        if (sh.glow && d > 0) {
          const ga = sh.glow[1] * Math.exp(-d / GLOW_R);
          if (ga > 0.004) {
            const gc = sh.glow[0];
            r += gc[0] * ga * (1 - r / 400);
            g += gc[1] * ga * (1 - g / 400);
            b += gc[2] * ga * (1 - b / 400);
          }
        }
        if (sh.fill) {
          const cov = Math.max(0, Math.min(1, 0.5 - d / aa)) * sh.fill[3];
          if (cov > 0) {
            r += (sh.fill[0] - r) * cov;
            g += (sh.fill[1] - g) * cov;
            b += (sh.fill[2] - b) * cov;
          }
        }
        if (sh.stroke) {
          const cov = Math.max(0, Math.min(1, 0.5 - (Math.abs(d) - sh.stroke[1] / 2) / aa));
          if (cov > 0) {
            const sc = sh.stroke[0];
            r += (sc[0] - r) * cov;
            g += (sc[1] - g) * cov;
            b += (sc[2] - b) * cov;
          }
        }
      }
      const o = (y * w + x) * ch;
      out[o] = Math.max(0, Math.min(255, r));
      out[o + 1] = Math.max(0, Math.min(255, g));
      out[o + 2] = Math.max(0, Math.min(255, b));
      if (mask) out[o + 3] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - mask(x + 0.5, y + 0.5))));
    }
  }
  return encodePng(w, h, ch, out);
}

function iconView(size, inner) {
  // The artwork spans about 380x330 icon units; `inner` is the fraction of the square it may fill.
  const s = (size * inner) / 400;
  return { cx: size / 2, cy: size / 2 + size * 0.015, s, horizon: 0.7 };
}

const write = (rel, buf) => {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  console.log(`${rel}  ${(buf.length / 1024).toFixed(0)} KB`);
};

/** iOS portrait startup images: [device width, device height, pixel ratio] in CSS px. */
export const STARTUP = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3], [375, 812, 3],
  [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2], [320, 568, 2],
  [1024, 1366, 2], [834, 1194, 2], [834, 1112, 2], [820, 1180, 2], [768, 1024, 2],
];
export const startupName = (w, h, r) => `splash/apple-splash-${w * r}x${h * r}.png`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  write('icon-192.png', render(192, 192, iconView(192, 0.94), Math.round(192 * 0.203)));
  write('icon-512.png', render(512, 512, iconView(512, 0.94), Math.round(512 * 0.203)));
  // Maskable: full-bleed background, artwork inside the central 80% (the safe zone).
  write('maskable-512.png', render(512, 512, iconView(512, 0.74)));
  // iOS applies its own corner mask: full-bleed, no transparency.
  write('apple-touch-icon.png', render(180, 180, iconView(180, 0.94)));
  const only = process.argv.includes('--icons-only');
  if (!only) {
    for (const [cw, chh, r] of STARTUP) {
      const w = cw * r, h = chh * r;
      const s = (Math.min(w, h * 0.6) * 0.62) / 400;
      write(startupName(cw, chh, r), render(w, h, { cx: w / 2, cy: h * 0.42, s, horizon: 0.68 }));
    }
  }
}
