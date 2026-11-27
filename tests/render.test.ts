import { describe, expect, it } from 'vitest';
import { Particles } from '../src/render/particles';
import { Shake } from '../src/render/shake';
import { brickHue, rgba, shade } from '../src/render/palette';

describe('palette', () => {
  it('gives every brick kind its own colour', () => {
    const hues = [
      brickHue('normal', 1), brickHue('normal', 2), brickHue('normal', 3), brickHue('steel', 1),
      brickHue('explosive', 1), brickHue('moving', 1), brickHue('regen', 1), brickHue('hidden', 2),
    ];
    expect(new Set(hues).size).toBe(hues.length);
  });
  it('mixes colours', () => {
    expect(rgba('#FF0080', 0.5)).toBe('rgba(255,0,128,0.5)');
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#102030', 0)).toBe('#102030');
  });
});

describe('particles', () => {
  it('never exceeds its cap and reuses slots', () => {
    const p = new Particles(50);
    for (let i = 0; i < 20; i++) p.emit('shard', 0, 0, 30);
    expect(p.active).toBe(50);
    p.update(5);
    expect(p.active).toBe(0);
    p.emit('dot', 0, 0, 10);
    expect(p.active).toBe(10);
  });
  it('reduced density emits fewer', () => {
    const p = new Particles(100);
    p.density = 0.35;
    p.emit('spark', 0, 0, 20);
    expect(p.active).toBe(7);
  });
  it('default pool cap is 400', () => {
    const p = new Particles();
    p.emit('spark', 1, 1, 1000);
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
