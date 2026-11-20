import { CONFIG } from './config';
import type { Brick, BrickType } from './state';

export interface Level {
  name: string;
  /**
   * 10-char rows: '.' empty, '1'-'3' normal brick with that hp, '#' steel, 'x' explosive, 'm' moving,
   * 'r' regenerating, 'h' hidden (2 hp: reveal, then 1 hp).
   */
  rows: string[];
}

export const GRID_COLS = 10;
export const CELL_W = 50;
export const CELL_H = 26;
export const GRID_X = 20;
export const GRID_Y = 120;
const INSET = 1;

const SPECIAL: Record<string, BrickType> = { '#': 'steel', x: 'explosive', m: 'moving', r: 'regen', h: 'hidden' };

function hash(a: number, b: number, c: number): number {
  let h = 2166136261;
  for (const v of [a, b, c]) h = Math.imul(h ^ (v + 0x9e3779b9), 16777619);
  return (h ^ (h >>> 15)) >>> 0;
}

export function parseLevel(level: Level, levelIndex: number): Brick[] {
  const bricks: Brick[] = [];
  level.rows.forEach((row, r) => {
    if (row.length !== GRID_COLS) {
      throw new Error(`Level "${level.name}" row ${r} has ${row.length} chars, expected ${GRID_COLS}`);
    }
    for (let c = 0; c < GRID_COLS; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      const type = SPECIAL[ch] ?? (ch === '1' || ch === '2' || ch === '3' ? 'normal' : null);
      if (!type) {
        throw new Error(`Level "${level.name}" row ${r} col ${c}: bad character "${ch}"`);
      }
      const hp = type === 'normal' ? Number(ch) : type === 'hidden' ? 2 : 1;
      bricks.push({
        id: bricks.length,
        x: GRID_X + c * CELL_W + INSET,
        y: GRID_Y + r * CELL_H + INSET,
        w: CELL_W - 2 * INSET,
        h: CELL_H - 2 * INSET,
        hp,
        maxHp: hp,
        kind: type === 'steel' ? 'steel' : 'normal',
        type,
        vx: type === 'moving' ? CONFIG.movingSpeed : 0,
        hidden: type === 'hidden',
        streakHits: 0,
        seed: hash(levelIndex, r, c),
      });
    }
  });
  return bricks;
}

export const LEVEL_1: Level = {
  name: 'Warm-up',
  rows: ['3333333333', '2222222222', '1.1.##.1.1', '1111111111', '2.2.2.2.2.', '1111111111'],
};

/** Small levels for trying each brick kind in the browser (`?level=<name>`). */
export const TEST_LEVELS: Record<string, Level> = {
  explosive: { name: 'Explosive test', rows: ['1111111111', '11xxxxxx11', '1111111111', '..........', '1.1.#x#.1.'] },
  moving: { name: 'Moving test', rows: ['m.........', '....m..#..', '1111111111', '.m......m.', '2222222222'] },
  regen: { name: 'Regen test', rows: ['..........', '.r.r.r.r.r', '1111111111', '..r....r..'] },
  hidden: { name: 'Hidden test', rows: ['hhhhhhhhhh', '1.1.1.1.1.', 'h.h.h.h.h.'] },
  mixed: { name: 'Mixed test', rows: ['3x2m1h1m2x', '1r1.##.1r1', 'hhxxrr.mm.', '2222222222'] },
};
