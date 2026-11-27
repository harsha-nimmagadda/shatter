import { GRID_COLS, type Level } from './level';

/**
 * Checks a level's rows: width, characters, and that every brick that counts toward winning can be reached by
 * the ball. Metal clips ('#') block; every other cell can be broken or passed. The ball can also travel in the
 * open band above the grid, in the side corridors left and right of it, and anywhere below it.
 * Returns a list of problems (empty when the level is fine).
 */
export function validateLevel(level: Level): string[] {
  const problems: string[] = [];
  const rows = level.rows;
  rows.forEach((row, r) => {
    if (row.length !== GRID_COLS) problems.push(`row ${r} has ${row.length} chars, expected ${GRID_COLS}`);
    for (const ch of row) if (!'.123#xmrh'.includes(ch)) problems.push(`row ${r} has bad character "${ch}"`);
  });
  if (problems.length) return problems;
  // Flood fill on a grid padded by one open cell on every side (top band, side corridors, bottom).
  const H = rows.length + 2;
  const W = GRID_COLS + 2;
  const cell = (r: number, c: number): string =>
    r === 0 || c === 0 || r === H - 1 || c === W - 1 ? '.' : rows[r - 1]![c - 1]!;
  const seen = new Uint8Array(H * W);
  const stack: number[] = [];
  for (let c = 0; c < W; c++) stack.push((H - 1) * W + c);
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i]) continue;
    const r = Math.floor(i / W);
    const c = i % W;
    if (cell(r, c) === '#') continue;
    seen[i] = 1;
    if (r > 0) stack.push(i - W);
    if (r < H - 1) stack.push(i + W);
    if (c > 0) stack.push(i - 1);
    if (c < W - 1) stack.push(i + 1);
  }
  let counting = 0;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const ch = rows[r]![c]!;
      if (ch === '.' || ch === '#' || ch === 'r') continue;
      counting++;
      if (!seen[(r + 1) * W + (c + 1)]) problems.push(`brick at row ${r}, col ${c} ("${ch}") can't be reached`);
    }
  }
  if (counting === 0) problems.push('no bricks that count toward winning');
  return problems;
}
