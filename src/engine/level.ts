import type { Brick } from './state';

export interface Level {
  name: string;
  /** 10-char rows: '.' empty, '1'-'3' normal brick with that hp, '#' steel. */
  rows: string[];
}

export const GRID_COLS = 10;
export const CELL_W = 50;
export const CELL_H = 26;
export const GRID_X = 20;
export const GRID_Y = 120;
const INSET = 1;

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
      const steel = ch === '#';
      if (!steel && ch !== '1' && ch !== '2' && ch !== '3') {
        throw new Error(`Level "${level.name}" row ${r} col ${c}: bad character "${ch}"`);
      }
      const hp = steel ? 1 : Number(ch);
      bricks.push({
        id: bricks.length,
        x: GRID_X + c * CELL_W + INSET,
        y: GRID_Y + r * CELL_H + INSET,
        w: CELL_W - 2 * INSET,
        h: CELL_H - 2 * INSET,
        hp,
        maxHp: hp,
        kind: steel ? 'steel' : 'normal',
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
