import type { View } from '../game/view';
import { Latch } from './latch';
import { isTap } from './pointer';

export const STICK_RADIUS = 56;
export const STICK_DEADZONE = 0.12;
/** Fraction of the screen width (from the left) where a touch spawns the stick. */
export const STICK_ZONE = 0.6;
/** Playfield widths per second... full deflection crosses the 540 field in about 0.55 s at 1x. */
export const STICK_FULL_SPEED = 540 / 0.55;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Pure: horizontal knob offset (logical px) to an axis in [-1, 1] with dead zone and a gentle curve. */
export function stickAxis(dx: number, radius = STICK_RADIUS, dead = STICK_DEADZONE): number {
  const n = clamp(dx / radius, -1, 1);
  const a = Math.abs(n);
  if (a < dead) return 0;
  const t = (a - dead) / (1 - dead);
  return Math.sign(n) * (0.55 * t + 0.45 * t * t);
}

/** Pure: knob position (logical px) clamped to the radius circle around the base. */
export function clampKnob(dx: number, dy: number, radius = STICK_RADIUS): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (d <= radius) return { x: dx, y: dy };
  return { x: (dx / d) * radius, y: (dy / d) * radius };
}

/** Pure: engine moveAxis for a stick axis. The engine moves at moveAxis * paddleKeySpeed, so scale to the stick speed. */
export function stickMoveAxis(axis: number, speedMul: number, keySpeed: number): number {
  return (axis * speedMul * STICK_FULL_SPEED) / keySpeed;
}

/** Floating thumbstick: touch the left 60% to spawn it, drag for an analog axis; any other tap fires. */
export class StickInput {
  readonly fire = new Latch();
  private enabled = false;
  private ghost = false;
  private id: number | null = null;
  private baseX = 0;
  private baseY = 0;
  private downT = 0;
  private downX = 0;
  private downY = 0;
  private dx = 0;
  private readonly el: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: View,
    host: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'ui-stick';
    this.el.setAttribute('aria-hidden', 'true');
    this.knob = document.createElement('div');
    this.knob.className = 'ui-stick-knob';
    this.el.append(this.knob);
    host.appendChild(this.el);
    const add = (k: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', fn: (e: PointerEvent) => void): void => {
      canvas.addEventListener(k, fn as EventListener);
      this.cleanup.push(() => canvas.removeEventListener(k, fn as EventListener));
    };
    add('pointerdown', (e) => this.down(e));
    add('pointermove', (e) => this.move(e));
    add('pointerup', (e) => this.up(e));
    add('pointercancel', (e) => this.cancelId(e.pointerId));
    this.render();
  }

  /** Current axis in [-1, 1]. */
  axis(): number {
    return this.id === null ? 0 : stickAxis(this.dx / this.cssPerLogical());
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.cancel();
    this.render();
  }

  /** Show the faint idle hint at bottom-left. */
  setGhost(on: boolean): void {
    if (on === this.ghost) return;
    this.ghost = on;
    this.render();
  }

  /** Release the thumb (overlay opened, mode changed). */
  cancel(): void {
    if (this.id === null) return;
    this.id = null;
    this.dx = 0;
    this.render();
  }

  private cssPerLogical(): number {
    return this.view.cssScale || 1;
  }

  private inZone(e: PointerEvent): boolean {
    const r = this.canvas.getBoundingClientRect();
    return e.clientX < r.left + r.width * STICK_ZONE;
  }

  private fromUi(e: Event): boolean {
    const t = e.target as Element | null;
    return !!t && t !== this.canvas && !!t.closest?.('#ui');
  }

  private down(e: PointerEvent): void {
    if (!this.enabled || e.pointerType === 'mouse' || this.fromUi(e)) return;
    if (this.id !== null || !this.inZone(e)) {
      this.fire.press();
      return;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.id = e.pointerId;
    this.baseX = this.downX = e.clientX;
    this.baseY = this.downY = e.clientY;
    this.downT = performance.now();
    this.dx = 0;
    this.render();
  }

  private move(e: PointerEvent): void {
    if (!this.enabled || e.pointerId !== this.id) return;
    const r = this.cssPerLogical() * STICK_RADIUS;
    const k = clampKnob(e.clientX - this.baseX, e.clientY - this.baseY, r);
    this.dx = k.x;
    this.render(k.y);
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.id) return;
    const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
    if (isTap(performance.now() - this.downT, moved)) this.fire.press();
    this.cancelId(e.pointerId);
  }

  private cancelId(id: number): void {
    if (id === this.id) this.cancel();
  }

  private render(knobY = 0): void {
    const s = this.el.style;
    const active = this.id !== null;
    this.el.classList.toggle('on', this.enabled && active);
    this.el.classList.toggle('ghost', this.enabled && !active && this.ghost);
    const px = this.cssPerLogical() * STICK_RADIUS;
    s.setProperty('--stick-r', `${px}px`);
    if (active) {
      s.left = `${this.baseX}px`;
      s.top = `${this.baseY}px`;
      this.knob.style.transform = `translate(${this.dx}px, ${knobY}px)`;
    } else {
      s.left = '';
      s.top = '';
      this.knob.style.transform = '';
    }
  }

  dispose(): void {
    for (const f of this.cleanup) f();
    this.el.remove();
  }
}
