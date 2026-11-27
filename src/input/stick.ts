import { Latch } from './latch';

/** Dead zone as a fraction of the radius (small: the response curve already gives fine control near the centre). */
export const STICK_DEADZONE = 0.08;
/** Response curve exponent: small deflections give fine control, full deflection is full speed. */
export const STICK_CURVE = 1.6;
/** Paddle velocity follows the knob with this time constant (seconds). */
export const STICK_EASE_S = 0.06;
/** A touch released within this long and moved less than this is a tap = FIRE. */
export const STICK_TAP_MS = 180;
export const STICK_TAP_PX = 10;
/** Full deflection crosses the 540 field in about 0.55 s at 1x. */
export const STICK_FULL_SPEED = 540 / 0.55;
/** Stick radius: this fraction of the screen's short side, but never below STICK_MIN_RADIUS CSS px. */
export const STICK_RADIUS_FRAC = 0.11;
export const STICK_MIN_RADIUS = 44;
/** localStorage flag: set once the player has used the stick, so the "hold anywhere" text shows only on the first game. */
export const STICK_HINT_KEY = 'shatter.stickhint.v1';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Pure: stick radius in CSS px for a screen (uses the short side so landscape tablets stay sensible). */
export function stickRadius(screenW: number, screenH = screenW): number {
  return Math.max(STICK_MIN_RADIUS, STICK_RADIUS_FRAC * Math.min(screenW, screenH));
}

/** Pure: horizontal knob offset to an axis in [-1, 1]: dead zone, rescaled, then the power curve. */
export function stickAxis(dx: number, radius: number, dead = STICK_DEADZONE): number {
  const n = clamp(dx / radius, -1, 1);
  const a = Math.abs(n);
  if (a <= dead) return 0;
  const t = (a - dead) / (1 - dead);
  return Math.sign(n) * Math.pow(t, STICK_CURVE);
}

/**
 * Pure: the base follows the thumb once it is dragged beyond the radius, so the stick never "runs out".
 * Returns the (possibly moved) base so that the thumb sits exactly on the ring.
 */
export function followBase(baseX: number, baseY: number, px: number, py: number, radius: number): { x: number; y: number } {
  const dx = px - baseX;
  const dy = py - baseY;
  const d = Math.hypot(dx, dy);
  if (d <= radius) return { x: baseX, y: baseY };
  const k = (d - radius) / d;
  return { x: baseX + dx * k, y: baseY + dy * k };
}

/** Pure: knob position (px) clamped to the radius circle around the base. */
export function clampKnob(dx: number, dy: number, radius: number): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (d <= radius) return { x: dx, y: dy };
  return { x: (dx / d) * radius, y: (dy / d) * radius };
}

/** Pure: frame-rate independent ease of the paddle velocity towards the knob. */
export function easeAxis(prev: number, target: number, dt: number, tc = STICK_EASE_S): number {
  if (dt <= 0) return prev;
  const next = prev + (target - prev) * (1 - Math.exp(-dt / tc));
  return Math.abs(next - target) < 0.002 ? target : next;
}

/** Pure: is this release a tap (quick and barely moved)? */
export function isStickTap(durationMs: number, movedPx: number): boolean {
  return durationMs <= STICK_TAP_MS && movedPx < STICK_TAP_PX;
}

/** Pure: engine moveAxis for a stick axis. The engine moves at moveAxis * paddleKeySpeed, so scale to the stick speed. */
export function stickMoveAxis(axis: number, speedMul: number, keySpeed: number): number {
  return (axis * speedMul * STICK_FULL_SPEED) / keySpeed;
}

/**
 * Floating thumbstick: the first finger spawns it wherever it lands (HUD buttons excluded: they are DOM and swallow
 * their own touches). A quick tap fires; a second finger tapping anywhere fires too.
 */
export class StickInput {
  readonly fire = new Latch();
  /** Called once, the first time the player actually touches the stick (to retire the first-game hint). */
  onFirstTouch: (() => void) | null = null;
  private enabled = false;
  private ghost = false;
  private ghostText = false;
  private id: number | null = null;
  private baseX = 0;
  private baseY = 0;
  private knobX = 0;
  private downT = 0;
  private downX = 0;
  private downY = 0;
  private radius = STICK_MIN_RADIUS;
  private smoothed = 0;
  private readonly el: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly hintText: HTMLElement;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    host: HTMLElement,
  ) {
    const mk = (): { base: HTMLElement; knob: HTMLElement } => {
      const base = document.createElement('div');
      base.className = 'ui-stick';
      base.setAttribute('aria-hidden', 'true');
      const k = document.createElement('div');
      k.className = 'ui-stick-knob';
      base.append(k);
      return { base, knob: k };
    };
    const live = mk();
    this.el = live.base;
    this.knob = live.knob;
    // Idle hint: a ghost stick centred at the bottom during serve, with a caption on the very first stick game.
    this.hint = document.createElement('div');
    this.hint.className = 'ui-stick-hint';
    this.hint.setAttribute('aria-hidden', 'true');
    const ghost = mk();
    ghost.base.classList.add('ghost');
    this.hintText = document.createElement('p');
    this.hintText.textContent = 'Hold anywhere to steer · tap to launch';
    this.hint.append(ghost.base, this.hintText);
    host.append(this.hint, this.el);
    const add = (k: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', fn: (e: PointerEvent) => void): void => {
      canvas.addEventListener(k, fn as EventListener);
      this.cleanup.push(() => canvas.removeEventListener(k, fn as EventListener));
    };
    add('pointerdown', (e) => this.down(e));
    add('pointermove', (e) => this.move(e));
    add('pointerup', (e) => this.up(e));
    add('pointercancel', (e) => this.cancelId(e.pointerId));
    this.sizeTo(stickRadius(window.innerWidth, window.innerHeight));
    this.render();
  }

  /** Current eased axis in [-1, 1]. */
  axis(): number {
    return this.smoothed;
  }

  /** Once per frame: ease the paddle velocity towards the knob. */
  update(dt: number): void {
    const target = this.id === null ? 0 : stickAxis(this.knobX, this.radius);
    this.smoothed = easeAxis(this.smoothed, target, dt);
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      this.cancel();
      this.smoothed = 0;
    }
    this.render();
  }

  /** Show the faint idle hint at the bottom centre (during serve); `withText` adds the first-game caption. */
  setGhost(on: boolean, withText = false): void {
    if (on === this.ghost && withText === this.ghostText) return;
    this.ghost = on;
    this.ghostText = withText;
    this.render();
  }

  /** Release the thumb (overlay opened, mode changed). */
  cancel(): void {
    if (this.id === null) return;
    this.id = null;
    this.knobX = 0;
    this.render();
  }

  private sizeTo(r: number): void {
    this.radius = r;
    this.el.style.setProperty('--stick-r', `${r}px`);
    this.hint.style.setProperty('--stick-r', `${r}px`);
  }

  private fromUi(e: Event): boolean {
    const t = e.target as Element | null;
    return !!t && t !== this.canvas && !!t.closest?.('#ui');
  }

  private down(e: PointerEvent): void {
    if (!this.enabled || e.pointerType === 'mouse' || this.fromUi(e)) return;
    if (this.id !== null) {
      // A second finger anywhere: fire. It never spawns another stick.
      this.fire.press();
      return;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.sizeTo(stickRadius(window.innerWidth, window.innerHeight));
    this.id = e.pointerId;
    this.baseX = this.downX = e.clientX;
    this.baseY = this.downY = e.clientY;
    this.downT = performance.now();
    this.knobX = 0;
    this.onFirstTouch?.();
    this.onFirstTouch = null;
    this.render(0);
  }

  private move(e: PointerEvent): void {
    if (!this.enabled || e.pointerId !== this.id) return;
    const b = followBase(this.baseX, this.baseY, e.clientX, e.clientY, this.radius);
    this.baseX = b.x;
    this.baseY = b.y;
    const k = clampKnob(e.clientX - this.baseX, e.clientY - this.baseY, this.radius);
    this.knobX = k.x;
    this.render(k.y);
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.id) return;
    const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
    if (isStickTap(performance.now() - this.downT, moved)) this.fire.press();
    this.cancelId(e.pointerId);
  }

  private cancelId(id: number): void {
    if (id === this.id) this.cancel();
  }

  private render(knobY = 0): void {
    const active = this.enabled && this.id !== null;
    this.el.classList.toggle('on', active);
    this.hint.classList.toggle('on', this.enabled && this.id === null && this.ghost);
    this.hint.classList.toggle('text', this.ghostText);
    if (this.id !== null) {
      this.el.style.transform = `translate(${this.baseX}px, ${this.baseY}px)`;
      this.knob.style.transform = `translate(${this.knobX}px, ${knobY}px)`;
    } else {
      this.knob.style.transform = '';
    }
  }

  dispose(): void {
    for (const f of this.cleanup) f();
    this.el.remove();
    this.hint.remove();
  }
}
