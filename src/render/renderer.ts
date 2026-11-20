import { CONFIG, type GameEvent, type World } from '../engine';
import { Background, PlayFrame } from './background';
import { bricksBounds } from './artLayout';
import { BoilCache, type Sprite } from './boil';
import { Particles } from './particles';
import { Shake } from './shake';
import { NOTEBOOK_SKIN, type Skin } from './skin';
import {
  BALL_PAD,
  BRICK_PAD,
  MSG_PAD,
  PADDLE_PAD,
  brickColor,
  renderBall,
  renderBrick,
  renderMessage,
  renderPaddle,
} from './sprites';

const W = CONFIG.width;
const H = CONFIG.height;
const TRAIL = 7;
const MAX_TRAILS = 8;
const MSG_PX = 40;

interface BrickInfo {
  kind: 'normal' | 'steel';
  color: string;
}

export class Renderer {
  readonly shake = new Shake();
  readonly particles = new Particles(400);
  private readonly cache = new BoilCache(512);
  private readonly bg: Background;
  private readonly frame: PlayFrame;
  private readonly bricks = new Map<number, BrickInfo>();
  private readonly msgWidth = new Map<string, number>();
  private readonly trail = new Float32Array(MAX_TRAILS * TRAIL * 2);
  private readonly trailLen = new Uint8Array(MAX_TRAILS);
  private lastTime = -1;
  private pixelScale = 1;
  private readonly showFps: boolean;
  private fps = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private scoreText = '';
  private scoreValue = -1;

  constructor(readonly skin: Skin = NOTEBOOK_SKIN) {
    this.bg = new Background(skin);
    this.frame = new PlayFrame(skin, this.cache);
    this.showFps = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fps');
  }

  /** Call after a resize / every frame; sprites rebuild only when the scale actually changed. */
  setPixelScale(scale: number): void {
    this.pixelScale = scale;
    this.cache.setScale(scale);
  }

  /** Rebuilds per-level caches (brick colours/kinds, sprites, effects). Call on every (re)start. */
  loadLevel(world: World): void {
    this.bricks.clear();
    for (const b of world.bricks) this.bricks.set(b.id, { kind: b.kind, color: brickColor(this.skin, b.kind, 1) });
    const grid = bricksBounds(world.bricks);
    this.bg.setLayout(world.bricks[0]?.seed ?? 1, grid);
    this.cache.clear();
    this.particles.clear();
    this.trailLen.fill(0);
  }

  onEvents(events: readonly GameEvent[]): void {
    const p = this.particles;
    const sk = this.skin;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'brickBreak': {
          const info = e.brickId === undefined ? undefined : this.bricks.get(e.brickId);
          p.emit('shred', e.x, e.y, 9, { color: info?.color ?? sk.brick[1], speed: 300 });
          p.emit('crumb', e.x, e.y, 3, {});
          this.shake.add(0.12);
          if (e.brickId !== undefined) this.cache.delete(e.brickId);
          break;
        }
        case 'brickHit': {
          let broken = false;
          for (let j = i + 1; j < events.length; j++) {
            if (events[j].type === 'brickBreak' && events[j].brickId === e.brickId) broken = true;
          }
          if (!broken) p.emit('speck', e.x, e.y, 4, { color: sk.graphite });
          break;
        }
        case 'paddle':
          p.emit('tick', e.x, e.y, 4, { angle: -Math.PI / 2, spread: 1, color: sk.ink });
          break;
        case 'wall':
          p.emit('speck', e.x, e.y, 2, { color: sk.graphite, speed: 90 });
          break;
        case 'lifeLost':
          this.shake.add(0.7);
          p.emit('tick', e.x, H - 20, 14, { angle: -Math.PI / 2, spread: 1.4, speed: 320, size: 16, life: 0.5, color: sk.ink });
          p.emit('speck', e.x, H - 20, 14, { speed: 260, color: sk.ink, life: 0.7 });
          break;
        case 'won':
          this.shake.add(0.2);
          for (let k = 0; k < 6; k++) {
            const c = k % 3 === 0 ? sk.brick[1] : k % 3 === 1 ? sk.brick[2] : sk.brick[3];
            p.emit('shred', W * (0.1 + 0.16 * k), CONFIG.topWall + 40, 9, {
              color: c,
              angle: Math.PI / 2,
              spread: 1.2,
              speed: 380,
              life: 1.8,
              gravity: 350,
              size: 7,
            });
          }
          break;
        default:
          break;
      }
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    world: World,
    prev: readonly { x: number; y: number }[],
    alpha: number,
    time: number,
  ): void {
    const dt = this.lastTime < 0 ? 0 : Math.min(0.05, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.particles.update(dt);
    this.shake.update(dt);

    this.bg.draw(ctx, this.pixelScale);

    ctx.translate(this.shake.x, this.shake.y);
    this.frame.draw(ctx, time);
    this.drawBricks(ctx, world, time);
    this.drawPaddle(ctx, world, time);
    this.drawBalls(ctx, world, prev, alpha, time);
    this.particles.draw(ctx);
    ctx.translate(-this.shake.x, -this.shake.y);

    this.drawHud(ctx, world, time);
    this.drawMessage(ctx, world, time);
    if (this.showFps) this.drawFps(ctx, dt);
  }

  private drawBricks(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const list = world.bricks;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      let s = this.cache.get(b.id, b.hp);
      if (!s) {
        s = this.cache.build(b.id, b.hp, b.w, b.h, BRICK_PAD, (g, v) => renderBrick(g, this.skin, b, v));
      }
      s.draw(ctx, b.x, b.y, time, b.seed);
    }
  }

  private drawPaddle(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const p = world.paddle;
    let s = this.cache.get('paddle', p.w * 1000 + p.h);
    if (!s) s = this.cache.build('paddle', p.w * 1000 + p.h, p.w, p.h, PADDLE_PAD, (g, v) => renderPaddle(g, this.skin, p.w, p.h, v));
    s.draw(ctx, p.x - p.w / 2, p.y, time, 7);
  }

  private ballSprite(r: number): Sprite {
    const tag = Math.round(r * 10);
    return this.cache.get('ball', tag) ?? this.cache.build('ball', tag, r * 2, r * 2, BALL_PAD, (g, v) => renderBall(g, this.skin, r, v));
  }

  private drawBalls(
    ctx: CanvasRenderingContext2D,
    world: World,
    prev: readonly { x: number; y: number }[],
    alpha: number,
    time: number,
  ): void {
    const balls = world.balls;
    for (let i = 0; i < balls.length && i < MAX_TRAILS; i++) {
      const b = balls[i];
      const pv = prev[i] ?? b;
      const x = pv.x + (b.x - pv.x) * alpha;
      const y = pv.y + (b.y - pv.y) * alpha;
      const base = i * TRAIL * 2;
      if (b.stuck) {
        this.trailLen[i] = 0;
      } else {
        // Push the newest position; reset when the ball teleported.
        let n = this.trailLen[i];
        if (n > 0 && Math.hypot(this.trail[base] - x, this.trail[base + 1] - y) > 120) n = 0;
        if (n === 0 || Math.hypot(this.trail[base] - x, this.trail[base + 1] - y) > 6) {
          for (let k = Math.min(n, TRAIL - 1); k > 0; k--) {
            this.trail[base + k * 2] = this.trail[base + (k - 1) * 2];
            this.trail[base + k * 2 + 1] = this.trail[base + (k - 1) * 2 + 1];
          }
          this.trail[base] = x;
          this.trail[base + 1] = y;
          n = Math.min(TRAIL, n + 1);
        }
        this.trailLen[i] = n;
        // Faint smudge behind the ball.
        ctx.fillStyle = this.skin.graphite;
        for (let k = 1; k < n; k++) {
          ctx.globalAlpha = 0.16 * (1 - k / TRAIL);
          ctx.beginPath();
          ctx.arc(this.trail[base + k * 2], this.trail[base + k * 2 + 1], b.r * (1 - k * 0.09), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      this.ballSprite(b.r).draw(ctx, x - b.r, y - b.r, time, 5 + i);
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    ctx.font = `28px ${this.skin.font}`;
    ctx.fillStyle = this.skin.ink;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (world.score !== this.scoreValue) {
      this.scoreValue = world.score;
      this.scoreText = `Score ${world.score}`;
    }
    ctx.fillText(this.scoreText, 18, CONFIG.topWall / 2 + 2);
    // Lives as little doodled balls; kept clear of the DOM gear button at the top right.
    const sprite = this.ballSprite(CONFIG.ballR);
    const s = 1.5;
    const step = CONFIG.ballR * 2 * s + 10;
    const right = W - 86;
    for (let i = 0; i < world.lives; i++) {
      sprite.draw(ctx, right - (i + 1) * step + 10, CONFIG.topWall / 2 - CONFIG.ballR * s + 2, time, 11 + i, s);
    }
  }

  private drawMessage(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const text =
      world.status === 'serve'
        ? 'Tap to launch'
        : world.status === 'won'
          ? 'You win! Tap to play again'
          : world.status === 'gameover'
            ? 'Game over. Tap to retry'
            : '';
    if (!text) return;
    let tw = this.msgWidth.get(text);
    if (tw === undefined) {
      ctx.font = `${MSG_PX}px ${this.skin.font}`;
      tw = Math.ceil(ctx.measureText(text).width) + 16;
      this.msgWidth.set(text, tw);
    }
    const w = tw;
    const h = MSG_PX + 14;
    let s = this.cache.get(text, text);
    if (!s) s = this.cache.build(text, text, w, h, MSG_PAD, (g, v) => renderMessage(g, this.skin, text, w, h, MSG_PX, v));
    s.draw(ctx, (W - w) / 2, H / 2 - h / 2, time, 3);
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
    ctx.fillStyle = '#2b2b2b';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${this.fps} fps`, 8, H - 8);
  }
}
