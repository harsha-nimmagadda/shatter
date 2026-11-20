/** One-shot press latch: set by an event, consumed exactly once. */
export class Latch {
  private set = false;
  press(): void {
    this.set = true;
  }
  consume(): boolean {
    const v = this.set;
    this.set = false;
    return v;
  }
}

/** Edge detector for polled buttons: true only when pressed now and not at the previous poll. */
export class EdgeDetector {
  private last = false;
  update(pressed: boolean): boolean {
    const edge = pressed && !this.last;
    this.last = pressed;
    return edge;
  }
}
