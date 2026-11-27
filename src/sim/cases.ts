import { LEVEL_1, POWER_TYPES, TEST_LEVELS, type Level } from '../engine';
import { BOT_SKILLS, type BotSkill } from './bots';
import { NATURAL, runGame, type RunResult } from './run';

export const LEVELS: Record<string, Level> = { level1: LEVEL_1, ...TEST_LEVELS };
export const POWER_CASES: readonly string[] = [NATURAL, ...POWER_TYPES];

export interface CaseSpec {
  id: string;
  levelKey: string;
  power: string;
  bot: BotSkill;
}

export interface CaseFilter {
  levels?: string[];
  powers?: string[];
  bots?: string[];
}

export const caseId = (levelKey: string, power: string, bot: string): string => `${levelKey}|${power}|${bot}`;

/** The full matrix (levels x powers x bots), optionally filtered. Throws on unknown names. */
export function buildCases(filter: CaseFilter = {}): CaseSpec[] {
  const check = (kind: string, vals: string[] | undefined, all: readonly string[]): readonly string[] => {
    if (!vals || vals.length === 0) return all;
    for (const v of vals) if (!all.includes(v)) throw new Error(`Unknown ${kind} "${v}". Choose from: ${all.join(', ')}`);
    return vals;
  };
  const levels = check('level', filter.levels, Object.keys(LEVELS));
  const powers = check('power', filter.powers, POWER_CASES);
  const bots = check('bot', filter.bots, BOT_SKILLS) as BotSkill[];
  const out: CaseSpec[] = [];
  for (const levelKey of levels) {
    for (const power of powers) for (const bot of bots) out.push({ id: caseId(levelKey, power, bot), levelKey, power, bot });
  }
  return out;
}

export function runCase(c: CaseSpec, seed: number, maxTimeSec?: number): RunResult {
  const level = LEVELS[c.levelKey];
  if (!level) throw new Error(`Unknown level "${c.levelKey}"`);
  return runGame({
    caseId: c.id,
    level,
    power: c.power as (typeof POWER_TYPES)[number] | typeof NATURAL,
    bot: c.bot,
    seed,
    ...(maxTimeSec !== undefined ? { maxTimeSec } : {}),
  });
}
