import { describe, expect, it } from 'vitest';
import { cacheName, precacheList, renderSw } from '../tools/swPlugin';

describe('service worker precache', () => {
  const files = ['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'assets/index-abc123.js', 'assets/index-abc123.css', 'assets/synthWorker-9f.js', 'assets/index-abc123.js.map'];

  it('lists every emitted file relative to scope, plus the root, minus sw.js and maps', () => {
    const list = precacheList(files);
    expect(list).toContain('./');
    expect(list).toContain('./index.html');
    expect(list).toContain('./assets/index-abc123.js');
    expect(list).toContain('./icon.svg');
    expect(list).not.toContain('./sw.js');
    expect(list.some((u) => u.endsWith('.map'))).toBe(false);
    expect(list).toHaveLength(7);
    expect([...list].sort()).toEqual(list);
  });

  it('normalises windows separators and leading ./', () => {
    expect(precacheList(['assets\\a.js', './b.css'])).toEqual(['./', './assets/a.js', './b.css']);
  });

  it('derives a stable cache name that changes with the list or a digest', () => {
    const list = precacheList(files);
    const a = cacheName(list, { './index.html': 'x' });
    expect(a).toMatch(/^shatter-[0-9a-f]{12}$/);
    expect(cacheName(list, { './index.html': 'x' })).toBe(a);
    expect(cacheName(list, { './index.html': 'y' })).not.toBe(a);
    expect(cacheName([...list, './assets/new.js'], { './index.html': 'x' })).not.toBe(a);
  });

  it('fills both template placeholders', () => {
    const t = "const CACHE = /*CACHE*/ 'shatter-dev';\nconst PRECACHE = /*PRECACHE*/ [];";
    const out = renderSw(t, ['./', './a.js'], 'shatter-1');
    expect(out).toContain('const CACHE = "shatter-1";');
    expect(out).toContain('"./a.js"');
    expect(out).not.toContain('/*');
  });
});
