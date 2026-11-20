import type { Input } from '../engine';
import type { View } from '../game/view';

/** Temporary keyboard/pointer input (milestone 2 replaces it with tilt/drag). */
export function createTempInput(canvas: HTMLCanvasElement, view: View): { sample(): Input } {
  let paddleX: number | null = null;
  let fire = false;
  const keys = new Set<string>();

  const point = (e: PointerEvent): void => {
    paddleX = view.toLogical(e.clientX, e.clientY).x;
  };
  canvas.addEventListener('pointermove', point);
  canvas.addEventListener('pointerdown', (e) => {
    point(e);
    fire = true;
  });
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'arrowright' || k === 'a' || k === 'd') {
      keys.add(k);
      paddleX = null; // keyboard takes over until the pointer moves again
    } else if ((k === ' ' || k === 'enter') && !e.repeat) {
      fire = true;
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  return {
    sample(): Input {
      const left = keys.has('arrowleft') || keys.has('a');
      const right = keys.has('arrowright') || keys.has('d');
      const input: Input = { paddleX, moveDir: left === right ? 0 : left ? -1 : 1, fire };
      fire = false;
      return input;
    },
  };
}
