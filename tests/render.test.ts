import { describe, expect, it } from 'vitest';
import { createRng } from '../src/engine/rng';
import { boilFrame } from '../src/render/boil';
import { Particles } from '../src/render/particles';
import { Shake } from '../src/render/shake';
import {
  crackPaths,
  hatchLines,
  roughCirclePoints,
  roughRectPaths,
  scribblePoints,
  wobblyLinePoints,
} from '../src/render/sketch';

const r = (seed: number) => createRng(seed);

describe('sketch determinism', () => {
  it('wobblyLinePoints', () => {
    expect(wobblyLinePoints(0, 0, 100, 40, r(1))).toEqual(wobblyLinePoints(0, 0, 100, 40, r(1)));
    expect(wobblyLinePoints(0, 0, 100, 40, r(1))).not.toEqual(wobblyLinePoints(0, 0, 100, 40, r(2)));
  });
  it('roughRectPaths', () => {
    const a = roughRectPaths(5, 5, 48, 24, r(3));
    expect(a).toEqual(roughRectPaths(5, 5, 48, 24, r(3)));
    expect(a).not.toEqual(roughRectPaths(5, 5, 48, 24, r(4)));
    expect(a).toHaveLength(2);
    expect(a[0]).toHaveLength(4);
  });
  it('roughCirclePoints overlaps its start', () => {
    const a = roughCirclePoints(10, 10, 8, r(5));
    expect(a).toEqual(roughCirclePoints(10, 10, 8, r(5)));
    expect(a).not.toEqual(roughCirclePoints(10, 10, 8, r(6)));
    expect(a[0]).not.toEqual(a[a.length - 1]);
  });
  it('hatchLines', () => {
    expect(hatchLines(0, 0, 48, 24, 0.8, 4, r(7))).toEqual(hatchLines(0, 0, 48, 24, 0.8, 4, r(7)));
    expect(hatchLines(0, 0, 48, 24, 0.8, 4, r(7))).not.toEqual(hatchLines(0, 0, 48, 24, 0.8, 4, r(8)));
  });
  it('crackPaths and scribble', () => {
    expect(crackPaths(0, 0, 48, 24, r(9), 3)).toEqual(crackPaths(0, 0, 48, 24, r(9), 3));
    expect(crackPaths(0, 0, 48, 24, r(9), 3)).not.toEqual(crackPaths(0, 0, 48, 24, r(10), 3));
    expect(scribblePoints(0, 0, 48, 24, r(1))).toEqual(scribblePoints(0, 0, 48, 24, r(1)));
  });
});

describe('inside-rect guarantees', () => {
  const eps = 1e-6;
  it('hatch segments stay inside the rect for many angles', () => {
    for (let i = 0; i < 40; i++) {
      const angle = -Math.PI + (i * Math.PI * 2) / 40;
      const segs = hatchLines(10, 20, 48, 24, angle, 3.5, r(i + 1));
      expect(segs.length).toBeGreaterThan(0);
      for (const s of segs) {
        for (const [x, y] of [
          [s.x1, s.y1],
          [s.x2, s.y2],
        ]) {
          expect(x).toBeGreaterThanOrEqual(10 - eps);
          expect(x).toBeLessThanOrEqual(58 + eps);
          expect(y).toBeGreaterThanOrEqual(20 - eps);
          expect(y).toBeLessThanOrEqual(44 + eps);
        }
      }
    }
  });
  it('cracks and scribbles stay inside', () => {
    const pts = [...crackPaths(10, 20, 48, 24, r(3), 4).flat(), ...scribblePoints(10, 20, 48, 24, r(4))];
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(10);
      expect(p.x).toBeLessThanOrEqual(58);
      expect(p.y).toBeGreaterThanOrEqual(20);
      expect(p.y).toBeLessThanOrEqual(44);
    }
  });
});

describe('boil', () => {
  it('cycles 0..2 at about 10 Hz', () => {
    const seq = [0.05, 0.15, 0.25, 0.35, 0.45].map((t) => boilFrame(t, 0));
    expect(seq).toEqual([0, 1, 2, 0, 1]);
    expect(boilFrame(0.01, 0)).toBe(boilFrame(0.09, 0));
    const seen = new Set<number>();
    for (let t = 0; t < 2; t += 0.01) seen.add(boilFrame(t, 7));
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
  it('seed offsets desynchronise sprites', () => {
    expect(boilFrame(0.05, 1)).not.toBe(boilFrame(0.05, 0));
  });
});

describe('particles', () => {
  it('never exceeds its cap and reuses slots', () => {
    const p = new Particles(50);
    for (let i = 0; i < 20; i++) p.emit('shred', 0, 0, 30);
    expect(p.active).toBe(50);
    p.update(5);
    expect(p.active).toBe(0);
    p.emit('speck', 0, 0, 10);
    expect(p.active).toBe(10);
  });
  it('default pool cap is 400', () => {
    const p = new Particles();
    p.emit('tick', 1, 1, 1000);
    expect(p.active).toBe(400);
  });
});

describe('shake', () => {
  it('decays to zero', () => {
    const s = new Shake();
    s.add(1);
    s.update(0.016);
    expect(Math.abs(s.x) + Math.abs(s.y)).toBeGreaterThan(0);
    for (let i = 0; i < 300; i++) s.update(0.016);
    expect(s.trauma).toBe(0);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });
  it('offset is smooth between frames', () => {
    const s = new Shake();
    s.add(1);
    s.update(0.016);
    const x0 = s.x;
    s.update(0.016);
    expect(Math.abs(s.x - x0)).toBeLessThan(6);
  });
  it('does nothing when disabled', () => {
    const s = new Shake();
    s.enabled = false;
    s.add(1);
    s.update(0.016);
    expect(s.trauma).toBe(0);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });
});
