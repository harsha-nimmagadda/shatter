import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

/**
 * iOS startup images (public/splash/) are only ever fetched by iOS itself when the app is added to the Home Screen
 * (one of 17 sizes, ~3.7 MB in total), so they are not worth precaching on every device.
 */
export const isStartupImage = (p: string): boolean => p.startsWith('splash/');

/** Pure: the URLs to precache (relative to the SW scope) for a list of emitted file paths. */
export function precacheList(files: readonly string[]): string[] {
  const out = new Set<string>(['./']);
  for (const f of files) {
    const p = f.replace(/\\/g, '/').replace(/^\.?\//, '');
    if (p === '' || p === 'sw.js' || p.endsWith('.map') || isStartupImage(p)) continue;
    out.add(`./${p}`);
  }
  return [...out].sort();
}

/** Pure: cache name derived from the file list and per-file content digests (any change gives a new name). */
export function cacheName(list: readonly string[], digests: Readonly<Record<string, string>> = {}): string {
  const h = createHash('sha256');
  for (const u of list) h.update(`${u}\0${digests[u] ?? ''}\n`);
  return `shatter-${h.digest('hex').slice(0, 12)}`;
}

/** Pure: fills the template placeholders. */
export function renderSw(template: string, list: readonly string[], name: string): string {
  return template
    .replace("/*CACHE*/ 'shatter-dev'", JSON.stringify(name))
    .replace('/*PRECACHE*/ []', JSON.stringify(list, null, 2));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Writes dist/sw.js at the end of the build with the full precache list and a content-derived cache name. */
export function swPlugin(templatePath = 'tools/sw.template.js'): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'shatter-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
      root = c.root;
    },
    closeBundle() {
      const dist = join(root, outDir);
      const files = walk(dist).map((f) => relative(dist, f));
      const list = precacheList(files);
      const digests: Record<string, string> = {};
      for (const u of list) {
        if (u === './') continue;
        digests[u] = createHash('sha256').update(readFileSync(join(dist, u))).digest('hex');
      }
      const sw = renderSw(readFileSync(join(root, templatePath), 'utf8'), list, cacheName(list, digests));
      writeFileSync(join(dist, 'sw.js'), sw);
    },
  };
}
