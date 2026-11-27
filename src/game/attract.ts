import { CAMPAIGN, createRng, createWorld, step, type CampaignLevel, type Rng, type World } from '../engine';
import { createBot, type Bot, type BotSkill } from '../sim/bots';

/** Seconds a finished demo stays on screen before the next level starts. */
export const ATTRACT_END_HOLD = 2.4;
/** Give up on a demo level that drags on (e.g. a stuck ball) after this many game seconds. */
export const ATTRACT_MAX_SEC = 150;

/** Pure: which campaign level the demo shows next, and which bot plays it (mostly the pro). */
export function pickAttract(rng: Rng, levelCount: number): { level: number; skill: BotSkill } {
  return { level: rng.int(0, levelCount - 1), skill: rng.next() < 0.7 ? 'pro' : 'casual' };
}

/**
 * The title-screen demo: the sim autopilot plays random campaign levels; a fresh level starts after a win or
 * game over. Seeded per session, so the sequence of levels is reproducible. Pure of DOM and sound.
 */
export class Attract {
  world!: World;
  levelIndex = 0;
  skill: BotSkill = 'pro';
  private bot!: Bot;
  private readonly rng: Rng;
  private endT = 0;
  /** Levels started so far (the first is 1). */
  count = 0;

  constructor(
    seed: number,
    private readonly levels: readonly CampaignLevel[] = CAMPAIGN,
  ) {
    this.rng = createRng(seed);
    this.restart();
  }

  /** Starts the next demo level (a new World; callers must reload the renderer). */
  restart(): void {
    const p = pickAttract(this.rng, this.levels.length);
    this.levelIndex = p.level;
    this.skill = p.skill;
    const lv = this.levels[p.level];
    this.world = createWorld(lv, { seed: this.rng.int(1, 0x7fffffff), levelIndex: p.level, ...(lv.featured ? { featured: lv.featured } : {}) });
    this.bot = createBot(p.skill, this.rng.int(1, 0x7fffffff));
    this.endT = 0;
    this.count++;
  }

  /** One fixed step. Returns true when a new level started (the world was replaced). */
  update(dt: number): boolean {
    const w = this.world;
    if (w.status === 'won' || w.status === 'gameover') {
      this.endT += dt;
      if (this.endT >= ATTRACT_END_HOLD) {
        this.restart();
        return true;
      }
      step(w, { moveAxis: 0, paddleX: null, fire: false }, dt);
      return false;
    }
    if (w.time > ATTRACT_MAX_SEC) {
      this.restart();
      return true;
    }
    step(w, this.bot.act(w, dt), dt);
    return false;
  }
}
