import type { View } from '../game/view';
import { Latch } from './latch';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const TAP_MAX_MS = 250;
export const TAP_MAX_PX = 12;

/** Relative drag target: paddle follows finger movement scaled by sensitivity, clamped. */
export function relativeDragX(
  startPaddleX: number,
  startFingerX: number,
  fingerX: number,
  sensitivity: number,
  playfieldW: number,
  paddleW: number,
): number {
  return clamp(startPaddleX + (fingerX - startFingerX) * sensitivity, paddleW / 2, playfieldW - paddleW / 2);
}

/** Pure: is this pointer-up a tap? */
export function isTap(durationMs: number, movedCssPx: number): boolean {
  return durationMs <= TAP_MAX_MS && movedCssPx < TAP_MAX_PX;
}

interface Active {
  id: number;
  startX: number;
  startClientX: number;
  startClientY: number;
  startPaddleX: number;
  startTime: number;
}

export class PointerInput {
  /** Latest steering target in logical units, or null if nothing is steering. */
  target: number | null = null;
  readonly fire = new Latch();
  /** When false, touches never steer (tilt mode). Set by Controls. */
  touchSteers = true;
  /** When false, touch pointers are ignored entirely (stick mode owns them). Mouse still works. */
  touchEnabled = true;
  /** Supplies the current paddle x (for relative drag). */
  getPaddleX: () => number = () => 270;
  getSensitivity: () => number = () => 1.5;
  paddleW = 96;
  playfieldW = 540;

  private active: Active | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: View,
  ) {
    const add = <K extends keyof HTMLElementEventMap>(k: K, fn: (e: HTMLElementEventMap[K]) => void): void => {
      canvas.addEventListener(k, fn as EventListener);
      this.cleanup.push(() => canvas.removeEventListener(k, fn as EventListener));
    };
    add('pointerdown', (e) => this.down(e));
    add('pointermove', (e) => this.move(e));
    add('pointerup', (e) => this.up(e));
    add('pointercancel', (e) => this.cancel(e));
  }

  private fromUi(e: Event): boolean {
    const t = e.target as Element | null;
    return !!t && t !== this.canvas && !!t.closest?.('#ui');
  }

  private down(e: PointerEvent): void {
    if (this.fromUi(e)) return;
    if (e.pointerType !== 'mouse' && !this.touchEnabled) return;
    if (e.pointerType === 'mouse') {
      this.target = this.view.toLogical(e.clientX, e.clientY).x;
      this.fire.press();
      return;
    }
    if (this.active) {
      // Second finger: fire.
      this.fire.press();
      return;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.active = {
      id: e.pointerId,
      startX: this.view.toLogical(e.clientX, e.clientY).x,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPaddleX: this.getPaddleX(),
      startTime: performance.now(),
    };
  }

  private move(e: PointerEvent): void {
    if (this.fromUi(e)) return;
    if (e.pointerType === 'mouse') {
      this.target = this.view.toLogical(e.clientX, e.clientY).x;
      return;
    }
    const a = this.active;
    if (!a || a.id !== e.pointerId || !this.touchSteers) return;
    const x = this.view.toLogical(e.clientX, e.clientY).x;
    this.target = relativeDragX(a.startPaddleX, a.startX, x, this.getSensitivity(), this.playfieldW, this.paddleW);
  }

  private up(e: PointerEvent): void {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    this.active = null;
    const moved = Math.hypot(e.clientX - a.startClientX, e.clientY - a.startClientY);
    if (isTap(performance.now() - a.startTime, moved)) this.fire.press();
  }

  private cancel(e: PointerEvent): void {
    if (this.active?.id === e.pointerId) this.active = null;
  }

  dispose(): void {
    for (const f of this.cleanup) f();
  }
}
