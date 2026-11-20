import '@fontsource/patrick-hand/latin-400.css';
import './style.css';
import { View } from './game/view';
import { Loop } from './game/loop';
import { LEVEL_1, POWER_TYPES, TEST_LEVELS, createWorld, drainEvents, step, type PowerType, type World } from './engine';
import { Controls } from './input/controls';
import { loadWorldAssets } from './render/assets';
import { NOTEBOOK_SKIN } from './render/skin';
import { Renderer } from './render/renderer';
import { snapshotBalls, type XY } from './render/powerVisuals';
import { createControlsUi } from './ui/controlsUi';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D canvas not supported');

const view = new View(canvas);
const controls = new Controls(canvas, view);
const ui = createControlsUi(document.getElementById('ui') as HTMLElement, controls);
let lastFrame = performance.now();

// Debug URL params: ?level=<explosive|moving|regen|hidden|mixed>, ?power=<type>, ?drop=<0..1>
const params = new URLSearchParams(location.search);
const debugLevel = TEST_LEVELS[params.get('level') ?? ''] ?? LEVEL_1;
const powerParam = params.get('power');
const forcedPower = (POWER_TYPES as readonly string[]).includes(powerParam ?? '') ? (powerParam as PowerType) : undefined;
const autoPlay = params.has('auto');
const dropParam = params.get('drop');
const dropChance = dropParam !== null && dropParam !== '' && Number.isFinite(Number(dropParam)) ? Math.max(0, Math.min(1, Number(dropParam))) : undefined;

const newWorld = (): World =>
  createWorld(debugLevel, {
    seed: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0,
    ...(forcedPower ? { forcedPower } : {}),
    ...(dropChance !== undefined ? { dropChance } : {}),
  });
let world = newWorld();
let renderer = new Renderer();
renderer.loadLevel(world);
/** Ball positions before the last step, for render interpolation. */
const prev: XY[] = snapshotBalls(world.balls, []);

function update(dt: number): void {
  if (!ui.started() || ui.paused()) return;
  const inp = controls.input();
  if ((world.status === 'won' || world.status === 'gameover') && inp.fire) {
    world = newWorld();
    renderer.loadLevel(world);
    snapshotBalls(world.balls, prev);
    return;
  }
  snapshotBalls(world.balls, prev);
  if (autoPlay) {
    // Debug: track the lowest descending ball (or a falling drop), auto-serve and auto-fire.
    let target: number | null = null;
    let lowest = -1;
    for (const b of world.balls) if (b.vy > 0 && b.y > lowest) { lowest = b.y; target = b.x; }
    if (target === null && world.drops.length) target = world.drops[0].x;
    if (target !== null) inp.paddleX = target + Math.sin(world.time * 1.7) * world.paddle.w * 0.3;
    inp.moveAxis = 0;
    if (world.status === 'serve' || world.balls.some((b) => b.stuck) || world.effects.laser !== undefined) {
      inp.fire = inp.fire || Math.floor(world.time * 4) !== Math.floor((world.time - dt) * 4);
    }
  }
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
  renderer.onEvents(drainEvents(world), world);
  renderer.draw(c, world, prev, alpha, now / 1000);
}

const loop = new Loop(update, render);
// Behind the start overlay: wait (briefly, ~4 s max) for the handwritten font and the generated art.
// Anything that fails or is late just leaves the procedural look in place.
const fontReady: Promise<unknown> = document.fonts
  ? document.fonts.load('28px "Patrick Hand"').catch(() => undefined)
  : Promise.resolve();
const artReady = loadWorldAssets();
const timeout = new Promise<null>((r) => setTimeout(() => r(null), 4000));
// Art is swapped in whenever it finishes loading, even after the timeout (slow network or a
// backgrounded tab can stall image decoding); until then the procedural look is shown.
const allReady = Promise.all([fontReady, artReady]).then(([, a]) => a);
void allReady.then((assets) => {
  renderer = new Renderer({ ...NOTEBOOK_SKIN, assets });
  renderer.loadLevel(world);
  const title = assets.get('title')[0];
  if (title) ui.setTitleImage(title);
});
void Promise.race([allReady, timeout]).then(() => loop.start());

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is optional */
  });
}
