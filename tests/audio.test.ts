import { describe, expect, it } from 'vitest';
import { applyFades, normalizePeak, peak, pickVariant, processSample, trimSilence } from '../src/audio/dsp';
import { panFromX, soundsForEvents } from '../src/audio/events';
import { SOUND_IDS } from '../src/audio/sound';
import { PlayLimiter } from '../src/audio/limiter';
import { parseSettings } from '../src/input/settings';
import type { GameEvent } from '../src/engine';

const ev = (type: GameEvent['type'], extra: Partial<GameEvent> = {}): GameEvent => ({ type, x: 100, y: 100, ...extra });
const ids = (e: GameEvent[], bricks: { id: number; type: string }[] = []) =>
  soundsForEvents(e, { bricks: bricks as never }).map((c) => c.id);

describe('dsp', () => {
  it('trims leading and trailing silence', () => {
    const a = new Float32Array(100);
    a[40] = 0.5;
    a[59] = -0.5;
    a[10] = 0.001; // below -45 dB (0.0056)
    const [t] = trimSilence([a]);
    expect(t.length).toBe(20);
    expect(t[0]).toBe(0.5);
  });
  it('keeps an all-silent clip', () => {
    expect(trimSilence([new Float32Array(10)])[0].length).toBe(10);
  });
  it('normalizes the peak to -1 dBFS', () => {
    const a = Float32Array.from([0.1, -0.2, 0.05]);
    normalizePeak([a], -1);
    expect(peak([a])).toBeCloseTo(Math.pow(10, -1 / 20), 5);
    const z = new Float32Array(3);
    normalizePeak([z]);
    expect(peak([z])).toBe(0);
  });
  it('fades the first and last 5 ms', () => {
    const a = new Float32Array(1000).fill(1);
    applyFades([a], 1000, 5);
    expect(a[0]).toBe(0);
    expect(a[999]).toBe(0);
    expect(a[2]).toBeCloseTo(0.4);
    expect(a[500]).toBe(1);
  });
  it('processSample runs the whole chain', () => {
    const a = new Float32Array(48000);
    a.fill(0.2, 10000, 20000);
    const [o] = processSample([a], 48000);
    expect(o.length).toBe(10000);
    expect(peak([o])).toBeLessThanOrEqual(1);
    expect(peak([o])).toBeGreaterThan(0.85);
  });
});

describe('pickVariant', () => {
  it('never repeats the last variant when n > 1', () => {
    for (const n of [2, 3, 4]) {
      for (let last = 0; last < n; last++) {
        for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
          const v = pickVariant(n, last, () => r);
          expect(v).not.toBe(last);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(n);
        }
      }
    }
    expect(pickVariant(1, 0)).toBe(0);
    expect(pickVariant(3, -1, () => 0.999)).toBe(2);
  });
});

describe('PlayLimiter', () => {
  it('enforces per-id spacing', () => {
    let t = 0;
    const l = new PlayLimiter(() => t, 35, 12);
    expect(l.tryStart('a', 100)).toBe(true);
    t = 20;
    expect(l.tryStart('a', 100)).toBe(false);
    expect(l.tryStart('b', 100)).toBe(true);
    t = 36;
    expect(l.tryStart('a', 100)).toBe(true);
  });
  it('caps total voices and frees them when they end', () => {
    let t = 0;
    const l = new PlayLimiter(() => t, 35, 3);
    expect(l.tryStart('a', 500)).toBe(true);
    expect(l.tryStart('b', 500)).toBe(true);
    expect(l.tryStart('c', 500)).toBe(true);
    expect(l.tryStart('d', 500)).toBe(false);
    t = 501;
    expect(l.voices).toBe(0);
    expect(l.tryStart('d', 500)).toBe(true);
  });
});

describe('soundsForEvents', () => {
  it('maps simple events', () => {
    expect(ids([ev('wall'), ev('paddle'), ev('launch'), ev('explode'), ev('staple'), ev('eraser')])).toEqual([
      'wall', 'paddle', 'launch', 'explode', 'staple', 'eraser',
    ]);
    expect(ids([ev('clipLoose'), ev('clipPop'), ev('splash'), ev('combo', { value: 2 }), ev('extraLife')])).toEqual([
      'cliploose', 'clippop', 'splash', 'combo', 'goldstar',
    ]);
    expect(ids([ev('lifeLost'), ev('gameover'), ev('won'), ev('regen'), ev('reveal'), ev('net')])).toEqual([
      'lifelost', 'gameover', 'won', 'regen', 'reveal', 'net',
    ]);
    expect(ids([ev('powerMiss'), ev('effectEnd')])).toEqual([]);
  });
  it('brick hits: steel vs normal, skipped when the brick broke', () => {
    const bricks = [{ id: 1, type: 'steel' }, { id: 2, type: 'normal' }, { id: 3, type: 'normal' }];
    expect(ids([ev('brickHit', { brickId: 1 })], bricks)).toEqual(['steel']);
    expect(ids([ev('brickHit', { brickId: 2 })], bricks)).toEqual(['brick']);
    expect(ids([ev('brickHit', { brickId: 3 }), ev('brickBreak', { brickId: 3 })], bricks)).toEqual(['break']);
  });
  it('several breaks in one frame become break + one shred', () => {
    const e = [1, 2, 3, 4].map((i) => ev('brickBreak', { brickId: i }));
    expect(ids(e)).toEqual(['break', 'shred']);
  });
  it('good and bad power-ups', () => {
    expect(ids([ev('powerup', { power: 'ruler' })])).toEqual(['powerup']);
    expect(ids([ev('powerup', { power: 'sharpener' })])).toEqual(['powerdown']);
    const specific = { scissors: 'snip', paperclip: 'paperclip', goldstar: 'goldstar', redpen: 'redpen' } as const;
    for (const [p, id] of Object.entries(specific)) {
      expect(ids([ev('powerup', { power: p as keyof typeof specific })])).toEqual([id]);
    }
    expect(ids([ev('powerup', { power: 'goldstar' }), ev('extraLife')])).toEqual(['goldstar']);
  });
  it('passes x and pans subtly', () => {
    expect(soundsForEvents([ev('wall', { x: 7 })])[0].x).toBe(7);
    expect(panFromX(0, 540)).toBeCloseTo(-0.4);
    expect(panFromX(540, 540)).toBeCloseTo(0.4);
    expect(panFromX(270, 540)).toBeCloseTo(0);
    expect(panFromX(undefined)).toBe(0);
  });
});

describe('new sound ids', () => {
  it('are all registered for the synth fallback', () => {
    for (const id of ['staple', 'cliploose', 'clippop', 'snip', 'splash', 'paperclip', 'goldstar', 'redpen', 'combo']) {
      expect(SOUND_IDS as readonly string[]).toContain(id);
    }
  });
});

describe('sound settings', () => {
  it('parses muted and volume with defaults', () => {
    const d = parseSettings(null, false);
    expect(d.muted).toBe(false);
    expect(d.volume).toBeCloseTo(0.8);
    const s = parseSettings('{"muted":true,"volume":0.3}', false);
    expect(s.muted).toBe(true);
    expect(s.volume).toBe(0.3);
    expect(parseSettings('{"muted":"x","volume":9}', false)).toMatchObject({ muted: false, volume: 1 });
    expect(parseSettings('{"volume":"loud"}', false).volume).toBeCloseTo(0.8);
  });
});
