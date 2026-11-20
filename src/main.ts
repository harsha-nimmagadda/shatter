import './style.css';
import { View, LOGICAL_W, LOGICAL_H } from './game/view';
import { Loop } from './game/loop';
import { enterImmersive } from './game/fullscreen';
import { CONFIG, LEVEL_1, createWorld, drainEvents, step, type World } from './engine';
import { createTempInput } from './input/temp';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D canvas not supported');

const view = new View(canvas);
const input = createTempInput(canvas, view);

const newWorld = (): World => createWorld(LEVEL_1, { seed: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0 });
let world = newWorld();
/** Ball positions before the last step, for render interpolation. */
let prev: { x: number; y: number }[] = world.balls.map((b) => ({ x: b.x, y: b.y }));

function update(dt: number): void {
  const inp = input.sample();
  if ((world.status === 'won' || world.status === 'gameover') && inp.fire) {
    world = newWorld();
    prev = world.balls.map((b) => ({ x: b.x, y: b.y }));
    return;
  }
  prev = world.balls.map((b) => ({ x: b.x, y: b.y }));
  step(world, inp, dt);
}

const BRICK_COLORS = ['', '#f3b562', '#7bb8e8', '#e87a7a'];

function render(alpha: number): void {
  const c = ctx as CanvasRenderingContext2D;
  view.begin(c);

  // Hook for sounds / particles: react to world events here.
  drainEvents(world);

  // Paper playfield.
  c.fillStyle = '#fffdf6';
  c.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // Faint blue ruled lines every 32 units.
  c.strokeStyle = 'rgba(60, 110, 200, 0.25)';
  c.lineWidth = 1;
  c.beginPath();
  for (let y = 32; y < LOGICAL_H; y += 32) {
    c.moveTo(0, y + 0.5);
    c.lineTo(LOGICAL_W, y + 0.5);
  }
  c.stroke();

  // Red margin line.
  c.strokeStyle = 'rgba(200, 60, 60, 0.6)';
  c.beginPath();
  c.moveTo(60.5, 0);
  c.lineTo(60.5, LOGICAL_H);
  c.stroke();

  for (const k of world.bricks) {
    c.fillStyle = k.kind === 'steel' ? '#8a8f98' : BRICK_COLORS[k.hp] ?? '#e87a7a';
    c.fillRect(k.x, k.y, k.w, k.h);
    c.strokeStyle = '#2b2b2b';
    c.strokeRect(k.x, k.y, k.w, k.h);
  }

  const p = world.paddle;
  c.fillStyle = '#2b2b2b';
  c.fillRect(p.x - p.w / 2, p.y, p.w, p.h);

  c.fillStyle = '#1d3f8f';
  world.balls.forEach((b, i) => {
    const pv = prev[i] ?? b;
    c.beginPath();
    c.arc(pv.x + (b.x - pv.x) * alpha, pv.y + (b.y - pv.y) * alpha, b.r, 0, Math.PI * 2);
    c.fill();
  });

  // HUD.
  c.fillStyle = '#2b2b2b';
  c.font = '24px sans-serif';
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  c.fillText(`Score ${world.score}`, 16, CONFIG.topWall / 2);
  c.textAlign = 'right';
  c.fillText(`Lives ${world.lives}`, LOGICAL_W - 16, CONFIG.topWall / 2);

  const msg =
    world.status === 'serve'
      ? 'Tap to launch'
      : world.status === 'won'
        ? 'You win! Tap to play again'
        : world.status === 'gameover'
          ? 'Game over. Tap to retry'
          : '';
  if (msg) {
    c.textAlign = 'center';
    c.font = '32px sans-serif';
    c.fillText(msg, LOGICAL_W / 2, LOGICAL_H / 2);
  }
}

const loop = new Loop(update, render);
loop.start();

canvas.addEventListener('pointerdown', () => void enterImmersive(), { once: true });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is optional */
  });
}
