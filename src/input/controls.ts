import type { Input } from '../engine';
import { CONFIG } from '../engine';
import type { View } from '../game/view';
import { GamepadInput } from './gamepad';
import { KeyboardInput } from './keyboard';
import { Latch } from './latch';
import { PointerInput } from './pointer';
import { StickInput, stickMoveAxis } from './stick';
import { loadSettings, type ControlSettings } from './settings';
import { TiltInput } from './tilt';

/** Pure: merge the per-source values into one engine Input, consuming the fire latch. */
export function buildInput(
  keyAxis: number,
  padAxis: number,
  paddleX: number | null,
  fireLatch: Latch,
): Input {
  return { moveAxis: keyAxis !== 0 ? keyAxis : padAxis, paddleX, fire: fireLatch.consume() };
}

export class Controls {
  readonly settings: ControlSettings = loadSettings();
  readonly tilt: TiltInput;
  private readonly keyboard = new KeyboardInput();
  private readonly gamepad = new GamepadInput();
  private readonly pointer: PointerInput;
  readonly stick: StickInput;
  private readonly fire = new Latch();
  private readonly pause = new Latch();
  private tiltX: number | null = null;
  private paddleXNow = CONFIG.width / 2;

  constructor(canvas: HTMLCanvasElement, view: View) {
    this.tilt = new TiltInput(this.settings);
    this.pointer = new PointerInput(canvas, view);
    this.pointer.paddleW = CONFIG.paddleW;
    this.pointer.playfieldW = CONFIG.width;
    this.pointer.getSensitivity = () => this.settings.dragSensitivity;
    this.pointer.getPaddleX = () => this.paddleXNow;
    this.stick = new StickInput(canvas, view, document.getElementById('ui') ?? document.body);
  }

  /** Tell Controls where the paddle is, for relative drag. */
  setPaddleX(x: number): void {
    this.paddleXNow = x;
  }

  /** Once per rendered frame. */
  poll(dt: number): void {
    this.gamepad.poll();
    this.pointer.touchSteers = this.settings.mode === 'drag';
    this.pointer.touchEnabled = this.settings.mode !== 'stick';
    this.stick.setEnabled(this.settings.mode === 'stick');
    this.tiltX =
      this.settings.mode === 'tilt' ? this.tilt.paddleX(dt, this.settings, CONFIG.width, CONFIG.paddleW) : null;
    // Move source events into the shared latches so nothing is lost between frames.
    if (this.keyboard.fire.consume() || this.pointer.fire.consume() || this.gamepad.fire.consume() || this.stick.fire.consume()) this.fire.press();
    if (this.keyboard.pause.consume() || this.gamepad.pause.consume()) this.pause.press();
  }

  /** Engine input for one physics step. */
  input(): Input {
    // Fire events that arrived since the last poll() are picked up too.
    if (this.keyboard.fire.consume() || this.pointer.fire.consume() || this.gamepad.fire.consume() || this.stick.fire.consume()) this.fire.press();
    const stickAxis = this.settings.mode === 'stick' ? stickMoveAxis(this.stick.axis(), this.settings.stickSpeed, CONFIG.paddleKeySpeed) : 0;
    // Keys/stick take over from the pointer; drop its stale target so the paddle doesn't snap back.
    if (this.keyboard.axis() !== 0 || this.gamepad.axis() !== 0 || stickAxis !== 0) this.pointer.target = null;
    const x = this.settings.mode === 'tilt' ? this.tiltX : this.pointer.target;
    return buildInput(this.keyboard.axis(), this.gamepad.axis() !== 0 ? this.gamepad.axis() : stickAxis, x, this.fire);
  }

  pausePressed(): boolean {
    if (this.keyboard.pause.consume() || this.gamepad.pause.consume()) this.pause.press();
    return this.pause.consume();
  }

  /** Discard a pending fire press (e.g. the tap that dismissed an overlay). */
  clearFire(): void {
    this.fire.consume();
    this.keyboard.fire.consume();
    this.pointer.fire.consume();
    this.gamepad.fire.consume();
    this.stick.fire.consume();
    this.stick.cancel();
  }

  /** Faint idle stick hint (during serve). */
  setStickGhost(on: boolean): void {
    this.stick.setGhost(on);
  }

  dispose(): void {
    this.keyboard.dispose();
    this.pointer.dispose();
    this.stick.dispose();
    this.tilt.disable();
  }
}
