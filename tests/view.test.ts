import { describe, it, expect } from 'vitest';
import { fitPlayfield, LOGICAL_W, LOGICAL_H } from '../src/game/view';

describe('fitPlayfield', () => {
  it('letterboxes a portrait phone (390x844) vertically', () => {
    const f = fitPlayfield(390, 844);
    const scale = 390 / LOGICAL_W;
    expect(f.scale).toBeCloseTo(scale);
    expect(f.offsetX).toBeCloseTo(0);
    expect(f.offsetY).toBeCloseTo((844 - LOGICAL_H * scale) / 2);
  });

  it('pillarboxes a landscape desktop (1920x1080)', () => {
    const f = fitPlayfield(1920, 1080);
    expect(f.scale).toBeCloseTo(1080 / LOGICAL_H);
    expect(f.offsetY).toBeCloseTo(0);
    expect(f.offsetX).toBeCloseTo((1920 - LOGICAL_W * (1080 / LOGICAL_H)) / 2);
  });

  it('is the identity for an exact 540x960 box', () => {
    expect(fitPlayfield(540, 960)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});
