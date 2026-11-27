import type { BrickType } from '../engine';

/** Neon arcade palette. Every colour the renderer and CSS use comes from here. */
export const C = {
  bg0: '#05010F',
  bg1: '#12043A',
  bg2: '#2A0848',
  grid: '#FF2BD6',
  horizon: '#FF6AD5',
  cyan: '#00E5FF',
  pink: '#FF3DCB',
  violet: '#9D6BFF',
  yellow: '#FFE53B',
  mint: '#3BFFB0',
  red: '#FF3B5C',
  orange: '#FF7A1A',
  gold: '#FFC21A',
  green: '#39FF14',
  white: '#F4F7FF',
  chrome: '#B9C3D6',
  ink: '#0B0620',
} as const;

/** Heavy display stack: Arial Black / Segoe UI Black on desktop, Roboto Black / SF Heavy on phones. */
export const FONT_FAMILY = '"Arial Black", "Segoe UI Black", "Roboto", "Helvetica Neue", system-ui, sans-serif';
export const font = (px: number, italic = true): string => `${italic ? 'italic ' : ''}900 ${px}px ${FONT_FAMILY}`;

/** Main neon colour of a brick (by type, and by max HP for normal bricks). */
export function brickHue(type: BrickType, maxHp: number): string {
  switch (type) {
    case 'steel':
      return C.chrome;
    case 'explosive':
      return C.red;
    case 'moving':
      return C.yellow;
    case 'regen':
      return C.mint;
    case 'hidden':
      return C.white;
    default:
      return maxHp >= 3 ? C.violet : maxHp === 2 ? C.pink : C.cyan;
  }
}

/** '#RRGGBB' + alpha 0..1 -> 'rgba(...)'. Only used while building cached sprites, never per frame. */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Mixes a hex colour toward white (t > 0) or black (t < 0). */
export function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number): number => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
