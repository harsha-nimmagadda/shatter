import { CONFIG } from '../engine';
import { C, rgba } from './palette';

const W = CONFIG.width;
const H = CONFIG.height;
const HORIZON = 600;
const VANISH_X = W / 2;
const N_TWINKLE = 18;

/** Deterministic star placement so the sky never changes between frames or levels. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Synthwave backdrop: deep purple sky, stars, a striped neon sun and a perspective grid floor.
 * The static part is baked into one canvas at device resolution; per frame only the grid's horizontal
 * lines (which scroll toward the player) and a few twinkling stars are drawn live.
 */
export class Background {
  private canvas: HTMLCanvasElement | null = null;
  private scale = 0;
  private readonly tx = new Float32Array(N_TWINKLE);
  private readonly ty = new Float32Array(N_TWINKLE);
  private readonly tp = new Float32Array(N_TWINKLE);
  private scroll = 0;

  constructor() {
    const r = prng(77);
    for (let i = 0; i < N_TWINKLE; i++) {
      this.tx[i] = 10 + r() * (W - 20);
      this.ty[i] = 70 + r() * (HORIZON - 120);
      this.tp[i] = r() * Math.PI * 2;
    }
  }

  private build(scale: number): void {
    const c = this.canvas ?? document.createElement('canvas');
    c.width = Math.ceil(W * scale);
    c.height = Math.ceil(H * scale);
    const g = c.getContext('2d');
    this.canvas = c;
    this.scale = scale;
    if (!g) return;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    // Sky.
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, C.bg0);
    sky.addColorStop(0.45, C.bg1);
    sky.addColorStop(HORIZON / H, C.bg2);
    sky.addColorStop(1, '#0A0218');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // Nebula blobs.
    const neb = (x: number, y: number, r: number, col: string, a: number): void => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, rgba(col, a));
      grd.addColorStop(1, rgba(col, 0));
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    neb(110, 260, 220, C.violet, 0.16);
    neb(460, 160, 200, C.cyan, 0.08);
    neb(380, 470, 240, C.pink, 0.1);
    // Stars.
    const r = prng(1234);
    for (let i = 0; i < 140; i++) {
      const x = r() * W;
      const y = r() * HORIZON;
      const big = r() < 0.12;
      g.fillStyle = rgba(r() < 0.3 ? '#BFEFFF' : '#FFFFFF', 0.25 + r() * 0.55);
      const s = big ? 1.6 : 0.9;
      g.fillRect(x, y, s, s);
    }
    // Sun behind the horizon (stripes cut on its own canvas so the sky behind stays intact).
    const sunR = 120;
    const sunY = HORIZON - 10;
    neb(VANISH_X, sunY, 260, C.pink, 0.22);
    const sc = document.createElement('canvas');
    sc.width = Math.ceil(sunR * 2 * scale);
    sc.height = Math.ceil(sunR * scale);
    const sg = sc.getContext('2d');
    if (sg) {
      sg.setTransform(scale, 0, 0, scale, 0, 0);
      const sun = sg.createLinearGradient(0, 0, 0, sunR);
      sun.addColorStop(0, '#FFD45C');
      sun.addColorStop(0.5, '#FF6A8A');
      sun.addColorStop(1, '#C42CB0');
      sg.fillStyle = sun;
      sg.beginPath();
      sg.arc(sunR, sunR, sunR, Math.PI, 0);
      sg.fill();
      sg.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 6; k++) sg.fillRect(0, sunR - 52 + k * 11 + 10, sunR * 2, 2 + k * 0.9);
      g.globalAlpha = 0.5;
      g.drawImage(sc, VANISH_X - sunR, sunY - sunR, sunR * 2, sunR);
      g.globalAlpha = 1;
    }
    // Floor.
    const floor = g.createLinearGradient(0, HORIZON, 0, H);
    floor.addColorStop(0, rgba('#2A0848', 0.95));
    floor.addColorStop(1, '#07010F');
    g.fillStyle = floor;
    g.fillRect(0, HORIZON, W, H - HORIZON);
    // Horizon line.
    g.save();
    g.shadowColor = C.horizon;
    g.shadowBlur = 10 * scale;
    g.strokeStyle = rgba(C.horizon, 0.8);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, HORIZON);
    g.lineTo(W, HORIZON);
    g.stroke();
    g.restore();
    // Vertical grid lines converging on the vanishing point.
    g.strokeStyle = rgba(C.grid, 0.22);
    g.lineWidth = 1;
    g.beginPath();
    for (let k = -12; k <= 12; k++) {
      g.moveTo(VANISH_X + k * 6, HORIZON);
      g.lineTo(VANISH_X + k * 70, H);
    }
    g.stroke();
    // Vignette.
    const vig = g.createRadialGradient(W / 2, H * 0.45, H * 0.25, W / 2, H * 0.5, H * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
  }

  /**
   * `energy` 0..1 brightens the grid (combo), `beat` 0..1 is the music pulse, `still` disables motion
   * (reduced effects).
   */
  draw(ctx: CanvasRenderingContext2D, scale: number, time: number, dt: number, energy: number, beat: number, still: boolean): void {
    if (!this.canvas || Math.abs(scale - this.scale) > 1e-6) this.build(scale);
    if (this.canvas) ctx.drawImage(this.canvas, 0, 0, W, H);
    if (!still) this.scroll = (this.scroll + dt * (0.35 + energy * 0.9)) % 1;
    // Horizontal grid lines (perspective: spacing grows toward the bottom).
    const a = 0.16 + energy * 0.25 + beat * 0.18;
    ctx.strokeStyle = energy > 0.6 ? C.cyan : C.grid;
    ctx.globalAlpha = Math.min(0.75, a);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k < 12; k++) {
      const t = (k + this.scroll) / 12;
      const y = HORIZON + (H - HORIZON) * t * t;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    // Twinkling stars.
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < N_TWINKLE; i++) {
      const tw = still ? 0.5 : 0.5 + 0.5 * Math.sin(time * (1.3 + (i % 5) * 0.4) + this.tp[i]);
      ctx.globalAlpha = 0.15 + tw * 0.75;
      const s = 1 + tw * 1.4;
      ctx.fillRect(this.tx[i] - s / 2, this.ty[i] - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Playfield frame: neon tubes on the side walls and along the top wall (under the HUD). Baked once per
 * scale; `flash` lights the walls (wall hits, life lost).
 */
export class PlayFrame {
  private canvas: HTMLCanvasElement | null = null;
  private scale = 0;

  private build(scale: number): void {
    const c = this.canvas ?? document.createElement('canvas');
    c.width = Math.ceil(W * scale);
    c.height = Math.ceil(H * scale);
    const g = c.getContext('2d');
    this.canvas = c;
    this.scale = scale;
    if (!g) return;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(0, 0, W, H);
    const top = CONFIG.topWall;
    // HUD band.
    const hud = g.createLinearGradient(0, 0, 0, top);
    hud.addColorStop(0, 'rgba(5,1,15,0.92)');
    hud.addColorStop(1, 'rgba(18,4,58,0.75)');
    g.fillStyle = hud;
    g.fillRect(0, 0, W, top);
    const tube = g.createLinearGradient(0, top, 0, H);
    tube.addColorStop(0, C.cyan);
    tube.addColorStop(0.55, C.violet);
    tube.addColorStop(1, C.pink);
    g.save();
    g.lineCap = 'round';
    g.shadowColor = C.cyan;
    g.shadowBlur = 10 * scale;
    g.strokeStyle = tube;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(1.5, H);
    g.lineTo(1.5, top);
    g.lineTo(W - 1.5, top);
    g.lineTo(W - 1.5, H);
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 1;
    g.stroke();
    g.restore();
  }

  draw(ctx: CanvasRenderingContext2D, scale: number): void {
    if (!this.canvas || Math.abs(scale - this.scale) > 1e-6) this.build(scale);
    if (this.canvas) ctx.drawImage(this.canvas, 0, 0, W, H);
  }
}
