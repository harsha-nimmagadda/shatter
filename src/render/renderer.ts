import { CONFIG, EFFECT_NAMES, comboMultiplier, paddleSegments, type Brick, type GameEvent, type World } from '../engine';
import { Background, PlayFrame } from './background';
import { bricksBounds } from './artLayout';
import { BoilCache, type Sprite } from './boil';
import { Particles } from './particles';
import { Shake } from './shake';
import { NOTEBOOK_SKIN, type Skin } from './skin';
import { PowerFx } from './powerFx';
import {
  BAD_COLOR,
  CAPSULE_PAD,
  CAPSULE_SIZE,
  ERASER_H,
  ERASER_W,
  GOOD_COLOR,
  HUD_ICON,
  HUD_PAD,
  NET_H,
  NET_PAD,
  OVERLAY_PAD,
  PLANE_SIZE,
  capsuleColor,
  renderCapsule,
  renderEraser,
  renderGhostBrick,
  renderHudIcon,
  renderNet,
  renderPaddleOverlay,
  renderPlane,
  renderStyledBall,
  type BallStyle,
  type OverlayKind,
} from './powerSprites';
import {
  ballRenderPos,
  clipTilt,
  comboHudText,
  comboLabel,
  effectFraction,
  isBadPower,
  lerpTowards,
  powerName,
  trailColor,
  type XY,
} from './powerVisuals';
import {
  BALL_PAD,
  BRICK_PAD,
  MSG_PAD,
  PADDLE_PAD,
  brickColor,
  EXPLOSIVE_FILL,
  renderBall,
  renderHiddenCrease,
  renderBrick,
  renderMessage,
  renderPaddle,
  type PaddleStyle,
} from './sprites';

const W = CONFIG.width;
const H = CONFIG.height;
const TRAIL = 7;
const MAX_TRAILS = 8;
const MSG_PX = 40;

interface BrickInfo {
  kind: 'normal' | 'steel';
  color: string;
  w: number;
  h: number;
}

const COMBO_BLUE = '#2B5B9E';
const GOLD = '#F2B705';
const SPLAT_GREEN = '#39FF14';

const POP_SCALE = 0.28;
const GHOST_KEY = 'ghost';
/** Appends one jagged vertical edge at x to the current path (no moveTo). */
function zigzagLine(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number): void {
  ctx.moveTo(x, y0);
  const n = Math.max(2, Math.round((y1 - y0) / 4));
  for (let i = 1; i <= n; i++) ctx.lineTo(x + (i % 2 === 0 ? -2.2 : 2.2), y0 + ((y1 - y0) * i) / n);
}

/**
 * Adds a closed clip region to the current path: from the far edge `far` to a jagged cut at `cut`.
 * `leftSide` = the region lies to the left of the cut.
 */
function zigzag(ctx: CanvasRenderingContext2D, far: number, cut: number, y0: number, y1: number, leftSide: boolean): void {
  const n = Math.max(2, Math.round((y1 - y0) / 4));
  ctx.moveTo(leftSide ? far : cut, y0);
  if (leftSide) {
    ctx.lineTo(cut, y0);
    for (let i = 1; i <= n; i++) ctx.lineTo(cut + (i % 2 === 0 ? -2.2 : 2.2), y0 + ((y1 - y0) * i) / n);
    ctx.lineTo(far, y1);
  } else {
    ctx.lineTo(far, y0);
    ctx.lineTo(far, y1);
    for (let i = n; i >= 0; i--) ctx.lineTo(cut + (i % 2 === 0 ? -2.2 : 2.2), y0 + ((y1 - y0) * i) / n);
  }
  ctx.closePath();
}

/** Small filled heart centred at (cx, cy), `r` = half width. */
function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, ink: string): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.95);
  ctx.bezierCurveTo(cx - r * 1.5, cy - r * 0.1, cx - r * 0.7, cy - r * 1.2, cx, cy - r * 0.35);
  ctx.bezierCurveTo(cx + r * 0.7, cy - r * 1.2, cx + r * 1.5, cy - r * 0.1, cx, cy + r * 0.95);
  ctx.closePath();
  ctx.fillStyle = '#FF3B5C';
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

const OVERLAY_IDX: Record<OverlayKind, number> = { ticks: 1, glue: 2, staplers: 3, paperclip: 4 };

export class Renderer {
  readonly shake = new Shake();
  readonly particles = new Particles(400);
  readonly fx = new PowerFx();
  private readonly cache = new BoilCache(512);
  private readonly bg: Background;
  private readonly frame: PlayFrame;
  private readonly bricks = new Map<number, BrickInfo>();
  private readonly msgWidth = new Map<string, number>();
  private readonly trail = new Float32Array(MAX_TRAILS * TRAIL * 2);
  private readonly trailLen = new Uint8Array(MAX_TRAILS);
  private readonly keyMaps = new Map<string, Map<string, string>>();
  private readonly pos: XY = { x: 0, y: 0 };
  private lastTime = -1;
  private pixelScale = 1;
  private readonly showFps: boolean;
  private fps = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private scoreText = '';
  private scoreValue = -1;
  private hasMoving = false;
  private trackX0 = 0;
  private trackX1: number = W;
  private comboText = '';
  private comboValue = 1;
  private dispW: number = CONFIG.paddleW;
  private lastBallCount = 0;
  private frameNo = 0;
  private shaveAcc = 0;
  private padW: number = CONFIG.paddleW;

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
    this.hasMoving = false;
    for (const b of world.bricks) {
      this.bricks.set(b.id, { kind: b.kind, color: brickColor(this.skin, b.type, b.maxHp), w: b.w, h: b.h });
      if (b.type === 'moving') this.hasMoving = true;
    }
    const grid = bricksBounds(world.bricks);
    this.bg.setLayout(world.bricks[0]?.seed ?? 1, grid);
    this.trackX0 = grid ? grid.x : 0;
    this.trackX1 = grid ? grid.x + grid.w : W;
    this.cache.clear();
    this.particles.clear();
    this.fx.clear();
    this.trailLen.fill(0);
    this.dispW = world.paddle.w;
    this.padW = world.paddle.w;
    this.lastBallCount = 0;
  }

  /** Interned string keys so per-frame cache lookups never concatenate after the first call. */
  private key(prefix: string, name: string): string {
    let m = this.keyMaps.get(prefix);
    if (!m) {
      m = new Map();
      this.keyMaps.set(prefix, m);
    }
    let v = m.get(name);
    if (v === undefined) {
      v = prefix + name;
      m.set(name, v);
    }
    return v;
  }

  onEvents(events: readonly GameEvent[], world?: World): void {
    const p = this.particles;
    const sk = this.skin;
    const padW = world ? world.paddle.w : this.padW;
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
            const c = k % 3 === 0 ? '#FFE600' : k % 3 === 1 ? '#00E5FF' : '#FF3B5C';
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
        case 'explode':
          this.fx.addBlast(e.x, e.y);
          p.emit('shred', e.x, e.y, 14, { color: EXPLOSIVE_FILL, speed: 420, life: 1 });
          p.emit('shred', e.x, e.y, 6, { color: '#ffd23f', speed: 320, size: 5 });
          p.emit('speck', e.x, e.y, 10, { color: sk.ink, speed: 300, life: 0.6 });
          this.shake.add(0.5);
          break;
        case 'regen':
          if (e.brickId !== undefined) this.fx.addPop(e.brickId);
          p.emit('speck', e.x, e.y, 6, { color: sk.graphite, speed: 120 });
          break;
        case 'reveal':
          if (e.brickId !== undefined) this.fx.addPop(e.brickId);
          p.emit('tick', e.x, e.y, 6, { color: sk.ink, speed: 130, size: 8, life: 0.25 });
          break;
        case 'powerup': {
          const bad = isBadPower(e.power ?? '');
          const col = e.power ? capsuleColor(e.power) : GOOD_COLOR;
          p.emit('tick', e.x, e.y, 8, { color: col, speed: 200, size: 11, life: 0.3 });
          p.emit('speck', e.x, e.y, 6, { color: col, speed: 150, life: 0.45 });
          if (e.power) this.fx.addFloat(powerName(e.power), e.x, e.y - 18, bad ? BAD_COLOR : col);
          if (e.power === 'redpen') this.fx.addSpeed(1);
          else if (e.power === 'correction') this.fx.addSpeed(-1);
          else if (e.power === 'scissors') this.shake.add(0.35);
          else if (e.power === 'sharpener') {
            p.emit('shred', e.x, e.y, 8, { color: '#e9c27a', angle: -Math.PI / 2, spread: 1.3, speed: 190, size: 3.5, life: 0.7, gravity: 500 });
          } else if (e.power === 'goldstar') this.goldBurst(e.x, e.y, false);
          break;
        }
        case 'extraLife':
          this.goldBurst(e.x, e.y, true);
          break;
        case 'splash': {
          const info = e.brickId === undefined ? undefined : this.bricks.get(e.brickId);
          const bw = info?.w ?? 50;
          const bh = info?.h ?? 22;
          const sp = { color: SPLAT_GREEN, speed: 170, size: 3.2, life: 0.5, gravity: 200 };
          p.emit('speck', e.x, e.y, 6, sp);
          p.emit('speck', e.x - bw, e.y, 4, sp);
          p.emit('speck', e.x + bw, e.y, 4, sp);
          p.emit('speck', e.x, e.y - bh, 4, sp);
          p.emit('speck', e.x, e.y + bh, 4, sp);
          break;
        }
        case 'clipLoose':
          if (e.brickId !== undefined) this.fx.addWobble(e.brickId);
          p.emit('tick', e.x, e.y, 3, { color: sk.steel, speed: 90, size: 6, life: 0.2 });
          break;
        case 'clipPop': {
          const info = e.brickId === undefined ? undefined : this.bricks.get(e.brickId);
          this.fx.addFlyer(e.x, e.y, info?.w ?? 50, info?.h ?? 22, e.x < W / 2 ? -1 : 1);
          this.fx.addFloat('pop!', e.x, e.y - 8, sk.ink);
          p.emit('speck', e.x, e.y, 6, { color: sk.steel, speed: 180, life: 0.4 });
          break;
        }
        case 'combo':
          if (e.value !== undefined) this.fx.addFloat(comboLabel(e.value), e.x, e.y - 6, COMBO_BLUE);
          break;
        case 'powerMiss':
          p.emit('speck', e.x, H - 6, 4, { angle: -Math.PI / 2, spread: 1, speed: 80, color: sk.graphite, life: 0.35 });
          break;
        case 'effectEnd':
          p.emit('speck', e.x, e.y, 5, { angle: -Math.PI / 2, spread: 1.4, speed: 90, color: sk.graphite, life: 0.4 });
          break;
        case 'staple':
          for (let k = -1; k <= 1; k += 2) {
            p.emit('speck', e.x + k * (padW / 2 - 6), e.y - 12, 2, { angle: -Math.PI / 2, spread: 0.6, speed: 120, size: 1.6, life: 0.18, color: '#8b9099', gravity: 0 });
          }
          break;
        case 'eraser':
          this.fx.addEraser(e.y);
          break;
        case 'net':
          for (let k = 0; k < 16; k++) {
            p.emit('shred', 20 + (k * (W - 40)) / 15, H - 18, 1, { color: '#f9e46a', angle: -Math.PI / 2, spread: 1, speed: 220, size: 6, life: 0.9 });
          }
          this.shake.add(0.15);
          break;
        default:
          break;
      }
    }
  }

  /** Gold sparkle burst; `plusOne` adds the floating "+1". */
  private goldBurst(x: number, y: number, plusOne: boolean): void {
    const p = this.particles;
    p.emit('tick', x, y, 10, { color: GOLD, speed: 230, size: 12, life: 0.45 });
    p.emit('speck', x, y, 10, { color: '#FFE600', speed: 200, size: 2.6, life: 0.6, gravity: 80 });
    if (plusOne) this.fx.addFloat('+1', x, y - 24, GOLD);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    world: World,
    prev: readonly XY[],
    alpha: number,
    time: number,
  ): void {
    const dt = this.lastTime < 0 ? 0 : Math.min(0.05, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.frameNo++;
    this.padW = world.paddle.w;
    this.particles.update(dt);
    this.fx.update(dt);
    this.shake.update(dt);

    this.bg.draw(ctx, this.pixelScale);

    ctx.translate(this.shake.x, this.shake.y);
    this.frame.draw(ctx, time);
    this.drawGhosts(ctx, world, time);
    this.drawBricks(ctx, world, time);
    this.drawBlastFlash(ctx, world, time);
    this.drawNet(ctx, world, time);
    this.drawPaddle(ctx, world, dt, time);
    this.drawBalls(ctx, world, prev, alpha, time);
    this.drawDrops(ctx, world, time);
    this.drawBolts(ctx, world);
    this.fx.drawErasers(ctx, this.eraserSprite(), ERASER_W, ERASER_H, time, this.crumb);
    this.fx.drawFlyers(ctx, this.skin);
    this.particles.draw(ctx);
    this.fx.drawBlasts(ctx, this.skin);
    this.fx.drawFloats(ctx, this.skin);
    ctx.translate(-this.shake.x, -this.shake.y);

    this.fx.drawSpeed(ctx, time);
    this.drawHud(ctx, world, time);
    this.drawMessage(ctx, world, time);
    if (this.showFps) this.drawFps(ctx, dt);
  }

  private readonly crumb = (x: number, y: number): void => {
    this.particles.emit('crumb', x, y, 1, { color: this.skin.eraser, speed: 70, angle: Math.PI / 2, spread: 1.2, life: 0.6 });
  };

  private eraserSprite(): Sprite {
    const k = this.key('', 'eraser');
    return this.cache.get(k, 1) ?? this.cache.build(k, 1, ERASER_W, ERASER_H, 4, (g, v) => renderEraser(g, this.skin, ERASER_W, ERASER_H, v));
  }

  private brickSprite(b: Brick): Sprite {
    let s = this.cache.get(b.id, b.hp);
    if (!s) {
      s = this.cache.build(b.id, b.hp, b.w, b.h, BRICK_PAD, (g, v) => renderBrick(g, this.skin, b, v));
    }
    return s;
  }

  /** Faint crease / watermark for an unrevealed Invisible Ink brick. */
  private creaseSprite(b: Brick): Sprite {
    const k = this.key('crease-', String(b.id));
    return this.cache.get(k, 'c') ?? this.cache.build(k, 'c', b.w, b.h, BRICK_PAD, (g, v) => renderHiddenCrease(g, this.skin, b.w, b.h, v, b.seed));
  }

  private drawBricks(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const list = world.bricks;
    if (this.hasMoving) {
      // Faint dotted track along the row span of each sliding tab.
      ctx.strokeStyle = this.skin.graphite;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.setLineDash([1, 6]);
      ctx.globalAlpha = 0.35;
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
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.hidden) {
        ctx.globalAlpha = 0.3;
        this.creaseSprite(b).draw(ctx, b.x, b.y, time, b.seed);
        ctx.globalAlpha = 1;
        continue;
      }
      const s = this.brickSprite(b);
      const pa = this.fx.popAgeOf(b.id);
      if (pa >= 0) {
        // Quick sketch-in pop: starts bigger and faint, settles to normal.
        const t = pa / 0.3;
        const k = 1 + POP_SCALE * (1 - t) * (1 - t);
        ctx.save();
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
        ctx.scale(k, k);
        ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, t * 1.5);
        s.draw(ctx, -b.w / 2, -b.h / 2, time, b.seed);
        ctx.restore();
      } else if (b.kind === 'steel') {
        const rot = clipTilt(b.streakHits, time, b.id) + this.fx.wobbleOf(b.id);
        if (rot !== 0) {
          ctx.save();
          ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
          ctx.rotate(rot);
          s.draw(ctx, -b.w / 2, -b.h / 2, time, b.seed);
          ctx.restore();
        } else s.draw(ctx, b.x, b.y, time, b.seed);
      } else {
        s.draw(ctx, b.x, b.y, time, b.seed);
      }
    }
    if (this.hasMoving) {
      ctx.strokeStyle = this.skin.ink;
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.type !== 'moving' || b.vx === 0 || b.hidden) continue;
        const dir = b.vx > 0 ? 1 : -1;
        const ex = dir > 0 ? b.x - 1 : b.x + b.w + 1;
        for (let k = 0; k < 3; k++) {
          const len = 6 + 5 * (0.5 + 0.5 * Math.sin(time * 18 + b.id * 1.3 + k * 2));
          const y = b.y + b.h * (0.28 + 0.22 * k);
          ctx.moveTo(ex, y);
          ctx.lineTo(ex - dir * len, y);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** Waiting regenerating bricks: a faint dashed outline that re-draws itself progressively over the delay. */
  private drawGhosts(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const gs = world.ghosts;
    if (gs.length === 0) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < gs.length; i++) {
      const b = gs[i].brick;
      const prog = Math.max(0, Math.min(1, 1 - gs[i].timer / CONFIG.regenDelay));
      const gk = this.key('', GHOST_KEY);
      // Cached per size; all bricks share one size, so a single key is fine (tag = width * 100 + height).
      const tag = Math.round(b.w) * 1000 + Math.round(b.h);
      const g = this.cache.get(gk, tag) ?? this.cache.build(gk, tag, b.w, b.h, BRICK_PAD, (c, v) => renderGhostBrick(c, this.skin, b.w, b.h, v));
      ctx.globalAlpha = 0.14;
      g.draw(ctx, b.x, b.y, time, b.seed);
      if (prog > 0.02) {
        // Solid-ish pen line growing around the perimeter.
        const per = (b.w + b.h) * 2;
        ctx.setLineDash([per * prog, per]);
        ctx.strokeStyle = this.skin.ink;
        ctx.lineWidth = 1.8;
        ctx.globalAlpha = 0.25 + 0.5 * prog;
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        ctx.setLineDash([]);
      }
      if (prog > 0.85) {
        ctx.globalAlpha = (prog - 0.85) * 3;
        this.brickSprite(b).draw(ctx, b.x, b.y, time, b.seed);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Chained explosives about to go off flicker briefly. */
  private drawBlastFlash(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const bl = world.blasts;
    if (bl.length === 0) return;
    ctx.fillStyle = '#ffd23f';
    for (let i = 0; i < bl.length; i++) {
      const id = bl[i].brickId;
      for (let j = 0; j < world.bricks.length; j++) {
        const b = world.bricks[j];
        if (b.id !== id) continue;
        ctx.globalAlpha = 0.35 + 0.3 * Math.sin(time * 70 + i);
        ctx.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawNet(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    if (!world.net) return;
    const k = this.key('', 'net');
    const s = this.cache.get(k, 1) ?? this.cache.build(k, 1, W, NET_H, NET_PAD, (g, v) => renderNet(g, this.skin, W, NET_H, v));
    s.draw(ctx, 0, H - CONFIG.netInset - 2, time, 9);
  }

  private overlay(kind: OverlayKind, rw: number, h: number): Sprite {
    // Numeric keys: paddle sprites use -rw, overlays -(kind * 100000 + rw); brick ids are positive.
    const key = -(OVERLAY_IDX[kind] * 100000 + rw);
    const tag = rw * 100 + h;
    return this.cache.get(key, tag) ?? this.cache.build(key, tag, rw, h, OVERLAY_PAD, (g, v) => renderPaddleOverlay(g, this.skin, kind, rw, h, v));
  }

  private drawPaddle(ctx: CanvasRenderingContext2D, world: World, dt: number, time: number): void {
    const p = world.paddle;
    const eff = world.effects;
    this.dispW = lerpTowards(this.dispW, p.w, dt);
    const rw = Math.round(p.w);
    const tag = rw * 1000 + p.h;
    const ruler = eff.ruler !== undefined;
    // Number keys <= -1 are reserved for the paddle (brick ids are positive): pencil -rw, ruler -(10000 + rw).
    const key = ruler ? -(10000 + rw) : -rw;
    const style: PaddleStyle = ruler ? 'ruler' : 'pencil';
    const s = this.cache.get(key, tag) ?? this.cache.build(key, tag, rw, p.h, PADDLE_PAD, (g, v) => renderPaddle(g, this.skin, rw, p.h, v, style));
    const sx = this.dispW / rw;
    const x0 = p.x - this.dispW / 2;
    const scissors = eff.scissors !== undefined;
    if (eff.paperclip !== undefined) this.drawMagnet(ctx, p.x, p.y, time);
    ctx.save();
    if (scissors) {
      const segs = paddleSegments(world);
      ctx.beginPath();
      zigzag(ctx, x0 - 20, segs[0][1], p.y - 14, p.y + p.h + 14, true);
      zigzag(ctx, p.x + this.dispW / 2 + 20, segs[1][0], p.y - 14, p.y + p.h + 14, false);
      ctx.clip();
    }
    ctx.save();
    ctx.translate(x0, p.y);
    if (Math.abs(sx - 1) > 0.002) ctx.scale(sx, 1);
    s.draw(ctx, 0, 0, time, 7);
    if (ruler) this.overlay('ticks', rw, p.h).draw(ctx, 0, 0, time, 8);
    if (eff.gluestick !== undefined) this.overlay('glue', rw, p.h).draw(ctx, 0, 0, time, 10);
    if (eff.stapler !== undefined) this.overlay('staplers', rw, p.h).draw(ctx, 0, 0, time, 11);
    if (eff.paperclip !== undefined) this.overlay('paperclip', rw, p.h).draw(ctx, 0, 0, time, 12);
    ctx.restore();
    ctx.restore();
    if (scissors) {
      // Ragged cut edges of the two halves.
      const segs = paddleSegments(world);
      ctx.strokeStyle = this.skin.ink;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      zigzagLine(ctx, segs[0][1], p.y - 1, p.y + p.h + 1);
      zigzagLine(ctx, segs[1][0], p.y - 1, p.y + p.h + 1);
      ctx.stroke();
    }
    if (eff.sharpener !== undefined && dt > 0) {
      this.shaveAcc += dt * 5;
      while (this.shaveAcc >= 1) {
        this.shaveAcc -= 1;
        const px = p.x + Math.sin(time * 13 + this.frameNo) * this.dispW * 0.4;
        this.particles.emit('shred', px, p.y, 1, { color: '#e9c27a', angle: -Math.PI / 2, spread: 1.2, speed: 110, size: 3.5, life: 0.6, gravity: 500 });
      }
    }
  }

  /** Faint contracting magnet arcs above the paddle while the paperclip is active. */
  private drawMagnet(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
    ctx.strokeStyle = '#8a9099';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const f = (time * 0.7 + k / 3) % 1;
      const r = 34 + (1 - f) * 70;
      ctx.globalAlpha = 0.2 * Math.sin(f * Math.PI);
      ctx.beginPath();
      ctx.arc(x, y + 10, r, -Math.PI * 0.88, -Math.PI * 0.12);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private ballSprite(r: number, style?: BallStyle): Sprite {
    const tag = Math.round(r * 10);
    if (style) {
      const R = r * 1.35;
      const k = this.key('ball-', style);
      return (
        this.cache.get(k, tag) ??
        this.cache.build(k, tag, R * 2, R * 2, BALL_PAD, (g, v) =>
          renderStyledBall(g, this.skin, style, r, v),
        )
      );
    }
    return this.cache.get('ball', tag) ?? this.cache.build('ball', tag, r * 2, r * 2, BALL_PAD, (g, v) => renderBall(g, this.skin, r, v));
  }

  private planeSprite(): Sprite {
    const k = this.key('', 'plane');
    return this.cache.get(k, 1) ?? this.cache.build(k, 1, PLANE_SIZE, PLANE_SIZE, 2, (g, v) => renderPlane(g, this.skin, v));
  }

  private drawBalls(
    ctx: CanvasRenderingContext2D,
    world: World,
    prev: readonly XY[],
    alpha: number,
    time: number,
  ): void {
    const balls = world.balls;
    if (balls.length !== this.lastBallCount) {
      this.lastBallCount = balls.length;
      this.trailLen.fill(0);
    }
    const eff = world.effects;
    const style: BallStyle | undefined =
      (eff.crumpled !== undefined ? 'crumpled' : undefined) as BallStyle | undefined;
    const plane = eff.plane !== undefined;
    const tc = trailColor(eff);
    for (let i = 0; i < balls.length && i < MAX_TRAILS; i++) {
      const b = balls[i];
      const { x, y } = ballRenderPos(prev, i, balls.length, b, b.stuck, alpha, this.pos);
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
        // Short highlighter trail, tinted by the active ball power.
        ctx.strokeStyle = tc.color;
        ctx.lineWidth = b.r * 1.7;
        ctx.lineCap = 'round';
        for (let k = 1; k < n; k++) {
          ctx.globalAlpha = tc.alpha * (1 - (k - 1) / TRAIL);
          ctx.beginPath();
          ctx.moveTo(this.trail[base + (k - 1) * 2], this.trail[base + (k - 1) * 2 + 1]);
          ctx.lineTo(this.trail[base + k * 2], this.trail[base + k * 2 + 1]);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (plane) this.drawPlane(ctx, b.vx, b.vy, b.stuck, x, y, time, i);
      const crumpled = style === 'crumpled';
      const R = crumpled ? b.r * 1.35 : b.r;
      const sprite = this.ballSprite(b.r, style);
      sprite.draw(ctx, x - R, y - R, time, 5 + i);
    }
  }

  private drawPlane(ctx: CanvasRenderingContext2D, vx: number, vy: number, stuck: boolean, x: number, y: number, time: number, seed: number): void {
    const ang = stuck ? -Math.PI / 2 : Math.atan2(vy, vx);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (!stuck) {
      ctx.strokeStyle = this.skin.ink;
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(-16, -4);
      ctx.lineTo(-26, -4);
      ctx.moveTo(-18, 4);
      ctx.lineTo(-30, 4);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.planeSprite().draw(ctx, -PLANE_SIZE / 2 - 2, -PLANE_SIZE / 2, time, seed);
    ctx.restore();
  }

  private drawDrops(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const drops = world.drops;
    const w = CAPSULE_SIZE;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      const k = this.key('drop-', d.type);
      const s = this.cache.get(k, 1) ?? this.cache.build(k, 1, w, w, CAPSULE_PAD, (g, v) => renderCapsule(g, this.skin, d.type, w, v));
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(Math.sin(time * 3.5 + d.id * 1.7) * 0.14);
      s.draw(ctx, -w / 2, -w / 2, time, d.id);
      ctx.restore();
    }
  }

  /** Staples: little silver upside-down U shapes (crown on top, legs pointing up the screen). */
  private drawBolts(ctx: CanvasRenderingContext2D, world: World): void {
    const bolts = world.bolts;
    if (bolts.length === 0) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.skin.ink;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    for (let i = 0; i < bolts.length; i++) {
      const b = bolts[i];
      ctx.moveTo(b.x - 3.5, b.y + 6);
      ctx.lineTo(b.x - 3.5, b.y);
      ctx.lineTo(b.x + 3.5, b.y);
      ctx.lineTo(b.x + 3.5, b.y + 6);
    }
    ctx.stroke();
    ctx.strokeStyle = '#b4b9c1';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < bolts.length; i++) {
      const b = bolts[i];
      ctx.moveTo(b.x - 3.5, b.y + 5);
      ctx.lineTo(b.x - 3.5, b.y);
      ctx.lineTo(b.x + 3.5, b.y);
      ctx.lineTo(b.x + 3.5, b.y + 5);
    }
    ctx.stroke();
  }

  private hudIcon(name: string): Sprite {
    const k = this.key('hud-', name);
    return this.cache.get(k, 1) ?? this.cache.build(k, 1, HUD_ICON, HUD_ICON, HUD_PAD, (g, v) => renderHudIcon(g, this.skin, name, HUD_ICON, v));
  }

  private drawHud(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    ctx.font = `26px ${this.skin.font}`;
    ctx.fillStyle = this.skin.ink;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (world.score !== this.scoreValue) {
      this.scoreValue = world.score;
      this.scoreText = `Score ${world.score}`;
    }
    ctx.fillText(this.scoreText, 18, 21);
    // Lives as hearts; kept clear of the DOM gear button at the top right.
    const step = 24;
    const right = W - 86;
    for (let i = 0; i < world.lives; i++) drawHeart(ctx, right - (i + 0.5) * step, 21, 9, this.skin.ink);
    // Combo multiplier (hidden at 1x) under the hearts, right-aligned.
    const mul = comboMultiplier(world);
    if (mul !== this.comboValue) {
      this.comboValue = mul;
      this.comboText = comboHudText(mul);
    }
    if (this.comboText) {
      ctx.font = `22px ${this.skin.font}`;
      ctx.fillStyle = COMBO_BLUE;
      ctx.textAlign = 'right';
      ctx.fillText(this.comboText, W - 18, 47);
      ctx.textAlign = 'left';
    }
    this.drawEffectsRow(ctx, world, time);
  }

  /** Second HUD row (under the score, above the top wall): timed-effect icons with a shrinking pencil arc. */
  private drawEffectsRow(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const cy = 46;
    let x = 30;
    ctx.lineCap = 'round';
    for (let i = 0; i < EFFECT_NAMES.length; i++) {
      const name = EFFECT_NAMES[i];
      const left = world.effects[name];
      if (left === undefined) continue;
      const f = effectFraction(name, left);
      this.hudIcon(name).draw(ctx, x - HUD_ICON / 2, cy - HUD_ICON / 2, time, i);
      ctx.strokeStyle = f < 0.25 && Math.floor(time * 6) % 2 === 0 ? BAD_COLOR : this.skin.graphite;
      ctx.lineWidth = 2.4;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(x, cy, 13.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
      ctx.stroke();
      ctx.globalAlpha = 1;
      x += 33;
    }
    if (world.net) {
      ctx.fillStyle = '#f9e46a';
      ctx.fillRect(x - 12, cy - 8, 16, 16);
      ctx.strokeStyle = this.skin.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 12, cy - 8, 16, 16);
      ctx.beginPath();
      ctx.moveTo(x - 9, cy - 3);
      ctx.lineTo(x, cy - 3);
      ctx.moveTo(x - 9, cy + 2);
      ctx.lineTo(x - 3, cy + 2);
      ctx.stroke();
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
