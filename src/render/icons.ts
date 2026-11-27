import type { PowerType } from '../engine';
import { C, rgba, shade } from './palette';
import { capsuleShape, categoryColor, type CapsuleShape } from './powerVisuals';

/**
 * Neon power-up icons. Every icon is drawn in a unit box centred on (0, 0) with radius ~1 (the caller scales),
 * as white strokes and fills; the caller adds the glow. Only used while building cached sprites.
 */
const ICONS: Record<PowerType, (g: CanvasRenderingContext2D) => void> = {
  // Triple ball: three balls in a triangle.
  photocopy: (g) => {
    dot(g, 0, -0.38, 0.27);
    dot(g, -0.38, 0.28, 0.27);
    dot(g, 0.38, 0.28, 0.27);
  },
  // Meteor: a fireball with speed streaks.
  crumpled: (g) => {
    g.beginPath();
    g.moveTo(-0.62, 0.1);
    g.lineTo(0.55, -0.72);
    g.lineTo(0.05, 0.22);
    g.lineTo(0.72, -0.55);
    g.lineTo(-0.1, 0.62);
    g.closePath();
    g.globalAlpha = 0.55;
    g.fill();
    g.globalAlpha = 1;
    dot(g, -0.28, 0.3, 0.42);
    g.fillStyle = C.ink;
    dot(g, -0.38, 0.36, 0.13);
    dot(g, -0.12, 0.2, 0.08);
  },
  // Homing: crosshair.
  plane: (g) => {
    g.lineWidth = 0.15;
    g.beginPath();
    g.arc(0, 0, 0.52, 0, Math.PI * 2);
    g.moveTo(0, -0.85);
    g.lineTo(0, -0.3);
    g.moveTo(0, 0.85);
    g.lineTo(0, 0.3);
    g.moveTo(-0.85, 0);
    g.lineTo(-0.3, 0);
    g.moveTo(0.85, 0);
    g.lineTo(0.3, 0);
    g.stroke();
    dot(g, 0, 0, 0.13);
  },
  // Splash: a splat with droplets.
  highlighter: (g) => {
    dot(g, 0, 0, 0.34);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.3;
      const r = k % 2 ? 0.62 : 0.72;
      dot(g, Math.cos(a) * r, Math.sin(a) * r, k % 2 ? 0.1 : 0.14);
      g.lineWidth = 0.14;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(Math.cos(a) * 0.3, Math.sin(a) * 0.3);
      g.lineTo(Math.cos(a) * (r - 0.12), Math.sin(a) * (r - 0.12));
      g.stroke();
    }
  },
  // Slow-mo: hourglass.
  correction: (g) => {
    g.lineWidth = 0.13;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(-0.45, -0.7);
    g.lineTo(0.45, -0.7);
    g.lineTo(0.05, 0);
    g.lineTo(0.45, 0.7);
    g.lineTo(-0.45, 0.7);
    g.lineTo(-0.05, 0);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(-0.3, 0.6);
    g.lineTo(0.3, 0.6);
    g.lineTo(0, 0.25);
    g.closePath();
    g.moveTo(-0.22, -0.55);
    g.lineTo(0.22, -0.55);
    g.lineTo(0, -0.3);
    g.closePath();
    g.fill();
  },
  // Wide: a bar with arrows to both sides.
  ruler: (g) => {
    roundRect(g, -0.42, -0.14, 0.84, 0.28, 0.12);
    g.fill();
    arrowHead(g, -0.9, 0, -1);
    arrowHead(g, 0.9, 0, 1);
  },
  // Sticky: a goo drop over a bar.
  gluestick: (g) => {
    g.beginPath();
    g.moveTo(0, -0.78);
    g.bezierCurveTo(0.2, -0.45, 0.45, -0.2, 0.45, 0.05);
    g.arc(0, 0.05, 0.45, 0, Math.PI, false);
    g.bezierCurveTo(-0.45, -0.2, -0.2, -0.45, 0, -0.78);
    g.fill();
    g.fillStyle = C.ink;
    g.beginPath();
    g.ellipse(-0.17, 0.02, 0.09, 0.17, 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = C.white;
    roundRect(g, -0.7, 0.62, 1.4, 0.2, 0.1);
    g.fill();
  },
  // Lasers: twin bolts rising from a bar.
  stapler: (g) => {
    g.lineWidth = 0.16;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-0.4, 0.4);
    g.lineTo(-0.4, -0.55);
    g.moveTo(0.4, 0.4);
    g.lineTo(0.4, -0.55);
    g.stroke();
    arrowHead(g, -0.4, -0.75, 0, -1);
    arrowHead(g, 0.4, -0.75, 0, -1);
    roundRect(g, -0.75, 0.48, 1.5, 0.26, 0.12);
    g.fill();
  },
  // Wipe: a beam sweeping through a row of blocks.
  eraser: (g) => {
    for (let k = -1; k <= 1; k++) {
      roundRect(g, k * 0.5 - 0.2, 0.05, 0.4, 0.34, 0.07);
      g.globalAlpha = k === -1 ? 0.35 : 1;
      g.fill();
    }
    g.globalAlpha = 1;
    g.lineWidth = 0.16;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-0.9, -0.32);
    g.lineTo(0.6, -0.32);
    g.stroke();
    arrowHead(g, 0.92, -0.32, 1);
    g.lineWidth = 0.08;
    g.beginPath();
    g.moveTo(-0.8, -0.58);
    g.lineTo(-0.2, -0.58);
    g.moveTo(-0.7, -0.06);
    g.lineTo(-0.35, -0.06);
    g.stroke();
  },
  // 1-UP: heart with a plus.
  goldstar: (g) => {
    heartPath(g, 0, 0.08, 0.78);
    g.fill();
    g.fillStyle = C.ink;
    g.fillRect(-0.07, -0.28, 0.14, 0.5);
    g.fillRect(-0.25, -0.1, 0.5, 0.14);
  },
  // Magnet: a horseshoe magnet.
  paperclip: (g) => {
    g.lineWidth = 0.32;
    g.lineCap = 'butt';
    g.beginPath();
    g.arc(0, -0.05, 0.42, Math.PI, 0, true);
    g.moveTo(0.42, -0.05);
    g.lineTo(0.42, -0.45);
    g.moveTo(-0.42, -0.05);
    g.lineTo(-0.42, -0.45);
    g.stroke();
    g.fillStyle = C.red;
    g.fillRect(-0.58, -0.75, 0.32, 0.3);
    g.fillRect(0.26, -0.75, 0.32, 0.3);
    g.fillStyle = C.white;
    g.fillRect(-0.58, -0.82, 0.32, 0.08);
    g.fillRect(0.26, -0.82, 0.32, 0.08);
  },
  // Shield.
  stickynote: (g) => {
    g.beginPath();
    g.moveTo(0, -0.8);
    g.quadraticCurveTo(0.35, -0.6, 0.65, -0.62);
    g.quadraticCurveTo(0.7, 0.35, 0, 0.82);
    g.quadraticCurveTo(-0.7, 0.35, -0.65, -0.62);
    g.quadraticCurveTo(-0.35, -0.6, 0, -0.8);
    g.fill();
    g.strokeStyle = C.ink;
    g.lineWidth = 0.14;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(-0.28, 0);
    g.lineTo(-0.06, 0.22);
    g.lineTo(0.3, -0.2);
    g.stroke();
  },
  // Shrink: arrows squeezing a short bar.
  sharpener: (g) => {
    roundRect(g, -0.22, -0.14, 0.44, 0.28, 0.1);
    g.fill();
    g.lineWidth = 0.14;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-0.92, 0);
    g.lineTo(-0.45, 0);
    g.moveTo(0.92, 0);
    g.lineTo(0.45, 0);
    g.stroke();
    arrowHead(g, -0.33, 0, 1);
    arrowHead(g, 0.33, 0, -1);
  },
  // Split: a bar cracked in two.
  scissors: (g) => {
    g.beginPath();
    g.moveTo(-0.85, -0.18);
    g.lineTo(-0.12, -0.18);
    g.lineTo(-0.02, -0.05);
    g.lineTo(-0.14, 0.05);
    g.lineTo(-0.06, 0.18);
    g.lineTo(-0.85, 0.18);
    g.closePath();
    g.moveTo(0.85, -0.18);
    g.lineTo(0.16, -0.18);
    g.lineTo(0.06, -0.05);
    g.lineTo(0.18, 0.05);
    g.lineTo(0.1, 0.18);
    g.lineTo(0.85, 0.18);
    g.closePath();
    g.fill();
    g.lineWidth = 0.1;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, -0.38);
    g.lineTo(-0.1, -0.62);
    g.moveTo(0.06, -0.36);
    g.lineTo(0.22, -0.58);
    g.moveTo(0, 0.38);
    g.lineTo(0.1, 0.62);
    g.moveTo(-0.06, 0.36);
    g.lineTo(-0.22, 0.58);
    g.stroke();
  },
  // Overdrive: lightning bolt.
  redpen: (g) => {
    g.beginPath();
    g.moveTo(0.18, -0.85);
    g.lineTo(-0.45, 0.1);
    g.lineTo(-0.02, 0.1);
    g.lineTo(-0.2, 0.85);
    g.lineTo(0.48, -0.15);
    g.lineTo(0.05, -0.15);
    g.closePath();
    g.fill();
  },
};

function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function arrowHead(g: CanvasRenderingContext2D, x: number, y: number, dx: number, dy = 0): void {
  // Triangle pointing along (dx, dy), tip at (x, y).
  const s = 0.26;
  const px = -dy;
  const py = dx;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x - dx * s * 1.3 + px * s, y - dy * s * 1.3 + py * s);
  g.lineTo(x - dx * s * 1.3 - px * s, y - dy * s * 1.3 - py * s);
  g.closePath();
  g.fill();
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

export function heartPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  g.moveTo(cx, cy + r * 0.85);
  g.bezierCurveTo(cx - r * 1.35, cy - r * 0.05, cx - r * 0.75, cy - r * 1.1, cx, cy - r * 0.42);
  g.bezierCurveTo(cx + r * 0.75, cy - r * 1.1, cx + r * 1.35, cy - r * 0.05, cx, cy + r * 0.85);
  g.closePath();
}

/** Draws the white icon for `type` at (cx, cy) with radius r, with a coloured glow (`px` = device px per unit). */
export function drawIcon(g: CanvasRenderingContext2D, type: PowerType, cx: number, cy: number, r: number, glow: string, px: number): void {
  g.save();
  g.translate(cx, cy);
  g.scale(r, r);
  g.fillStyle = C.white;
  g.strokeStyle = C.white;
  g.shadowColor = glow;
  g.shadowBlur = r * 0.5 * px;
  (ICONS[type] ?? ICONS.photocopy)(g);
  g.restore();
}

/** Spiky (saw-blade) outline for hazard capsules. */
function sawPath(g: CanvasRenderingContext2D, r: number, teeth: number): void {
  g.beginPath();
  for (let k = 0; k < teeth * 2; k++) {
    const a = (k / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = k % 2 === 0 ? r : r * 0.74;
    if (k === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
}

/** Outline path of a capsule badge, centred on (0, 0), for the given shape. */
export function capsulePath(g: CanvasRenderingContext2D, shape: CapsuleShape, r: number): void {
  switch (shape) {
    case 'saw':
      sawPath(g, r * 1.0, 9);
      break;
    case 'square':
      roundRect(g, -r * 0.8, -r * 0.8, r * 1.6, r * 1.6, r * 0.34);
      break;
    case 'hexagon': {
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 - Math.PI / 2;
        if (k === 0) g.moveTo(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98);
        else g.lineTo(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98);
      }
      g.closePath();
      break;
    }
    default:
      g.beginPath();
      g.arc(0, 0, r * 0.9, 0, Math.PI * 2);
  }
}

/**
 * Falling capsule badge of `size` (content box 0..size): dark glass body with a neon ring in the category
 * colour, a gloss highlight and the white icon. The outline differs per category (circle, rounded square,
 * hexagon, saw) so it reads without colour.
 */
export function renderCapsule(g: CanvasRenderingContext2D, type: PowerType, size: number, px: number): void {
  const col = categoryColor(type);
  const r = size / 2;
  g.save();
  g.translate(r, r);
  // Outer glow + ring.
  g.shadowColor = col;
  g.shadowBlur = 9 * px;
  capsulePath(g, capsuleShape(type), r);
  const fill = g.createRadialGradient(0, -r * 0.3, r * 0.1, 0, 0, r);
  fill.addColorStop(0, shade(col, -0.35));
  fill.addColorStop(1, shade(col, -0.82));
  g.fillStyle = fill;
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = r * 0.16;
  g.strokeStyle = col;
  g.lineJoin = 'round';
  g.stroke();
  g.lineWidth = r * 0.05;
  g.strokeStyle = rgba('#FFFFFF', 0.7);
  g.stroke();
  // Gloss.
  g.beginPath();
  g.ellipse(0, -r * 0.6, r * 0.42, r * 0.13, 0, 0, Math.PI * 2);
  g.fillStyle = rgba('#FFFFFF', 0.14);
  g.fill();
  g.restore();
  drawIcon(g, type, r, r, r * 0.52, col, px);
}

/** Small HUD icon (content box 0..size) for an active timed effect: icon only, ring drawn live by the HUD. */
export function renderHudIcon(g: CanvasRenderingContext2D, type: PowerType, size: number, px: number): void {
  const col = categoryColor(type);
  const r = size / 2;
  g.beginPath();
  g.arc(r, r, r * 0.92, 0, Math.PI * 2);
  g.fillStyle = shade(col, -0.78);
  g.fill();
  drawIcon(g, type, r, r, r * 0.58, col, px);
}
