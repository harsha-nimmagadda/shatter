/** The big neon 3-2-1 shown over the playfield while play resumes (see game/countdown.ts). */
export class CountdownView {
  private box: HTMLElement | null = null;
  private num: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {}

  /** Shows `n`, restarting the pop animation. */
  show(n: number): void {
    if (!this.box) {
      const b = document.createElement('div');
      b.className = 'ui-countdown';
      b.setAttribute('role', 'timer');
      b.setAttribute('aria-live', 'assertive');
      const s = document.createElement('span');
      b.append(s);
      this.root.appendChild(b);
      this.box = b;
      this.num = s;
    }
    const s = this.num as HTMLElement;
    s.textContent = String(n);
    s.classList.remove('pop');
    void s.offsetWidth; // restart the animation
    s.classList.add('pop');
  }

  hide(): void {
    this.box?.remove();
    this.box = null;
    this.num = null;
  }
}
