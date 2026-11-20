import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/engine';
import {
  bricksBounds,
  coverRect,
  parseManifest,
  pickIndex,
  placeMarginDoodles,
  textureWindow,
  type Rect,
} from '../src/render/artLayout';
import { loadWorldAssets } from '../src/render/assets';

describe('parseManifest', () => {
  it('reads ids and files', () => {
    expect(parseManifest({ paper: { group: 'paper', files: ['paper/a.webp', 'paper/b.webp'] } })).toEqual({
      paper: ['paper/a.webp', 'paper/b.webp'],
    });
  });
  it('tolerates garbage', () => {
    for (const g of [null, undefined, 5, 'x', [], [1], { a: null }, { a: 3 }, { a: { files: 'no' } }, { a: { files: [1, null, ''] } }]) {
      expect(parseManifest(g)).toEqual({});
    }
    expect(parseManifest({ a: { files: ['ok.webp', 7, 'http://evil/x.webp', '//evil/x'] } })).toEqual({ a: ['ok.webp'] });
  });
});

describe('textureWindow', () => {
  it('stays inside the texture for all seeds and rotations', () => {
    const rots = new Set<number>();
    for (let seed = 0; seed < 2000; seed++) {
      const w = textureWindow(seed * 7919, 512, 512);
      rots.add(w.rot);
      expect(w.sx).toBeGreaterThanOrEqual(0);
      expect(w.sy).toBeGreaterThanOrEqual(0);
      expect(w.sx + w.sw).toBeLessThanOrEqual(512 + 1e-9);
      expect(w.sy + w.sh).toBeLessThanOrEqual(512 + 1e-9);
      // After rotation the window is always landscape 140x70.
      expect(w.rot % 2 ? [w.sh, w.sw] : [w.sw, w.sh]).toEqual([140, 70]);
    }
    expect(rots.size).toBe(4);
  });
  it('is deterministic and clamps tiny textures', () => {
    expect(textureWindow(5, 512, 512)).toEqual(textureWindow(5, 512, 512));
    const t = textureWindow(9, 50, 30);
    expect(t.sx + t.sw).toBeLessThanOrEqual(50);
    expect(t.sy + t.sh).toBeLessThanOrEqual(30);
  });
  it('pickIndex stays in range', () => {
    for (let i = 0; i < 200; i++) expect(pickIndex(i * 31, 3)).toBeLessThan(3);
    expect(pickIndex(1, 0)).toBe(0);
  });
});

describe('coverRect', () => {
  it('covers the destination with matching aspect', () => {
    const r = coverRect(684, 1216, 540, 960);
    expect(r.w / r.h).toBeCloseTo(540 / 960, 3);
    const wide = coverRect(1000, 500, 100, 100);
    expect(wide.h).toBe(500);
    expect(wide.w).toBe(500);
  });
});

describe('placeMarginDoodles', () => {
  const grid: Rect = { x: 20, y: 120, w: 500, h: 156 };
  const forbidden: Rect[] = [
    { x: 0, y: 0, w: CONFIG.width, h: CONFIG.topWall + 8 },
    { x: 52, y: 0, w: 18, h: CONFIG.height },
    { x: 10, y: 104, w: 520, h: 186 },
    { x: 0, y: CONFIG.paddleY - 60, w: CONFIG.width, h: 200 },
  ];
  it('avoids HUD, grid and edges, and is seeded', () => {
    for (let seed = 1; seed < 200; seed++) {
      const ds = placeMarginDoodles({ seed, count: 5, imageCount: 9, width: CONFIG.width, height: CONFIG.height, forbidden, leftStrip: [4, 50] });
      expect(ds.length).toBeGreaterThanOrEqual(3);
      for (const d of ds) {
        const half = d.size / 2;
        expect(d.size).toBeGreaterThanOrEqual(28);
        expect(d.size).toBeLessThanOrEqual(40);
        expect(d.y - half).toBeGreaterThan(CONFIG.topWall);
        expect(d.x - half).toBeGreaterThanOrEqual(0);
        expect(d.x + half).toBeLessThanOrEqual(CONFIG.width);
        expect(d.y + half).toBeLessThanOrEqual(CONFIG.height);
        const hitsGrid = d.x + half > grid.x && d.x - half < grid.x + grid.w && d.y + half > grid.y && d.y - half < grid.y + grid.h;
        expect(hitsGrid).toBe(false);
        expect(d.image).toBeGreaterThanOrEqual(0);
        expect(d.image).toBeLessThan(9);
      }
    }
    const a = placeMarginDoodles({ seed: 3, count: 4, imageCount: 4, width: 540, height: 960, forbidden });
    expect(a).toEqual(placeMarginDoodles({ seed: 3, count: 4, imageCount: 4, width: 540, height: 960, forbidden }));
  });
  it('returns nothing without images', () => {
    expect(placeMarginDoodles({ seed: 1, count: 4, imageCount: 0, width: 540, height: 960, forbidden })).toEqual([]);
  });
  it('bricksBounds', () => {
    expect(bricksBounds([])).toBeNull();
    expect(bricksBounds([{ x: 1, y: 2, w: 3, h: 4 }, { x: 10, y: 0, w: 1, h: 1 }])).toEqual({ x: 1, y: 0, w: 10, h: 6 });
  });
});

describe('loadWorldAssets', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('never throws and warns once when the manifest is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    const a = await loadWorldAssets('./x/');
    expect(a.get('paper')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it('skips failed images and loads the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ paper: { files: ['p/1.webp', 'p/bad.webp'] }, title: { files: ['t.webp'] } }) }));
    const a = await loadWorldAssets('./x/', async (url) => {
      if (url.includes('bad')) throw new Error('nope');
      return { url } as unknown as CanvasImageSource;
    });
    expect(a.get('paper')).toHaveLength(1);
    expect(a.get('title')).toHaveLength(1);
    expect(a.get('nothing')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
