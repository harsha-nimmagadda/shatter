import { CONFIG as C, createWorld, drainEvents, isPositive, step, type Level, type PowerType } from '../engine';
import { createBot, type BotSkill } from './bots';

export const SIM_DT = 1 / 120;
export const MAX_GAME_SEC = 300;
export const NATURAL = 'natural';
/** Baseline with no capsules at all, to measure each power-up on its own. */
export const NONE = 'none';

export interface RunOpts {
  /** Identifier of the (level, power, bot) case; part of the bot RNG seed. */
  caseId: string;
  level: Level;
  power: PowerType | typeof NATURAL | typeof NONE;
  bot: BotSkill;
  seed: number;
  /** Game-time cap in seconds (default 300). */
  maxTimeSec?: number;
}

export interface RunResult {
  caseId: string;
  level: string;
  forcedPower: string;
  bot: BotSkill;
  seed: number;
  outcome: 'won' | 'gameover' | 'timeout';
  timeSec: number;
  livesLost: number;
  score: number;
  /** Counting + clearable bricks destroyed (regenerating bricks excluded). */
  bricksBroken: number;
  /** Highest world.combo (bricks broken since the last paddle touch). */
  maxCombo: number;
  paddleHits: number;
  bricksPerPaddleHit: number;
  /** Mean world.speed over playing steps. */
  avgBallSpeed: number;
  maxBallSpeed: number;
  /** Longest stretch of playing time without a (non-regen) brick break. */
  longestNoBreakSec: number;
  clipPops: number;
  capsulesSpawned: number;
  capsulesCaught: number;
  capsulesMissed: number;
  /** Lives lost within 3 s after catching a hazard capsule. */
  hazardDeaths: number;
  extraLivesFromScore: number;
  peakBalls: number;
  /** Compact "type:count;..." string. */
  powerCatches: string;
}

/** FNV-1a over a string, to derive the bot RNG seed from (seed, bot, case). */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h ^ (h >>> 15)) >>> 0;
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

export function runGame(opts: RunOpts): RunResult {
  const natural = opts.power === NATURAL;
  const none = opts.power === NONE;
  const featured = (opts.level as { featured?: PowerType }).featured;
  const world = createWorld(opts.level, {
    seed: opts.seed,
    ...(featured ? { featured } : {}),
    ...(none ? { dropChance: 0 } : natural ? {} : { forcedPower: opts.power as PowerType, dropChance: C.dropChance }),
  });
  const bot = createBot(opts.bot, hashSeed(`${opts.seed}|${opts.bot}|${opts.caseId}`));
  const cap = opts.maxTimeSec ?? MAX_GAME_SEC;
  const regenIds = new Set<number>();
  for (const k of world.bricks) if (k.type === 'regen') regenIds.add(k.id);

  let livesLost = 0;
  let bricksBroken = 0;
  let maxCombo = 0;
  let paddleHits = 0;
  let speedSum = 0;
  let playSteps = 0;
  let maxSpeed = 0;
  let sinceBreak = 0;
  let longestNoBreak = 0;
  let clipPops = 0;
  let spawned = 0;
  let caught = 0;
  let missed = 0;
  let hazardDeaths = 0;
  let extraLives = 0;
  let peakBalls = 1;
  let lastHazardAt = -Infinity;
  let lastDropId = 0;
  const catches = new Map<string, number>();

  while (world.time < cap && (world.status === 'serve' || world.status === 'playing')) {
    const wasPlaying = world.status === 'playing';
    step(world, bot.act(world, SIM_DT), SIM_DT);
    if (wasPlaying) {
      sinceBreak += SIM_DT;
      speedSum += world.speed;
      playSteps++;
      if (world.speed > maxSpeed) maxSpeed = world.speed;
    }
    for (const d of world.drops) {
      if (d.id > lastDropId) {
        lastDropId = d.id;
        spawned++;
      }
    }
    for (const e of drainEvents(world)) {
      switch (e.type) {
        case 'brickBreak':
          if (e.brickId !== undefined && regenIds.has(e.brickId)) break;
          bricksBroken++;
          if (sinceBreak > longestNoBreak) longestNoBreak = sinceBreak;
          sinceBreak = 0;
          break;
        case 'paddle': paddleHits++; break;
        case 'lifeLost':
          livesLost++;
          if (world.time - lastHazardAt <= 3) hazardDeaths++;
          break;
        case 'clipPop': clipPops++; break;
        case 'extraLife': extraLives++; break;
        case 'powerMiss': missed++; break;
        case 'powerup':
          caught++;
          if (e.power) {
            catches.set(e.power, (catches.get(e.power) ?? 0) + 1);
            if (!isPositive(e.power as PowerType)) lastHazardAt = world.time;
          }
          break;
        default: break;
      }
    }
    if (world.combo > maxCombo) maxCombo = world.combo;
    if (world.balls.length > peakBalls) peakBalls = world.balls.length;
  }
  if (sinceBreak > longestNoBreak) longestNoBreak = sinceBreak;

  const outcome = world.status === 'won' ? 'won' : world.status === 'gameover' ? 'gameover' : 'timeout';
  return {
    caseId: opts.caseId,
    level: opts.level.name,
    forcedPower: opts.power,
    bot: opts.bot,
    seed: opts.seed,
    outcome,
    timeSec: r4(world.time),
    livesLost,
    score: world.score,
    bricksBroken,
    maxCombo,
    paddleHits,
    bricksPerPaddleHit: r4(bricksBroken / Math.max(1, paddleHits)),
    avgBallSpeed: r4(playSteps ? speedSum / playSteps : 0),
    maxBallSpeed: r4(maxSpeed),
    longestNoBreakSec: r4(longestNoBreak),
    clipPops,
    capsulesSpawned: spawned,
    capsulesCaught: caught,
    capsulesMissed: missed,
    hazardDeaths,
    extraLivesFromScore: extraLives,
    peakBalls,
    powerCatches: [...catches.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}:${v}`).join(';'),
  };
}

export const CSV_COLUMNS: readonly (keyof RunResult)[] = [
  'caseId', 'level', 'forcedPower', 'bot', 'seed', 'outcome', 'timeSec', 'livesLost', 'score', 'bricksBroken',
  'maxCombo', 'paddleHits', 'bricksPerPaddleHit', 'avgBallSpeed', 'maxBallSpeed', 'longestNoBreakSec', 'clipPops',
  'capsulesSpawned', 'capsulesCaught', 'capsulesMissed', 'hazardDeaths', 'extraLivesFromScore', 'peakBalls',
  'powerCatches',
];

const csvCell = (v: unknown): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const csvHeader = (): string => CSV_COLUMNS.join(',');
export const csvRow = (r: RunResult): string => CSV_COLUMNS.map((c) => csvCell(r[c])).join(',');
