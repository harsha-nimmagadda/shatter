import { describe, expect, it } from 'vitest';
import { SFX, SONGS, noteHz, parseBar, renderSfx, renderSong, songSeconds } from '../src/audio/synth';
import { breakPitch, comboPitch, panFromX, soundsForEvents } from '../src/audio/events';
import { SOUND_IDS } from '../src/audio/sound';
import { PlayLimiter } from '../src/audio/limiter';
import { parseSettings } from '../src/input/settings';
import type { GameEvent } from '../src/engine';

const ev = (type: GameEvent['type'], extra: Partial<GameEvent> = {}): GameEvent => ({ type, x: 100, y: 100, ...extra });
const ids = (e: GameEvent[], bricks: { id: number; type: string }[] = []) =>
  soundsForEvents(e, { bricks: bricks as never }).map((c) => c.id);

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

describe('synth', () => {
  it('has a recipe for every sound id, and renders each to a short, non-silent, unclipped clip', () => {
    for (const id of SOUND_IDS) {
      expect(SFX[id], id).toBeDefined();
      const buf = renderSfx(SFX[id].tones, 22050, SFX[id].fx);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      expect(peak, id).toBeGreaterThan(0.5);
      expect(peak, id).toBeLessThanOrEqual(1);
      expect(buf.length / 22050, id).toBeLessThan(2.5);
    }
  });
  it('is deterministic', () => {
    const a = renderSfx(SFX.explode.tones, 8000, SFX.explode.fx);
    const b = renderSfx(SFX.explode.tones, 8000, SFX.explode.fx);
    expect(a).toEqual(b);
  });
  it('parses notes and bars', () => {
    expect(noteHz('A4')).toBeCloseTo(440);
    expect(noteHz('C5')).toBeCloseTo(523.25, 1);
    expect(noteHz('F#5')).toBeCloseTo(739.99, 1);
    expect(parseBar('E5:4 R:4 G5:8')).toEqual([['E5', 4], [null, 4], ['G5', 8]]);
    expect(() => parseBar('E5:4')).toThrow();
  });
  it('every song bar fills 16 sixteenths and lead/chords line up', () => {
    for (const s of SONGS) {
      expect(s.lead.length).toBe(s.chords.length);
      for (const bar of s.lead) expect(() => parseBar(bar)).not.toThrow();
    }
  });
  it('renders a seamless stereo loop of the song length', () => {
    const s = SONGS[1];
    const [l, r] = renderSong(s, 4000);
    expect(l.length).toBe(Math.round(songSeconds(s) * 4000));
    expect(r.length).toBe(l.length);
    let peak = 0;
    for (const v of l) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(0.86);
  });
});

describe('musical pitch', () => {
  it('climbs a pentatonic ladder with the rally and caps', () => {
    expect(breakPitch(1)).toBe(1);
    expect(breakPitch(4)).toBeCloseTo(Math.pow(2, 7 / 12));
    expect(breakPitch(99)).toBeCloseTo(4);
    expect(breakPitch(0)).toBe(1);
    const p = soundsForEvents([ev('brickBreak', { brickId: 1 })], { bricks: [], combo: 6 });
    expect(p[0].pitch).toBeCloseTo(2);
    expect(comboPitch(1.5)).toBe(1);
    expect(comboPitch(3)).toBeGreaterThan(comboPitch(2));
    expect(soundsForEvents([ev('combo', { value: 3 })])[0].pitch).toBeCloseTo(comboPitch(3));
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
    expect(d).toMatchObject({ music: true, musicVolume: 0.5, reducedFx: false, haptics: true });
    expect(parseSettings('{"music":false,"musicVolume":2,"reducedFx":true,"haptics":0}', false)).toMatchObject({
      music: false, musicVolume: 1, reducedFx: true, haptics: true,
    });
  });
});
