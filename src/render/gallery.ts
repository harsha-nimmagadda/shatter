import { POWER_CATEGORY, POWER_TYPES, type BrickType } from '../engine';
import { BRICK_PAD, CAPSULE_PAD, CAPSULE_SIZE, renderBrick, renderPhantom } from './art';
import { Background, PlayFrame } from './background';
import { renderCapsule } from './icons';
import { C, font } from './palette';
import { POWER_NAMES, categoryColor } from './powerVisuals';
import { Sprite } from './sprite';

/** Debug sheet (`?gallery`): every brick type/state and every power-up capsule with its name. */
export function drawGallery(ctx: CanvasRenderingContext2D, scale: number, time: number): void {
  const bg = (drawGallery as unknown as { bg?: Background }).bg ?? new Background();
  (drawGallery as unknown as { bg?: Background }).bg = bg;
  bg.draw(ctx, scale, time, 0, 0, 0, true);
  new PlayFrame().draw(ctx, scale);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = font(18);
  ctx.fillStyle = C.white;
  ctx.fillText('BRICKS', 270, 86);
  const bricks: [BrickType, number, number, string][] = [
    ['normal', 1, 1, '1 HP'], ['normal', 2, 2, '2 HP'], ['normal', 1, 2, '2 HP hit'], ['normal', 3, 3, '3 HP'],
    ['normal', 1, 3, '3 HP hit x2'], ['steel', 1, 1, 'ARMOR'], ['explosive', 1, 1, 'BOMB'], ['moving', 1, 1, 'SLIDER'],
    ['regen', 1, 1, 'REGEN'], ['hidden', 2, 2, 'PHANTOM'], ['hidden', 1, 2, 'REVEALED'],
  ];
  bricks.forEach(([type, hp, max, label], i) => {
    const x = 30 + (i % 4) * 125;
    const y = 110 + Math.floor(i / 4) * 56;
    const s = new Sprite(48, 24, BRICK_PAD, scale, (g, px) =>
      label === 'PHANTOM' ? renderPhantom(g, 48, 24, px) : renderBrick(g, type, hp, max, 48, 24, i % 3, px),
    );
    ctx.globalAlpha = label === 'PHANTOM' ? 0.4 : 1;
    s.draw(ctx, x, y);
    ctx.globalAlpha = 1;
    ctx.font = font(11, false);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.white;
    ctx.fillText(label, x + 54, y + 12);
  });
  ctx.textAlign = 'center';
  ctx.font = font(18);
  ctx.fillText('POWER-UPS', 270, 296);
  POWER_TYPES.forEach((t, i) => {
    const x = 70 + (i % 3) * 170;
    const y = 340 + Math.floor(i / 3) * 112;
    const s = new Sprite(CAPSULE_SIZE, CAPSULE_SIZE, CAPSULE_PAD, scale * 1.8, (g, px) => renderCapsule(g, t, CAPSULE_SIZE, px));
    s.drawCentered(ctx, x, y, 1.6);
    s.drawCentered(ctx, x + 52, y, 1);
    ctx.font = font(13);
    ctx.fillStyle = categoryColor(t);
    ctx.fillText(POWER_NAMES[t], x + 20, y + 42);
    ctx.font = font(9, false);
    ctx.fillStyle = 'rgba(244,247,255,0.6)';
    ctx.fillText(`${t} · ${POWER_CATEGORY[t]}`, x + 20, y + 58);
  });
}
