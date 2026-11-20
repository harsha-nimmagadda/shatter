import { parseManifest } from './artLayout';

export interface AssetSet {
  /** Loaded images per manifest id (e.g. 'fill-brick1', 'paddle', 'icon-laser'). Missing ids are absent. */
  byId: Record<string, CanvasImageSource[]>;
  /** Images for an id; an empty array if there are none. */
  get(id: string): CanvasImageSource[];
}

export function makeAssetSet(byId: Record<string, CanvasImageSource[]> = {}): AssetSet {
  return { byId, get: (id) => byId[id] ?? [] };
}

export type ImageLoader = (url: string) => Promise<CanvasImageSource>;

const defaultLoader: ImageLoader = async (url) => {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
};

/** Loads every image listed in <base>manifest.json in parallel. Never throws; failures leave ids empty (one console.warn). */
export async function loadWorldAssets(base = './assets/world1/', loadImage: ImageLoader = defaultLoader): Promise<AssetSet> {
  const byId: Record<string, CanvasImageSource[]> = {};
  let failed = 0;
  try {
    const res = await fetch(`${base}manifest.json`);
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const manifest = parseManifest(await res.json());
    await Promise.all(
      Object.entries(manifest).map(async ([id, files]) => {
        const imgs = await Promise.all(
          files.map(async (f) => {
            try {
              return await loadImage(base + f);
            } catch {
              failed++;
              return null;
            }
          }),
        );
        const ok = imgs.filter((i): i is CanvasImageSource => i !== null);
        if (ok.length) byId[id] = ok;
      }),
    );
  } catch (e) {
    console.warn('Shatter: art assets unavailable, using procedural look.', e);
    return makeAssetSet(byId);
  }
  if (failed) console.warn(`Shatter: ${failed} art image(s) failed to load.`);
  return makeAssetSet(byId);
}

/** Intrinsic size of an image source (0x0 if unknown). */
export function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  const s = src as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const w = s.naturalWidth || s.width || 0;
  const h = s.naturalHeight || s.height || 0;
  return { w: Number(w), h: Number(h) };
}
