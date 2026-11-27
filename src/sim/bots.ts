import {
  CELL_W, CONFIG as C, GRID_X, POWER_TYPES, createRng, isPositive, maxBounceDeg,
  type Input, type PowerType, type World,
} from '../engine';

export type BotSkill = 'pro' | 'casual' | 'novice';
export const BOT_SKILLS: readonly BotSkill[] = ['pro', 'casual', 'novice'];

export interface SkillParams {
  /** Reaction delay, seconds: the bot decides from the world as it was this long ago. */
  delay: number;
  /** Aim noise sigma, px (not used for the crossing estimate; kept for documentation/tests). */
  noise: number;
  /** Paddle speed limit, px/s. */
  maxSpeed: number;
  /** Chance per second of looking away (paddle frozen). */
  lookAwayRate: number;
  lookAwaySec: number;
  /** Crossing-estimate error: sigma = estBase + estK * timeToImpact + bounceErr * wallBounces. */
  estBase: number;
  estK: number;
  bounceErr: number;
  /** Seconds between refinements of the committed estimate. */
  rethink: number;
  /** Extra delay before switching to a more urgent ball. */
  switchDelay: number;
  /** Probability a volley aims the outgoing angle at the densest brick cluster. */
  aimProb: number;
  /** Noise on the aimed offset (fraction of half-width). */
  aimNoise: number;
  /** Novice: chases the delayed ball x (smoothing lag, s) until time-to-impact < predictBelow. 0 = always predicts. */
  chaseLag: number;
  predictBelow: number;
}

export const SKILLS: Record<BotSkill, SkillParams> = {
  pro: {
    delay: 0.06, noise: 4, maxSpeed: C.paddleMaxSpeed, lookAwayRate: 0, lookAwaySec: 0,
    estBase: 3, estK: 10, bounceErr: 6, rethink: 0.08, switchDelay: 0.08, aimProb: 1, aimNoise: 0.08,
    chaseLag: 0, predictBelow: 0,
  },
  casual: {
    delay: 0.15, noise: 14, maxSpeed: 1400, lookAwayRate: 0, lookAwaySec: 0,
    estBase: 18, estK: 60, bounceErr: 35, rethink: 0.18, switchDelay: 0.2, aimProb: 0.4, aimNoise: 0.15,
    chaseLag: 0, predictBelow: 0,
  },
  novice: {
    delay: 0.26, noise: 26, maxSpeed: 900, lookAwayRate: 0.03, lookAwaySec: 0.4,
    estBase: 12, estK: 50, bounceErr: 40, rethink: 0.2, switchDelay: 0.35, aimProb: 0, aimNoise: 0,
    chaseLag: 0.25, predictBelow: 0.35,
  },
};

export interface Bot {
  readonly skill: BotSkill;
  /** Produces this step's input from the (current) world. Call exactly once per step. */
  act(world: World, dt: number): Input;
}

/** How much the bot wants each capsule (positive ones only; hazards are avoided). */
const VALUE: Record<PowerType, number> = {
  goldstar: 10, photocopy: 8, stapler: 7, ruler: 7, stickynote: 6, crumpled: 6, eraser: 5, highlighter: 5,
  plane: 4, gluestick: 3, paperclip: 3, correction: 3, sharpener: 0, scissors: 0, redpen: 0,
};
const TYPE_INDEX: Record<string, number> = Object.fromEntries(POWER_TYPES.map((t, i) => [t, i]));
const DEG = Math.PI / 180;
const MAX_B = C.maxBalls;
const MAX_D = 8;
const BALL_F = 5; // x, y, vx, vy, stuck
const DROP_F = 4; // x, y, vy, typeIndex
const DROP_HALF_W = C.dropW / 2;

/** Folds x + dx into [lo, hi] with mirror reflections at both ends. */
function bouncesOf(x: number, lo: number, hi: number): number {
  return Math.abs(Math.floor((x - lo) / (hi - lo)));
}

function reflect(x: number, lo: number, hi: number): number {
  const span = hi - lo;
  const period = 2 * span;
  const m = (((x - lo) % period) + period) % period;
  return lo + (m <= span ? m : period - m);
}

export function createBot(skill: BotSkill, seed: number): Bot {
  const sp = SKILLS[skill];
  const rng = createRng(seed);
  const gauss = (): number => {
    const u = Math.max(1e-12, rng.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
  };

  // Ring buffer of the last few world snapshots (flat typed arrays, no per-step allocation).
  let cap = 0;
  let delaySteps = 0;
  let head = 0;
  let filled = 0;
  let nBalls: Uint8Array;
  let balls: Float64Array;
  let nDrops: Uint8Array;
  let drops: Float64Array;

  const record = (w: World): void => {
    head = (head + 1) % cap;
    if (filled < cap) filled++;
    let n = 0;
    for (const b of w.balls) {
      if (n >= MAX_B) break;
      const o = (head * MAX_B + n) * BALL_F;
      balls[o] = b.x; balls[o + 1] = b.y; balls[o + 2] = b.vx; balls[o + 3] = b.vy; balls[o + 4] = b.stuck ? 1 : 0;
      n++;
    }
    nBalls[head] = n;
    let m = 0;
    for (const d of w.drops) {
      if (m >= MAX_D) break;
      const o = (head * MAX_D + m) * DROP_F;
      drops[o] = d.x; drops[o + 1] = d.y; drops[o + 2] = d.vy; drops[o + 3] = TYPE_INDEX[d.type]!;
      m++;
    }
    nDrops[head] = m;
  };

  // Volley / timing state.
  let tracking = false;
  let impactAt = 0; // world time of the tracked ball's predicted impact
  let estX = 0; // committed crossing estimate
  let lastThink = -Infinity;
  let switchSince = -1;
  let smoothX = 0;
  let offsetU = 0; // aim offset as a fraction of paddle half-width
  let waitSince = -1;
  let waitFor = 0;
  let awayUntil = -1;

  /** Offset (fraction of half-width) that sends the ball toward the densest remaining brick cluster. */
  const aimedOffset = (w: World, crossX: number): number | null => {
    const col = new Array<number>(10).fill(0);
    const colY = new Array<number>(10).fill(0);
    const colN = new Array<number>(10).fill(0);
    for (const k of w.bricks) {
      if (k.type === 'steel' || k.type === 'regen') continue;
      const c = Math.max(0, Math.min(9, Math.floor((k.x - GRID_X) / CELL_W)));
      col[c]! += k.hp;
      colY[c]! += k.y + k.h / 2;
      colN[c]!++;
    }
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < 10; c++) {
      const sm = (col[c - 1] ?? 0) * 0.5 + col[c]! + (col[c + 1] ?? 0) * 0.5;
      const cx = GRID_X + c * CELL_W + CELL_W / 2;
      const score = sm - Math.abs(cx - crossX) / 400;
      if (sm > 0 && (best < 0 || score > bestScore)) {
        best = c;
        bestScore = score;
      }
    }
    if (best < 0) return null;
    const cx = GRID_X + best * CELL_W + CELL_W / 2;
    let sy = 0;
    let n = 0;
    for (let c = Math.max(0, best - 1); c <= Math.min(9, best + 1); c++) {
      sy += colY[c]!;
      n += colN[c]!;
    }
    const ty = n ? sy / n : 300;
    const lineY = w.paddle.y - C.ballR;
    const ang = Math.atan2(cx - crossX, lineY - ty);
    return ang / (maxBounceDeg(w) * DEG);
  };

  const reroll = (w: World, crossX: number): void => {
    const hw = w.paddle.w / 2;
    const scissors = w.effects.scissors !== undefined;
    let u: number | null = null;
    if (sp.aimProb > 0 && rng.next() < sp.aimProb) {
      const a = aimedOffset(w, crossX);
      if (a !== null) u = a + gauss() * sp.aimNoise;
    }
    if (u === null) u = rng.range(-0.3, 0.3);
    u = Math.max(-0.9, Math.min(0.9, u));
    if (scissors) {
      // Keep the hit point off the gap in the paddle centre.
      const minU = Math.min(0.9, 22 / hw);
      if (Math.abs(u) < minU) u = (u === 0 ? (rng.next() < 0.5 ? -1 : 1) : Math.sign(u)) * minU;
    }
    offsetU = u;
  };

  const eRem = new Float64Array(MAX_B);
  const eX = new Float64Array(MAX_B);
  const eBounce = new Float64Array(MAX_B);
  const eCur = new Float64Array(MAX_B);

  const act = (w: World, dt: number): Input => {
    if (cap === 0) {
      delaySteps = Math.max(0, Math.round(sp.delay / dt));
      cap = delaySteps + 1;
      nBalls = new Uint8Array(cap);
      balls = new Float64Array(cap * MAX_B * BALL_F);
      nDrops = new Uint8Array(cap);
      drops = new Float64Array(cap * MAX_D * DROP_F);
    }
    record(w);
    const input: Input = { paddleX: null, moveAxis: 0, fire: false };

    // Looking away: no input at all.
    if (w.time < awayUntil) return input;
    if (sp.lookAwayRate > 0 && rng.next() < sp.lookAwayRate * dt) {
      awayUntil = w.time + sp.lookAwaySec;
      return input;
    }

    // Fire: serve after 0.3-0.8 s, glued balls after 0.2-0.6 s.
    const serving = w.status === 'serve';
    const glued = !serving && w.balls.some((b) => b.stuck);
    if (serving || glued) {
      if (waitSince < 0) {
        waitSince = w.time;
        waitFor = serving ? rng.range(0.3, 0.8) : rng.range(0.2, 0.6);
      }
      if (w.time - waitSince >= waitFor) {
        input.fire = true;
        waitSince = -1;
      }
    } else {
      waitSince = -1;
    }

    const p = w.paddle;
    const hw = p.w / 2;
    const vmax = sp.maxSpeed;
    const slot = (head - Math.min(delaySteps, filled - 1) + cap) % cap;
    const wallLo = C.ballR;
    const wallHi = w.width - C.ballR;
    const lineY = p.y - C.ballR;

    // Descending balls from the delayed snapshot.
    let n = 0;
    let cand = -1;
    for (let i = 0; i < nBalls[slot]!; i++) {
      const o = (slot * MAX_B + i) * BALL_F;
      if (balls[o + 4] === 1) continue;
      const vy = balls[o + 3]!;
      if (vy <= 0) continue;
      const t = (lineY - balls[o + 1]!) / vy;
      const rem = t - sp.delay;
      if (t < 0 || rem < -0.03) continue;
      const ux = balls[o]! + balls[o + 2]! * t;
      eRem[n] = rem;
      eX[n] = reflect(ux, wallLo, wallHi);
      eBounce[n] = bouncesOf(ux, wallLo, wallHi);
      eCur[n] = balls[o]!;
      if (cand < 0 || rem < eRem[cand]!) cand = n;
      n++;
    }
    const now = w.time;
    let tr = -1;
    if (cand >= 0) {
      if (tracking) {
        const want = impactAt - now;
        let bd = 0.3;
        for (let i = 0; i < n; i++) {
          const d = Math.abs(eRem[i]! - want);
          if (d < bd) {
            bd = d;
            tr = i;
          }
        }
      }
      let adopt = false;
      if (tr < 0) adopt = true;
      else if (eRem[cand]! < eRem[tr]! - 0.1) {
        // A more urgent ball appeared: switch only after the attention delay.
        if (switchSince < 0) switchSince = now;
        if (now - switchSince >= sp.switchDelay) adopt = true;
      } else switchSince = -1;
      if (adopt) {
        tr = cand;
        switchSince = -1;
        reroll(w, eX[tr]!);
        lastThink = -Infinity;
        smoothX = tracking ? smoothX : eCur[tr]!;
      }
      tracking = true;
    } else {
      tracking = false;
      switchSince = -1;
    }
    const threat = tracking && tr >= 0;
    let ballRem = Infinity;
    let chasing = false;
    if (threat) {
      ballRem = eRem[tr]!;
      impactAt = now + ballRem;
      if (sp.chaseLag > 0 && ballRem > sp.predictBelow) {
        chasing = true;
        smoothX += (eCur[tr]! - smoothX) * Math.min(1, dt / sp.chaseLag);
      } else if (now - lastThink >= sp.rethink) {
        lastThink = now;
        const sigma = sp.estBase + sp.estK * ballRem + sp.bounceErr * eBounce[tr]!;
        estX = eX[tr]! + gauss() * sigma;
      }
    }

    const clampX = (x: number): number => Math.max(hw, Math.min(w.width - hw, x));
    const ballTarget = threat ? clampX((chasing ? smoothX : estX) - offsetU * hw) : 0;
    const travel = (from: number, to: number): number => Math.abs(to - from) / vmax;

    // Capsules from the delayed snapshot.
    let capX = 0;
    let capBest = -1;
    const hazards: { x: number; rem: number }[] = [];
    for (let i = 0; i < nDrops[slot]!; i++) {
      const o = (slot * MAX_D + i) * DROP_F;
      const type = POWER_TYPES[drops[o + 3]!]!;
      const dvy = drops[o + 2]!;
      const t = (p.y - C.dropH / 2 - drops[o + 1]!) / dvy;
      const rem = t - sp.delay;
      if (rem < -0.02) continue;
      const dx = drops[o]!;
      if (!isPositive(type)) {
        hazards.push({ x: dx, rem });
        continue;
      }
      const reach = Math.max(0, Math.abs(dx - p.x) - (hw + DROP_HALF_W - 8)) / vmax;
      if (reach > rem) continue;
      if (threat) {
        // Only detour when the ball is still comfortably catchable afterwards.
        const aim = clampX(dx);
        if (rem >= ballRem) continue; // ball first; the capsule is handled once the ball is gone
        if (travel(p.x, aim) > rem - 0.02 || travel(aim, ballTarget) + 0.04 > ballRem - rem) continue;
      }
      const v = VALUE[type] * 10 - rem;
      if (v > capBest) {
        capBest = v;
        capX = dx;
      }
    }

    let desired: number;
    if (capBest >= 0) desired = clampX(capX);
    else if (threat) desired = ballTarget;
    else desired = w.width / 2;

    // Hazard avoidance (only when it does not endanger the ball).
    const zone = hw + DROP_HALF_W + 8;
    for (const hz of hazards) {
      if (hz.rem > 1.5) continue;
      const reachable = Math.max(0, Math.min(Math.abs(desired - p.x), vmax * hz.rem));
      const pos = p.x + Math.sign(desired - p.x) * reachable;
      if (Math.abs(pos - hz.x) >= zone) continue;
      const alts = [clampX(hz.x - zone), clampX(hz.x + zone)].filter((a) => Math.abs(a - hz.x) >= zone - 1);
      if (alts.length === 0) continue;
      let pick: number | null = null;
      let pickCost = Infinity;
      for (const a of alts) {
        if (travel(p.x, a) > hz.rem) continue;
        let cost = Math.abs(a - desired);
        if (threat) {
          if (hz.rem < ballRem - 0.05) {
            if (travel(a, ballTarget) > ballRem - hz.rem - 0.03) continue;
          } else if (hz.rem < ballRem + 0.15) {
            if (Math.abs(a - ballTarget) > 0.9 * hw) continue;
          } else {
            continue;
          }
          cost = Math.abs(a - ballTarget);
        }
        if (cost < pickCost) {
          pickCost = cost;
          pick = a;
        }
      }
      if (pick !== null) desired = pick;
    }

    const d = desired - p.x;
    const lim = vmax * dt;
    input.paddleX = p.x + Math.max(-lim, Math.min(lim, d));
    return input;
  };

  return { skill, act };
}
