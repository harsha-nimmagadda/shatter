import { CONFIG, type GameEvent, type World } from '../engine';

export interface SoundCall {
  id: string;
  /** Logical x of the source, for panning. */
  x?: number;
  volume?: number;
  /** playbackRate (musical pitch); omitted = small random jitter. */
  pitch?: number;
}

/** Major-pentatonic ladder: each brick broken in one rally plays one step higher. */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

/** Pitch (playbackRate) of the break sound for the n-th break of a rally (n >= 1). */
export function breakPitch(n: number): number {
  const i = Math.max(0, Math.min(LADDER.length - 1, Math.floor(n) - 1));
  return Math.pow(2, LADDER[i] / 12);
}

/** Pitch of the combo jingle per multiplier: ×1.5 root, ×2 a third up, ×3 a fifth up. */
export function comboPitch(mul: number): number {
  return mul >= 3 ? Math.pow(2, 7 / 12) : mul >= 2 ? Math.pow(2, 4 / 12) : 1;
}

/** Catch sounds for powers that have their own SFX; other hazards use 'powerdown', the rest 'powerup'. */
export const POWER_SOUND: Partial<Record<string, string>> = {
  scissors: 'snip',
  paperclip: 'paperclip',
  goldstar: 'goldstar',
  redpen: 'redpen',
};
const HAZARDS: ReadonlySet<string> = new Set(['sharpener', 'scissors', 'redpen']);

export function powerSoundId(power: string | undefined): string {
  if (!power) return 'powerup';
  return POWER_SOUND[power] ?? (HAZARDS.has(power) ? 'powerdown' : 'powerup');
}

const ONE_TO_ONE: Partial<Record<GameEvent['type'], string>> = {
  wall: 'wall',
  paddle: 'paddle',
  explode: 'explode',
  launch: 'launch',
  staple: 'staple',
  clipLoose: 'cliploose',
  clipPop: 'clippop',
  splash: 'splash',
  extraLife: 'goldstar',
  combo: 'combo',
  eraser: 'eraser',
  lifeLost: 'lifelost',
  gameover: 'gameover',
  won: 'won',
  regen: 'regen',
  reveal: 'reveal',
  net: 'net',
};

/** Pure: maps one frame's game events to sound calls. */
export function soundsForEvents(events: readonly GameEvent[], world?: Pick<World, 'bricks'> & { combo?: number }): SoundCall[] {
  const out: SoundCall[] = [];
  const broke = new Set<number>();
  for (const e of events) if (e.type === 'brickBreak' && e.brickId !== undefined) broke.add(e.brickId);
  let breaks = 0;
  let gold = false;
  for (const e of events) {
    switch (e.type) {
      case 'brickHit': {
        if (e.brickId !== undefined && broke.has(e.brickId)) break;
        const steel = e.brickId !== undefined && world?.bricks.find((b) => b.id === e.brickId)?.type === 'steel';
        out.push({ id: steel ? 'steel' : 'brick', x: e.x });
        break;
      }
      case 'brickBreak':
        // Several breaks in one frame: one break, then a single shred.
        if (breaks === 0) out.push(world?.combo ? { id: 'break', x: e.x, pitch: breakPitch(world.combo) } : { id: 'break', x: e.x });
        else if (breaks === 1) out.push({ id: 'shred', x: e.x });
        breaks++;
        break;
      case 'powerup':
        {
          const id = powerSoundId(e.power);
          if (id === 'goldstar') {
            if (gold) break;
            gold = true;
          }
          out.push({ id, x: e.x });
        }
        break;
      case 'extraLife':
        if (!gold) out.push({ id: 'goldstar', x: e.x });
        gold = true;
        break;
      case 'combo':
        out.push({ id: 'combo', x: e.x, pitch: comboPitch(e.value ?? 1.5) });
        break;
      default: {
        const id = ONE_TO_ONE[e.type];
        if (id) out.push({ id, x: e.x });
      }
    }
  }
  return out;
}

/** Subtle stereo pan from a logical x position: -0.4 (left) .. +0.4 (right). */
export function panFromX(x: number | undefined, width: number = CONFIG.width): number {
  if (x === undefined || !Number.isFinite(x)) return 0;
  return Math.max(-0.4, Math.min(0.4, (x / width - 0.5) * 2 * 0.4));
}
