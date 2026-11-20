import '@fontsource/patrick-hand/latin-400.css';
import './style.css';
import { View } from './game/view';
import { Loop } from './game/loop';
import { LEVEL_1, createWorld, drainEvents, step, type World } from './engine';
import { Controls } from './input/controls';
import { Renderer } from './render/renderer';
import { createControlsUi } from './ui/controlsUi';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D canvas not supported');

const view = new View(canvas);
const controls = new Controls(canvas, view);
const ui = createControlsUi(document.getElementById('ui') as HTMLElement, controls);
let lastFrame = performance.now();

const newWorld = (): World => createWorld(LEVEL_1, { seed: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0 });
let world = newWorld();
const renderer = new Renderer();
renderer.loadLevel(world);
/** Ball positions before the last step, for render interpolation. */
let prev: { x: number; y: number }[] = world.balls.map((b) => ({ x: b.x, y: b.y }));

function update(dt: number): void {
  if (!ui.started() || ui.paused()) return;
  const inp = controls.input();
  if ((world.status === 'won' || world.status === 'gameover') && inp.fire) {
    world = newWorld();
    renderer.loadLevel(world);
    prev = world.balls.map((b) => ({ x: b.x, y: b.y }));
    return;
  }
  prev = world.balls.map((b) => ({ x: b.x, y: b.y }));
  step(world, inp, dt);
}

function render(alpha: number): void {
  const now = performance.now();
  const frameDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  controls.setPaddleX(world.paddle.x);
  controls.poll(frameDt);
  if (controls.pausePressed()) ui.togglePause();
  const c = ctx as CanvasRenderingContext2D;
  view.begin(c);

  renderer.shake.enabled = controls.settings.shake;
  renderer.setPixelScale(view.pixelScale);
  renderer.onEvents(drainEvents(world));
  renderer.draw(c, world, prev, alpha, now / 1000);
}

const loop = new Loop(update, render);
// Wait (briefly) for the handwritten font so the first HUD draw uses it; fall back gracefully.
const fontReady: Promise<unknown> = document.fonts
  ? Promise.race([document.fonts.load('28px "Patrick Hand"'), new Promise((r) => setTimeout(r, 2000))]).catch(() => undefined)
  : Promise.resolve();
void fontReady.then(() => loop.start());

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is optional */
  });
}
