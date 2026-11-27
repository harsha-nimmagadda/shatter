import { CONFIG, EFFECT_NAMES, comboMultiplier, paddleSegments, type Brick, type GameEvent, type PowerType, type World } from '../engine';
import {
  BALL_PAD,
  BRICK_PAD,
  CAPSULE_PAD,
  CAPSULE_SIZE,
  HUD_ICON,
  HUD_PAD,
  PADDLE_PAD,
  renderBall,
  renderBrick,
  renderGhost,
  renderGlowDot,
  renderHalo,
  renderHeart,
  renderPaddle,
  renderPaddleOverlay,
  renderPhantom,
  renderShield,
  renderSign,
  type OverlayKind,
  type PaddleStyle,
} from './art';
import { Background, PlayFrame } from './background';
import { renderCapsule, renderHudIcon } from './icons';
import { C, brickHue, font } from './palette';
import { Particles } from './particles';
import { PowerFx } from './powerFx';
import {
  ballRenderPos,
  categoryColor,
  clipTilt,
  comboHudText,
  comboLabel,
  comboTier,
  effectFraction,
  isBadPower,
  lerpTowards,
  powerName,
  trailColor,
  type XY,
} from './powerVisuals';
import { Shake } from './shake';
import { SpriteCache, type Sprite } from './sprite';

const W = CONFIG.width;
const H = CONFIG.height;
const TRAIL = 10;
const MAX_TRAILS = 8;
const HIT_SLOTS = 1024;
const TYPE_IDX = { normal: 0, steel: 1, explosive: 2, moving: 3, regen: 4, hidden: 5 } as const;
const TIER_COLORS = [C.white, C.cyan, C.pink, C.gold];
const FIREWORK = [C.cyan, C.pink, C.yellow, C.green, C.violet, C.orange];
const HEART = 20;

const enum Ns {
  Halo,
  Dot,
  Cap,
  Hud,
  Ball,
  Meteor,
  Sign,
  Misc,
}

interface BrickInfo {
  hue: string;
  w: number;
  h: number;
  /** Stagger delay of the level-intro drop-in, seconds. */
  delay: number;
}

/**
 * Neon arcade renderer. Everything with a glow or gradient is baked into cached sprites (SpriteCache); per
 * frame it only blits sprites, strokes a handful of lines and runs the particle pool, so it holds 60 fps on
 * mid-range phones. Draws in logical 540x960 units.
 */
export class Renderer {
  readonly shake = new Shake();
  readonly particles = new Particles(450);
  readonly fx = new PowerFx();
  /** Music pulse 0..1 (set by main from the sound manager). */
  beat = 0;
  /** False while a DOM menu covers the game (hides the canvas status sign). */
  showStatus = true;
  /** HUD level label such as 'LV 4' (empty hides it). */
  levelLabel = '';
  private readonly cache = new SpriteCache(600);
  private readonly bg = new Background();
  private readonly frame = new PlayFrame();
  private readonly bricks = new Map<number, BrickInfo>();
  private readonly hitT = new Float32Array(HIT_SLOTS).fill(-10);
  private readonly trail = new Float32Array(MAX_TRAILS * TRAIL * 2);
  private readonly trailLen = new Uint8Array(MAX_TRAILS);
  private readonly pos: XY = { x: 0, y: 0 };
  private readonly keys: Map<string, number>[] = [];
  private reducedFx = false;
  private lastTime = -1;
  private time = 0;
  private pixelScale = 1;
  private readonly showFps: boolean;
  private fps = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private scoreText = '0';
  private scoreShown = 0;
  private scoreInt = -1;
  private comboText = '';
  private comboValue = 1;
  private comboPopT = -10;
  private energy = 0;
  private dispW: number = CONFIG.paddleW;
  private lastBallCount = 0;
  private padHitT = -10;
  private flashT = 0;
  private flashMax = 1;
  private flashColor: string = C.white;
  private flashA = 0;
  private fireworkCd = 0;
  private emitAcc = 0;
  private introStart = -1;
  private hasMoving = false;
  private trackX0 = 0;
  private trackX1: number = W;
  private nextKey = 1;

  constructor() {
    this.showFps = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fps');
  }

  /** Reduced effects: fewer particles, no flashes, still background, no glow pulses. */
  set reduced(v: boolean) {
    this.reducedFx = v;
    this.particles.density = v ? 0.35 : 1;
  }

  get reduced(): boolean {
    return this.reducedFx;
  }

  /** Call every frame; sprites rebuild only when the scale actually changed. */
  setPixelScale(scale: number): void {
    this.pixelScale = scale;
    this.cache.setScale(scale);
  }

  /** Rebuilds per-level state. Call on every (re)start. */
  loadLevel(world: World): void {
    this.bricks.clear();
    this.hasMoving = false;
    let x0: number = W;
    let x1 = 0;
    let y0: number = H;
    for (const b of world.bricks) {
      x0 = Math.min(x0, b.x);
      x1 = Math.max(x1, b.x + b.w);
      y0 = Math.min(y0, b.y);
    }
    for (const b of world.bricks) {
      const col = Math.round((b.x - x0) / 50);
      const row = Math.round((b.y - y0) / 26);
      this.bricks.set(b.id, { hue: brickHue(b.type, b.maxHp), w: b.w, h: b.h, delay: row * 0.07 + Math.abs(col - 4.5) * 0.025 });
      if (b.type === 'moving') this.hasMoving = true;
    }
    this.trackX0 = x0 < x1 ? x0 : 0;
    this.trackX1 = x0 < x1 ? x1 : W;
    this.particles.clear();
    this.fx.clear();
    this.hitT.fill(-10);
    this.trailLen.fill(0);
    this.dispW = world.paddle.w;
    this.lastBallCount = 0;
    this.scoreShown = world.score;
    this.scoreInt = -1;
    this.flashT = 0;
    this.introStart = -1;
  }

  /** Interned negative numeric sprite keys per namespace + name (no per-frame string building). */
  private key(ns: Ns, name: string): number {
    let m = this.keys[ns];
    if (!m) m = this.keys[ns] = new Map();
    let k = m.get(name);
    if (k === undefined) {
      k = -(this.nextKey++);
      m.set(name, k);
    }
    return k;
  }

  private flash(color: string, alpha: number, dur: number): void {
    if (this.reducedFx) return;
    if (this.flashT > 0 && this.flashA * (this.flashT / this.flashMax) > alpha) return;
    this.flashColor = color;
    this.flashA = alpha;
    this.flashT = dur;
    this.flashMax = dur;
  }

  private burst(x: number, y: number, n: number): void {
    const p = this.particles;
    for (let k = 0; k < 3; k++) {
      const col = FIREWORK[(Math.floor(this.time * 7) + k * 2 + n) % FIREWORK.length];
      p.emit('spark', x, y, 10, { color: col, speed: 420, size: 14, life: 0.7, gravity: 260 });
      p.emit('dot', x, y, 6, { color: col, speed: 260, size: 3, life: 1, gravity: 160 });
    }
    p.emit('ring', x, y, 1, { color: FIREWORK[n % FIREWORK.length], speed: 320, size: 4, life: 0.4 });
  }

  onEvents(events: readonly GameEvent[], world?: World): void {
    const p = this.particles;
    const padW = world ? world.paddle.w : CONFIG.paddleW;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'brickBreak': {
          const info = e.brickId === undefined ? undefined : this.bricks.get(e.brickId);
          const hue = info?.hue ?? C.cyan;
          p.emit('shard', e.x, e.y, 9, { color: hue, speed: 320 });
          p.emit('spark', e.x, e.y, 7, { color: C.white, speed: 420 });
          p.emit('dot', e.x, e.y, 5, { color: hue, speed: 200 });
          p.emit('ring', e.x, e.y, 1, { color: hue, speed: 220, size: 6, life: 0.3 });
          this.shake.add(0.1);
          break;
        }
        case 'brickHit': {
          if (e.brickId !== undefined) this.hitT[e.brickId & (HIT_SLOTS - 1)] = this.time;
          let broken = false;
          for (let j = i + 1; j < events.length; j++) {
            if (events[j].type === 'brickBreak' && events[j].brickId === e.brickId) broken = true;
          }
          if (!broken) {
            const info = e.brickId === undefined ? undefined : this.bricks.get(e.brickId);
            p.emit('spark', e.x, e.y, 5, { color: info?.hue === C.chrome ? C.yellow : C.white, speed: 300, size: 8 });
          }
          break;
        }
        case 'paddle':
          this.padHitT = this.time;
          p.emit('spark', e.x, e.y, 6, { angle: -Math.PI / 2, spread: 1.1, color: C.cyan, speed: 300, size: 9 });
          p.emit('ring', e.x, e.y, 1, { color: C.cyan, speed: 160, size: 4, life: 0.22 });
          break;
        case 'wall':
          p.emit('spark', e.x, e.y, 4, { color: C.violet, speed: 220, size: 7 });
          p.emit('ring', e.x, e.y, 1, { color: C.violet, speed: 120, size: 3, life: 0.2 });
          break;
        case 'launch':
          p.emit('spark', e.x, e.y, 8, { angle: -Math.PI / 2, spread: 0.5, color: C.cyan, speed: 380 });
          break;
        case 'lifeLost':
          this.shake.add(0.75);
          this.flash(C.red, 0.45, 0.45);
          p.emit('spark', e.x, H - 30, 22, { angle: -Math.PI / 2, spread: 1.3, speed: 520, size: 16, life: 0.6, color: C.red });
          p.emit('ring', e.x, H - 30, 1, { color: C.red, speed: 500, size: 6, life: 0.45 });
          break;
        case 'won':
          this.shake.add(0.25);
          this.flash(C.white, 0.35, 0.35);
          this.fireworkCd = 0;
          break;
        case 'gameover':
          this.flash(C.red, 0.3, 0.6);
          break;
        case 'explode':
          this.fx.addBlast(e.x, e.y);
          p.emit('shard', e.x, e.y, 12, { color: C.orange, speed: 460, life: 1 });
          p.emit('spark', e.x, e.y, 16, { color: C.yellow, speed: 560, size: 14, life: 0.5 });
          p.emit('dot', e.x, e.y, 10, { color: C.red, speed: 320, life: 0.8 });
          this.shake.add(0.5);
          this.flash(C.orange, 0.22, 0.2);
          break;
        case 'regen':
          if (e.brickId !== undefined) this.fx.addPop(e.brickId);
          p.emit('dot', e.x, e.y, 8, { color: C.mint, speed: 120 });
          p.emit('ring', e.x, e.y, 1, { color: C.mint, speed: 140, size: 4, life: 0.3 });
          break;
        case 'reveal':
          if (e.brickId !== undefined) this.fx.addPop(e.brickId);
          p.emit('dot', e.x, e.y, 10, { color: C.pink, speed: 160 });
          p.emit('spark', e.x, e.y, 6, { color: C.cyan, speed: 220 });
          break;
        case 'powerup': {
          const col = e.power ? categoryColor(e.power) : C.cyan;
          const bad = isBadPower(e.power ?? '');
          p.emit('ring', e.x, e.y, 1, { color: col, speed: 300, size: 8, life: 0.4 });
          p.emit('spark', e.x, e.y, 12, { color: col, speed: 360, size: 12 });
          p.emit('dot', e.x, e.y, 8, { color: C.white, speed: 220, life: 0.5 });
          if (e.power) this.fx.addFloat(powerName(e.power), e.x, e.y - 22, col, bad ? 28 : 26);
          if (bad) this.flash(C.red, 0.18, 0.25);
          else this.flash(col, 0.1, 0.18);
          if (e.power === 'redpen') this.fx.addSpeed(1);
          else if (e.power === 'correction') this.fx.addSpeed(-1);
          else if (e.power === 'scissors') this.shake.add(0.35);
          else if (e.power === 'goldstar') this.goldBurst(e.x, e.y, false);
          break;
        }
        case 'extraLife':
          this.goldBurst(e.x, e.y, true);
          break;
        case 'splash': {
          const info = e.brickId === undefined ? undefined : this.bricks.get(e.brickId);
          const bw = info?.w ?? 48;
          const sp = { color: C.green, speed: 200, size: 3, life: 0.5 };
          p.emit('dot', e.x, e.y, 6, sp);
          p.emit('ring', e.x, e.y, 1, { color: C.green, speed: bw * 3, size: 6, life: 0.3 });
          break;
        }
        case 'clipLoose':
          if (e.brickId !== undefined) this.fx.addWobble(e.brickId);
          p.emit('spark', e.x, e.y, 5, { color: C.yellow, speed: 200, size: 6 });
          break;
        case 'clipPop': {
          const info = e.brickId === undefined ? undefined : this.bricks.get(e.brickId);
          this.fx.addFlyer(e.x, e.y, info?.w ?? 48, info?.h ?? 24, e.x < W / 2 ? -1 : 1);
          this.fx.addFloat('POP!', e.x, e.y - 8, C.chrome);
          p.emit('spark', e.x, e.y, 10, { color: C.yellow, speed: 340 });
          break;
        }
        case 'combo':
          if (e.value !== undefined) {
            const tier = comboTier(e.value);
            this.comboPopT = this.time;
            this.fx.addFloat(`${comboLabel(e.value)} COMBO!`, e.x, e.y - 6, TIER_COLORS[tier], 24 + tier * 4);
            this.burst(e.x, e.y, tier);
            if (tier >= 3) {
              this.burst(W * 0.25, CONFIG.topWall + 120, 1);
              this.burst(W * 0.75, CONFIG.topWall + 120, 4);
              this.flash(C.gold, 0.18, 0.3);
              this.shake.add(0.2);
            }
          }
          break;
        case 'powerMiss':
          p.emit('dot', e.x, H - 6, 4, { angle: -Math.PI / 2, spread: 1, speed: 80, color: C.violet, life: 0.35 });
          break;
        case 'effectEnd':
          p.emit('dot', e.x, e.y, 6, { angle: -Math.PI / 2, spread: 1.4, speed: 90, color: C.violet, life: 0.4 });
          break;
        case 'staple':
          for (let k = -1; k <= 1; k += 2) {
            p.emit('spark', e.x + k * (padW / 2 - 9), e.y - 14, 2, { angle: -Math.PI / 2, spread: 0.4, speed: 200, size: 6, life: 0.15, color: C.red, gravity: 0 });
          }
          break;
        case 'eraser':
          this.fx.addEraser(e.y);
          this.flash(C.cyan, 0.12, 0.2);
          break;
        case 'net':
          for (let k = 0; k < 14; k++) {
            p.emit('spark', 20 + (k * (W - 40)) / 13, H - CONFIG.netInset, 1, { color: C.cyan, angle: -Math.PI / 2, spread: 0.8, speed: 320, size: 12, life: 0.5 });
          }
          p.emit('ring', e.x, H - CONFIG.netInset, 1, { color: C.cyan, speed: 300, size: 6, life: 0.35 });
          this.shake.add(0.15);
          break;
        default:
          break;
      }
    }
  }

  private goldBurst(x: number, y: number, plusOne: boolean): void {
    const p = this.particles;
    p.emit('spark', x, y, 14, { color: C.gold, speed: 380, size: 14, life: 0.5 });
    p.emit('dot', x, y, 12, { color: C.pink, speed: 220, size: 3, life: 0.8, gravity: 60 });
    p.emit('ring', x, y, 1, { color: C.pink, speed: 280, size: 6, life: 0.4 });
    if (plusOne) this.fx.addFloat('+1 LIFE', x, y - 24, C.pink, 28);
  }

  draw(ctx: CanvasRenderingContext2D, world: World, prev: readonly XY[], alpha: number, time: number): void {
    const dt = this.lastTime < 0 ? 0 : Math.min(0.05, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.time = time;
    if (this.introStart < 0) this.introStart = time;
    this.particles.update(dt);
    this.fx.update(dt);
    this.shake.update(dt);
    this.flashT = Math.max(0, this.flashT - dt);
    const tier = comboTier(comboMultiplier(world));
    this.energy += (tier / 3 - this.energy) * Math.min(1, dt * 4);

    this.bg.draw(ctx, this.pixelScale, time, dt, this.energy, this.reducedFx ? 0 : this.beat, this.reducedFx);

    ctx.translate(this.shake.x, this.shake.y);
    this.frame.draw(ctx, this.pixelScale);
    this.drawGhosts(ctx, world, time);
    this.drawBricks(ctx, world, time);
    this.drawBlastFlash(ctx, world, time);
    this.drawNet(ctx, world, time);
    this.drawPaddle(ctx, world, dt, time);
    this.drawBolts(ctx, world);
    this.drawBalls(ctx, world, prev, alpha, time, dt);
    this.drawDrops(ctx, world, time);
    this.fx.drawErasers(ctx, this.eraserSpark);
    this.fx.drawFlyers(ctx);
    this.particles.draw(ctx);
    this.fx.drawBlasts(ctx);
    this.fx.drawFloats(ctx);
    ctx.translate(-this.shake.x, -this.shake.y);

    if (!this.reducedFx) this.fx.drawSpeed(ctx, time);
    this.drawHud(ctx, world, time, dt);
    this.drawStatus(ctx, world, time, dt);
    if (this.flashT > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flashA * (this.flashT / this.flashMax);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    if (this.showFps) this.drawFps(ctx, dt);
  }

  private readonly eraserSpark = (x: number, y: number): void => {
    this.particles.emit('spark', x, y + (Math.random() - 0.5) * 30, 1, { color: C.cyan, speed: 260, angle: Math.PI, spread: 0.6, life: 0.35 });
  };

  // ---------- sprites ----------

  private brickSprite(b: Brick): Sprite {
    const k = TYPE_IDX[b.type] * 10000 + b.maxHp * 1000 + b.hp * 100 + (b.seed % 3);
    return this.cache.get(k) ?? this.cache.build(k, b.w, b.h, BRICK_PAD, (g, px) => renderBrick(g, b.type, b.hp, b.maxHp, b.w, b.h, b.seed % 3, px));
  }

  private haloSprite(hue: string, w: number, h: number): Sprite {
    const k = this.key(Ns.Halo, hue);
    return this.cache.get(k) ?? this.cache.build(k, w, h, BRICK_PAD + 4, (g, px) => renderHalo(g, w, h, hue, 12, px));
  }

  private glowDot(color: string): Sprite {
    const k = this.key(Ns.Dot, color);
    return this.cache.get(k) ?? this.cache.build(k, 32, 32, 0, (g) => renderGlowDot(g, 16, color));
  }

  // ---------- world ----------

  private drawBricks(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const list = world.bricks;
    const intro = time - this.introStart;
    if (this.hasMoving) {
      ctx.strokeStyle = C.yellow;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.type !== 'moving') continue;
        ctx.moveTo(this.trackX0, b.y + b.h / 2);
        ctx.lineTo(this.trackX1, b.y + b.h / 2);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // Breathing halos (additive), a slow diagonal wave across the wall; bombs pulse fast.
    if (!this.reducedFx) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.hidden || b.kind === 'steel') continue;
        const info = this.bricks.get(b.id);
        if (!info) continue;
        const wave = b.type === 'explosive' ? 0.55 + 0.45 * Math.sin(time * 7 + b.id) : 0.3 + 0.3 * Math.sin(time * 2.2 - b.x * 0.018 - b.y * 0.03);
        ctx.globalAlpha = wave * Math.min(1, Math.max(0, (intro - info.delay) * 3)) * (0.6 + this.energy * 0.4);
        this.haloSprite(info.hue, b.w, b.h).draw(ctx, b.x, b.y);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const info = this.bricks.get(b.id);
      // Level intro: bricks drop in, staggered by row and column.
      let dy = 0;
      if (info && intro < info.delay + 0.5) {
        const t = Math.max(0, Math.min(1, (intro - info.delay) / 0.45));
        if (t <= 0) continue;
        const e = 1 - (1 - t) ** 3;
        dy = -(1 - e) * 70;
        ctx.globalAlpha = t;
      }
      if (b.hidden) {
        ctx.globalAlpha *= 0.22 + 0.16 * Math.sin(time * 9 + b.id * 2.1) + (Math.sin(time * 31 + b.id) > 0.97 ? 0.3 : 0);
        const k = this.key(Ns.Misc, 'phantom');
        const s = this.cache.get(k) ?? this.cache.build(k, b.w, b.h, BRICK_PAD, (g, px) => renderPhantom(g, b.w, b.h, px));
        s.draw(ctx, b.x, b.y + dy);
        ctx.globalAlpha = 1;
        continue;
      }
      const s = this.brickSprite(b);
      const hitAge = time - this.hitT[b.id & (HIT_SLOTS - 1)];
      const pa = this.fx.popAgeOf(b.id);
      let scale = 1;
      let rot = 0;
      if (hitAge < 0.15) scale = 1 + 0.12 * (1 - hitAge / 0.15);
      if (pa >= 0) {
        const t = pa / 0.3;
        scale = 1 + 0.35 * (1 - t) * (1 - t);
        ctx.globalAlpha = 0.4 + 0.6 * Math.min(1, t * 1.5);
      }
      if (b.kind === 'steel') rot = clipTilt(b.streakHits, time, b.id) + this.fx.wobbleOf(b.id);
      if (scale !== 1 || rot !== 0) {
        ctx.save();
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2 + dy);
        if (rot !== 0) ctx.rotate(rot);
        ctx.scale(scale, scale);
        s.draw(ctx, -b.w / 2, -b.h / 2);
        ctx.restore();
      } else s.draw(ctx, b.x, b.y + dy);
      if (hitAge < 0.12) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.75 * (1 - hitAge / 0.12);
        ctx.fillStyle = C.white;
        ctx.fillRect(b.x + 2, b.y + 2 + dy, b.w - 4, b.h - 4);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = 1;
    }
    // Moving bricks: motion streaks behind them.
    if (this.hasMoving) {
      ctx.strokeStyle = C.yellow;
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.type !== 'moving' || b.vx === 0 || b.hidden) continue;
        const dir = b.vx > 0 ? 1 : -1;
        const ex = dir > 0 ? b.x - 2 : b.x + b.w + 2;
        for (let k = 0; k < 3; k++) {
          const len = 5 + 6 * (0.5 + 0.5 * Math.sin(time * 18 + b.id * 1.3 + k * 2));
          const y = b.y + b.h * (0.28 + 0.22 * k);
          ctx.moveTo(ex, y);
          ctx.lineTo(ex - dir * len, y);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** Regenerating bricks re-forming: dashed outline plus a neon line tracing the perimeter. */
  private drawGhosts(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const gs = world.ghosts;
    if (gs.length === 0) return;
    for (let i = 0; i < gs.length; i++) {
      const b = gs[i].brick;
      const prog = Math.max(0, Math.min(1, 1 - gs[i].timer / CONFIG.regenDelay));
      const k = this.key(Ns.Misc, 'ghost');
      const g = this.cache.get(k) ?? this.cache.build(k, b.w, b.h, BRICK_PAD, (c, px) => renderGhost(c, b.w, b.h, px));
      ctx.globalAlpha = 0.18 + 0.08 * Math.sin(time * 6 + i);
      g.draw(ctx, b.x, b.y);
      if (prog > 0.02) {
        const per = (b.w + b.h) * 2;
        ctx.setLineDash([per * prog, per]);
        ctx.strokeStyle = C.mint;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.3 + 0.6 * prog;
        ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
        ctx.setLineDash([]);
      }
      if (prog > 0.85) {
        ctx.globalAlpha = (prog - 0.85) * 3;
        this.brickSprite(b).draw(ctx, b.x, b.y);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Bombs about to chain-detonate strobe. */
  private drawBlastFlash(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const bl = world.blasts;
    if (bl.length === 0) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = C.yellow;
    for (let i = 0; i < bl.length; i++) {
      const id = bl[i].brickId;
      for (let j = 0; j < world.bricks.length; j++) {
        const b = world.bricks[j];
        if (b.id !== id) continue;
        ctx.globalAlpha = 0.45 + 0.35 * Math.sin(time * 70 + i);
        ctx.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  private drawNet(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    if (!world.net) return;
    const k = this.key(Ns.Misc, 'shield');
    const s = this.cache.get(k) ?? this.cache.build(k, W, 18, 6, (g, px) => renderShield(g, W, 18, px));
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(time * 5);
    s.draw(ctx, 0, H - CONFIG.netInset - 9);
    ctx.globalAlpha = 1;
  }

  private overlay(kind: OverlayKind, rw: number, h: number): Sprite {
    const k = (kind === 'sticky' ? 3_000_000 : 4_000_000) + rw * 100 + h;
    return this.cache.get(k) ?? this.cache.build(k, rw, h, PADDLE_PAD, (g, px) => renderPaddleOverlay(g, kind, rw, h, px));
  }

  private drawPaddle(ctx: CanvasRenderingContext2D, world: World, dt: number, time: number): void {
    const p = world.paddle;
    const eff = world.effects;
    this.dispW = lerpTowards(this.dispW, p.w, dt);
    const rw = Math.round(p.w);
    const wide = eff.ruler !== undefined;
    const style: PaddleStyle = wide ? 'wide' : 'normal';
    const k = (wide ? 2_000_000 : 1_000_000) + rw * 100 + p.h;
    const s = this.cache.get(k) ?? this.cache.build(k, rw, p.h, PADDLE_PAD, (g, px) => renderPaddle(g, rw, p.h, style, px));
    const sx = this.dispW / rw;
    const x0 = p.x - this.dispW / 2;
    const scissors = eff.scissors !== undefined;
    // Under-glow (thrusters).
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 + 0.1 * Math.sin(time * 12);
    ctx.drawImage(this.glowDot(wide ? C.green : C.cyan).canvas, x0 - 10, p.y + p.h * 0.4, this.dispW + 20, 26);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (eff.paperclip !== undefined) this.drawMagnet(ctx, p.x, p.y, time);
    // Squash on ball contact.
    const ha = time - this.padHitT;
    const sq = ha < 0.18 ? Math.sin((ha / 0.18) * Math.PI) * (1 - ha / 0.18) : 0;
    ctx.save();
    if (scissors) {
      const segs = paddleSegments(world);
      ctx.beginPath();
      ctx.rect(x0 - 20, p.y - 20, segs[0][1] - (x0 - 20), p.h + 40);
      ctx.rect(segs[1][0], p.y - 20, p.x + this.dispW / 2 + 20 - segs[1][0], p.h + 40);
      ctx.clip();
    }
    ctx.translate(p.x, p.y + p.h);
    ctx.scale(sx * (1 + sq * 0.06), 1 - sq * 0.3);
    ctx.translate(-rw / 2, -p.h);
    s.draw(ctx, 0, 0);
    if (eff.gluestick !== undefined) this.overlay('sticky', rw, p.h).draw(ctx, 0, 0);
    if (eff.stapler !== undefined) this.overlay('lasers', rw, p.h).draw(ctx, 0, 0);
    ctx.restore();
    if (scissors) {
      // Crackling electric arcs on the cut ends.
      const segs = paddleSegments(world);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let e = 0; e < 2; e++) {
        const x = e === 0 ? segs[0][1] : segs[1][0];
        ctx.moveTo(x, p.y - 2);
        for (let j = 1; j <= 4; j++) ctx.lineTo(x + Math.sin(time * 50 + j * 7 + e * 3) * 3, p.y - 2 + (j * (p.h + 4)) / 4);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (eff.sharpener !== undefined && dt > 0) {
      this.emitAcc += dt * 8;
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.particles.emit('spark', p.x + side * this.dispW * 0.5, p.y + p.h / 2, 1, { color: C.red, angle: side < 0 ? Math.PI : 0, spread: 0.8, speed: 160, size: 6, life: 0.3 });
      }
    }
  }

  /** MAGNET: contracting gold arcs above the paddle. */
  private drawMagnet(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const f = (time * 0.9 + k / 3) % 1;
      const r = 30 + (1 - f) * 80;
      ctx.globalAlpha = 0.35 * Math.sin(f * Math.PI);
      ctx.beginPath();
      ctx.arc(x, y + 10, r, -Math.PI * 0.85, -Math.PI * 0.15);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  private ballColor(eff: World['effects']): string {
    if (eff.crumpled !== undefined) return C.orange;
    if (eff.redpen !== undefined) return C.red;
    if (eff.highlighter !== undefined) return C.green;
    if (eff.plane !== undefined) return C.cyan;
    return '#7FD8FF';
  }

  private drawBalls(ctx: CanvasRenderingContext2D, world: World, prev: readonly XY[], alpha: number, time: number, dt: number): void {
    const balls = world.balls;
    if (balls.length !== this.lastBallCount) {
      this.lastBallCount = balls.length;
      this.trailLen.fill(0);
    }
    const eff = world.effects;
    const meteor = eff.crumpled !== undefined;
    const homing = eff.plane !== undefined;
    const color = this.ballColor(eff);
    const tc = trailColor(eff);
    const dot = this.glowDot(tc.color);
    const r0 = CONFIG.ballR;
    const bk = this.key(meteor ? Ns.Meteor : Ns.Ball, color);
    const bs = this.cache.get(bk) ?? this.cache.build(bk, r0 * 2, r0 * 2, BALL_PAD, (g, px) => renderBall(g, r0, color, px, meteor));
    for (let i = 0; i < balls.length && i < MAX_TRAILS; i++) {
      const b = balls[i];
      const { x, y } = ballRenderPos(prev, i, balls.length, b, b.stuck, alpha, this.pos);
      const base = i * TRAIL * 2;
      if (b.stuck) {
        this.trailLen[i] = 0;
      } else {
        let n = this.trailLen[i];
        if (n > 0 && Math.hypot(this.trail[base] - x, this.trail[base + 1] - y) > 120) n = 0;
        if (n === 0 || Math.hypot(this.trail[base] - x, this.trail[base + 1] - y) > 5) {
          for (let k = Math.min(n, TRAIL - 1); k > 0; k--) {
            this.trail[base + k * 2] = this.trail[base + (k - 1) * 2];
            this.trail[base + k * 2 + 1] = this.trail[base + (k - 1) * 2 + 1];
          }
          this.trail[base] = x;
          this.trail[base + 1] = y;
          n = Math.min(TRAIL, n + 1);
        }
        this.trailLen[i] = n;
        // Light trail: additive glow dots shrinking along the path.
        ctx.globalCompositeOperation = 'lighter';
        for (let k = n - 1; k >= 1; k--) {
          const f = 1 - k / TRAIL;
          const s = b.r * (meteor ? 3.2 : 2.4) * (0.35 + 0.65 * f);
          ctx.globalAlpha = tc.alpha * f;
          ctx.drawImage(dot.canvas, this.trail[base + k * 2] - s, this.trail[base + k * 2 + 1] - s, s * 2, s * 2);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        if (meteor && dt > 0 && Math.random() < dt * 40) {
          this.particles.emit('spark', x, y, 1, { color: Math.random() < 0.5 ? C.orange : C.yellow, angle: Math.atan2(-b.vy, -b.vx), spread: 0.5, speed: 160, size: 8, life: 0.3, gravity: -60 });
        }
      }
      // Ball halo.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      const hs = b.r * (meteor ? 4.2 : 3.2);
      ctx.drawImage(dot.canvas, x - hs, y - hs, hs * 2, hs * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      bs.drawCentered(ctx, x, y, b.r / r0);
      if (homing) {
        ctx.strokeStyle = C.cyan;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.85;
        const rr = b.r + 7;
        ctx.beginPath();
        for (let q = 0; q < 4; q++) {
          const a = time * 5 + (q * Math.PI) / 2;
          ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          ctx.arc(x, y, rr, a, a + 0.8);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawDrops(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const drops = world.drops;
    const w = CAPSULE_SIZE;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      const t: PowerType = d.type;
      const k = this.key(Ns.Cap, t);
      const s = this.cache.get(k) ?? this.cache.build(k, w, w, CAPSULE_PAD, (g, px) => renderCapsule(g, t, w, px));
      const bad = isBadPower(t);
      // Pulsing halo.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(time * 8 + d.id);
      const hs = w * 0.95;
      ctx.drawImage(this.glowDot(categoryColor(t)).canvas, d.x - hs, d.y - hs, hs * 2, hs * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const pulse = 1 + 0.06 * Math.sin(time * 8 + d.id);
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(bad ? time * 2.5 : Math.sin(time * 3.5 + d.id * 1.7) * 0.18);
      ctx.scale(pulse, pulse);
      s.draw(ctx, -w / 2, -w / 2);
      ctx.restore();
    }
  }

  /** LASERS: red beams with a white-hot core. */
  private drawBolts(ctx: CanvasRenderingContext2D, world: World): void {
    const bolts = world.bolts;
    if (bolts.length === 0) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (let i = 0; i < bolts.length; i++) {
      ctx.moveTo(bolts[i].x, bolts[i].y);
      ctx.lineTo(bolts[i].x, bolts[i].y + 16);
    }
    ctx.stroke();
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- HUD ----------

  private drawHud(ctx: CanvasRenderingContext2D, world: World, time: number, dt: number): void {
    // Score counts up quickly toward the real value.
    const target = world.score;
    if (this.scoreShown < target) this.scoreShown = Math.min(target, this.scoreShown + Math.max(1, (target - this.scoreShown) * Math.min(1, dt * 12)));
    else this.scoreShown = target;
    const si = Math.floor(this.scoreShown);
    if (si !== this.scoreInt) {
      this.scoreInt = si;
      this.scoreText = String(si);
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(13, false);
    ctx.fillStyle = C.cyan;
    ctx.fillText('SCORE', 16, 22);
    const counting = si < target;
    ctx.font = font(counting ? 27 : 26);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = C.pink;
    ctx.strokeText(this.scoreText, 72, 21);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.white;
    ctx.fillText(this.scoreText, 72, 21);
    if (this.levelLabel) {
      ctx.textAlign = 'center';
      ctx.font = font(17);
      ctx.fillStyle = C.yellow;
      ctx.fillText(this.levelLabel, 262, 22);
      ctx.textAlign = 'left';
    }
    // Lives as neon hearts, clear of the DOM gear button at the top right.
    const kf = this.key(Ns.Misc, 'heart');
    const heart = this.cache.get(kf) ?? this.cache.build(kf, HEART, HEART, 6, (g, px) => renderHeart(g, HEART, px));
    const right = W - 70;
    const lives = world.lives;
    if (lives <= 6) {
      for (let i = 0; i < lives; i++) {
        const beatScale = i === lives - 1 ? 1 + 0.08 * this.beat : 1;
        heart.drawCentered(ctx, right - (i + 0.5) * 23, 21, beatScale);
      }
    } else {
      heart.drawCentered(ctx, right - 12, 21);
      ctx.font = font(20);
      ctx.textAlign = 'right';
      ctx.fillStyle = C.white;
      ctx.fillText(`${lives}×`, right - 28, 22);
      ctx.textAlign = 'left';
    }
    // Combo (hidden at 1x) under the hearts.
    const mul = comboMultiplier(world);
    if (mul !== this.comboValue) {
      this.comboValue = mul;
      this.comboText = comboHudText(mul);
    }
    if (this.comboText) {
      const tier = comboTier(mul);
      const pa = time - this.comboPopT;
      const pop = pa < 0.2 ? 1 + 0.4 * (1 - pa / 0.2) : 1 + 0.04 * Math.sin(time * 10);
      ctx.save();
      ctx.translate(W - 66, 49);
      ctx.scale(pop, pop);
      ctx.font = font(18 + tier * 2);
      ctx.textAlign = 'right';
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = TIER_COLORS[tier];
      ctx.strokeText(this.comboText, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.white;
      ctx.fillText(this.comboText, 0, 0);
      ctx.restore();
    }
    this.drawEffectsRow(ctx, world, time);
  }

  /** Second HUD row: active timed effects as icons with a shrinking ring in the category colour. */
  private drawEffectsRow(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const cy = 47;
    let x = 28;
    ctx.lineCap = 'round';
    for (let i = 0; i < EFFECT_NAMES.length; i++) {
      const name = EFFECT_NAMES[i];
      const left = world.effects[name];
      if (left === undefined) continue;
      const f = effectFraction(name, left);
      const k = this.key(Ns.Hud, name);
      const s = this.cache.get(k) ?? this.cache.build(k, HUD_ICON, HUD_ICON, HUD_PAD, (g, px) => renderHudIcon(g, name, HUD_ICON, px));
      const blink = f < 0.25 && Math.floor(time * 6) % 2 === 0;
      ctx.globalAlpha = blink ? 0.45 : 1;
      s.draw(ctx, x - HUD_ICON / 2, cy - HUD_ICON / 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = categoryColor(name);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, cy, 13.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
      ctx.stroke();
      x += 32;
    }
    if (world.net) {
      const k = this.key(Ns.Hud, 'stickynote');
      const s = this.cache.get(k) ?? this.cache.build(k, HUD_ICON, HUD_ICON, HUD_PAD, (g, px) => renderHudIcon(g, 'stickynote', HUD_ICON, px));
      s.draw(ctx, x - HUD_ICON / 2, cy - HUD_ICON / 2);
    }
  }

  private signSprite(title: string, sub: string, color: string, px: number): Sprite {
    const k = this.key(Ns.Sign, title);
    const w = W - 40;
    const h = sub ? px * 2 : px * 1.4;
    return this.cache.get(k) ?? this.cache.build(k, w, h, 16, (g, dpx) => renderSign(g, title, sub, w, h, dpx, color, px));
  }

  private drawStatus(ctx: CanvasRenderingContext2D, world: World, time: number, dt: number): void {
    const st = world.status;
    if (st === 'playing' || !this.showStatus) return;
    if (st === 'serve') {
      const s = this.signSprite('TAP TO LAUNCH', '', C.cyan, 34);
      ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(time * 2.6));
      s.draw(ctx, 20, 540 - s.h / 2);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = 'rgba(5,1,15,0.5)';
    ctx.fillRect(0, CONFIG.topWall, W, H - CONFIG.topWall);
    const won = st === 'won';
    const s = won ? this.signSprite('STAGE CLEAR!', '', C.gold, 50) : this.signSprite('GAME OVER', '', C.red, 56);
    const bob = Math.sin(time * 3) * 4;
    s.drawCentered(ctx, W / 2, H / 2 - 20 + bob);
    if (won && !this.reducedFx) {
      this.fireworkCd -= dt;
      if (this.fireworkCd <= 0) {
        this.fireworkCd = 0.38;
        this.burst(60 + Math.random() * (W - 120), 150 + Math.random() * 320, Math.floor(Math.random() * 6));
      }
    }
  }

  private drawFps(ctx: CanvasRenderingContext2D, dt: number): void {
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    ctx.font = '16px monospace';
    ctx.fillStyle = C.green;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${this.fps} fps`, 8, H - 8);
  }
}
