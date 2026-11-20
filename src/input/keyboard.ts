import { Latch } from './latch';

/** Pure: held-key state to axis. Both held = 0. */
export function keyboardAxis(left: boolean, right: boolean): number {
  return left === right ? 0 : left ? -1 : 1;
}

export class KeyboardInput {
  readonly fire = new Latch();
  readonly pause = new Latch();
  private left = new Set<string>();
  private right = new Set<string>();

  private readonly onDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') this.left.add(k);
    else if (k === 'arrowright' || k === 'd') this.right.add(k);
    else if (k === ' ' || k === 'enter') {
      if (!e.repeat) this.fire.press();
    } else if (k === 'escape' || k === 'p') {
      if (!e.repeat) this.pause.press();
    } else return;
    e.preventDefault();
  };
  private readonly onUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.left.delete(k);
    this.right.delete(k);
  };
  private readonly onBlur = (): void => {
    this.left.clear();
    this.right.clear();
  };

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  axis(): number {
    return keyboardAxis(this.left.size > 0, this.right.size > 0);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
