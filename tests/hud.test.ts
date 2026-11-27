import { describe, expect, it } from 'vitest';
import { MIN_TOUCH, computeHudLayout, type HudLayout, type SafeInsets } from '../src/game/hud';
import { fitPlayfield } from '../src/game/view';

const NO_SAFE: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const SIZES: [string, number, number][] = [
  ['320x480', 320, 480],
  ['360x640', 360, 640],
  ['390x844', 390, 844],
  ['1024x768', 1024, 768],
  ['768x1024', 768, 1024],
  ['844x390', 844, 390],
  ['640x360', 640, 360],
];

function layout(w: number, h: number, fs = true, safe = NO_SAFE): HudLayout {
  const f = fitPlayfield(w, h);
  return computeHudLayout({ cssW: w, cssH: h, scale: f.scale, offsetX: f.offsetX, offsetY: f.offsetY, safe, fullscreenSupported: fs });
}

describe('HUD band layout', () => {
  for (const [name, w, h] of SIZES) {
    it(`${name}: slots are ordered and never overlap`, () => {
      const f = fitPlayfield(w, h);
      const l = layout(w, h);
      const toL = (x: number): number => (x - f.offsetX) / f.scale;
      const pauseR = toL(l.pause.x + l.v / 2);
      const fsL = toL(l.fs!.x - l.v / 2);
      expect(pauseR).toBeLessThan(l.scoreX);
      expect(l.livesRight).toBeLessThanOrEqual(fsL);
      // Hearts (up to 6 at 23 px) stay clear of the centred level label (~60 wide) and the score (~110 wide).
      expect(l.livesRight - 6 * 23).toBeGreaterThan(270 + 30);
      expect(l.scoreX + 120).toBeLessThan(270 - 30);
      expect(l.fs!.x).toBeGreaterThan(l.pause.x);
    });
    it(`${name}: buttons sit inside the playfield with a 44px touch target`, () => {
      const f = fitPlayfield(w, h);
      const l = layout(w, h);
      expect(l.touch).toBeGreaterThanOrEqual(MIN_TOUCH);
      expect(l.v).toBeGreaterThanOrEqual(22);
      expect(l.v).toBeLessThanOrEqual(34);
      expect(l.pause.x - l.v / 2).toBeGreaterThanOrEqual(f.offsetX - 0.5);
      expect(l.fs!.x + l.v / 2).toBeLessThanOrEqual(w - f.offsetX + 0.5);
      expect(l.pause.y - l.v / 2).toBeGreaterThanOrEqual(f.offsetY - 0.5);
      // The visual button never reaches the playfield's top wall (logical y 64).
      expect((l.pause.y + l.v / 2 - f.offsetY) / f.scale).toBeLessThan(64 + 8);
    });
  }

  it('buttons track the playfield, not the window edge (pillarboxed landscape)', () => {
    const f = fitPlayfield(1024, 768);
    expect(f.offsetX).toBeGreaterThan(200);
    const l = layout(1024, 768);
    expect(l.pause.x).toBeGreaterThan(f.offsetX);
    expect(l.fs!.x).toBeLessThan(1024 - f.offsetX);
  });

  it('collapses the fullscreen slot when unsupported and moves the hearts right', () => {
    const a = layout(360, 640, true);
    const b = layout(360, 640, false);
    expect(b.fs).toBeNull();
    expect(b.livesRight).toBeGreaterThan(a.livesRight + 30);
    expect(b.livesRight).toBe(b.edgeRight);
  });

  it('360x640 reproduces the reported case without overlap: hearts end before the fullscreen button starts', () => {
    const f = fitPlayfield(360, 640);
    const l = layout(360, 640);
    const fsLeftLogical = (l.fs!.x - l.v / 2 - f.offsetX) / f.scale;
    expect(l.livesRight).toBeLessThanOrEqual(fsLeftLogical);
  });

  it('respects safe-area insets where the playfield reaches the screen edge', () => {
    const safe: SafeInsets = { top: 47, right: 0, bottom: 34, left: 0 };
    const none = layout(360, 640);
    const notch = layout(360, 640, true, safe);
    expect(notch.pause.y).toBeGreaterThanOrEqual(47 + notch.v / 2);
    expect(notch.pause.y).toBeGreaterThan(none.pause.y + 30);
    // Letterboxed screens already clear the notch: no extra shift.
    const f = fitPlayfield(390, 844);
    expect(f.offsetY).toBeGreaterThan(47);
    expect(layout(390, 844, true, { top: 47, right: 0, bottom: 34, left: 0 }).pause.y).toBeCloseTo(layout(390, 844).pause.y);
    // Landscape notch on the side.
    const side = layout(640, 360, true, { top: 0, right: 44, bottom: 21, left: 44 });
    expect(side.pause.x).toBeGreaterThanOrEqual(44);
  });

  it('a degenerate scale does not produce NaN', () => {
    const l = computeHudLayout({ cssW: 0, cssH: 0, scale: 0, offsetX: 0, offsetY: 0, safe: NO_SAFE, fullscreenSupported: true });
    for (const v of [l.cy, l.scoreX, l.livesRight, l.pause.x, l.pause.y]) expect(Number.isFinite(v)).toBe(true);
  });
});
