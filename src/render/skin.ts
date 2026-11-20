export type TextureKey = 'brick1' | 'brick2' | 'brick3' | 'steel' | 'paddle' | 'paper';

/** Everything the renderer needs to know about colours and styles; swap it to re-theme (or add textures). */
export interface Skin {
  paper: string;
  rule: string;
  margin: string;
  ink: string;
  /** Soft graphite for smudges and specks. */
  graphite: string;
  brick: Record<1 | 2 | 3, string>;
  steel: string;
  paddle: string;
  ball: string;
  /** Eraser crumb colour. */
  eraser: string;
  font: string;
  /** When present, fills use a pattern from the image (clipped to the wobbly outline) instead of hatching. */
  textures?: Partial<Record<TextureKey, CanvasImageSource>>;
}

export const NOTEBOOK_SKIN: Skin = {
  paper: '#fbf6e6',
  rule: '#7aa6d8',
  margin: '#d9605a',
  ink: '#2b2b2b',
  graphite: '#4a4a4f',
  brick: { 1: '#f0b04e', 2: '#6fb0dc', 3: '#e26f6f' },
  steel: '#8b9099',
  paddle: '#3b3b40',
  ball: '#33343a',
  eraser: '#e9a3a0',
  font: '"Patrick Hand", "Comic Sans MS", "Segoe Print", cursive',
};

const patterns = new WeakMap<object, CanvasPattern>();

/** Returns a (cached) repeating pattern for the skin texture, or null when the skin has none. */
export function texturePattern(ctx: CanvasRenderingContext2D, skin: Skin, key: TextureKey): CanvasPattern | null {
  const img = skin.textures?.[key];
  if (!img) return null;
  let p = patterns.get(img as object);
  if (!p) {
    p = ctx.createPattern(img, 'repeat') ?? undefined;
    if (!p) return null;
    patterns.set(img as object, p);
  }
  return p;
}
