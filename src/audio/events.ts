import { CONFIG, type GameEvent, type World } from '../engine';
import { isBadPower } from '../render/powerVisuals';

export interface SoundCall {
  id: string;
  /** Logical x of the source, for panning. */
  x?: number;
  volume?: number;
}

const ONE_TO_ONE: Partial<Record<GameEvent['type'], string>> = {
  wall: 'wall',
  paddle: 'paddle',
  explode: 'explode',
  launch: 'launch',
  staple: 'laser', // TODO(render-revamp): dedicated staple / clip / combo SFX
  eraser: 'eraser',
  lifeLost: 'lifelost',
  gameover: 'gameover',
  won: 'won',
  regen: 'regen',
  reveal: 'reveal',
  net: 'net',
};

/** Pure: maps one frame's game events to sound calls. */
export function soundsForEvents(events: readonly GameEvent[], world?: Pick<World, 'bricks'>): SoundCall[] {
  const out: SoundCall[] = [];
  const broke = new Set<number>();
  for (const e of events) if (e.type === 'brickBreak' && e.brickId !== undefined) broke.add(e.brickId);
  let breaks = 0;
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
        if (breaks === 0) out.push({ id: 'break', x: e.x });
        else if (breaks === 1) out.push({ id: 'shred', x: e.x });
        breaks++;
        break;
      case 'powerup':
        out.push({ id: e.power && isBadPower(e.power) ? 'powerdown' : 'powerup', x: e.x });
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
