import { EdgeDetector, Latch } from './latch';

/** Radial-style dead zone on one axis, rescaled so output starts at 0 just outside it. */
export function applyDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

export const STICK_DEADZONE = 0.2;

export class GamepadInput {
  readonly fire = new Latch();
  readonly pause = new Latch();
  private axisValue = 0;
  private fireEdge = new EdgeDetector();
  private pauseEdge = new EdgeDetector();

  /** Call once per frame. */
  poll(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected && p.mapping === 'standard') {
        pad = p;
        break;
      }
    }
    if (!pad) {
      this.axisValue = 0;
      this.fireEdge.update(false);
      this.pauseEdge.update(false);
      return;
    }
    const dpad = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
    const stick = applyDeadzone(pad.axes[0] ?? 0, STICK_DEADZONE);
    this.axisValue = dpad !== 0 ? dpad : stick;
    if (this.fireEdge.update(!!pad.buttons[0]?.pressed)) this.fire.press();
    if (this.pauseEdge.update(!!pad.buttons[9]?.pressed)) this.pause.press();
  }

  axis(): number {
    return this.axisValue;
  }
}
