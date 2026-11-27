import './style.css';
import { View } from './game/view';
import { Loop } from './game/loop';
import { LEVEL_1, POWER_TYPES, TEST_LEVELS, createWorld, drainEvents, step, type GameEvent, type PowerType, type World } from './engine';
import { Controls } from './input/controls';
import { Renderer } from './render/renderer';
import { drawGallery } from './render/gallery';
import { snapshotBalls, type XY } from './render/powerVisuals';
import { createControlsUi } from './ui/controlsUi';
import { SoundManager } from './audio/sound';
import { panFromX, soundsForEvents } from './audio/events';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D canvas not supported');

const view = new View(canvas);
const controls = new Controls(canvas, view);
const st = controls.settings;
const sound = new SoundManager({ muted: st.muted, volume: st.volume, music: st.music, musicVolume: st.musicVolume });
const ui = createControlsUi(document.getElementById('ui') as HTMLElement, controls, sound);
let lastFrame = performance.now();

// Debug URL params: ?level=<explosive|moving|regen|hidden|mixed>, ?power=<type>, ?drop=<0..1>, ?auto
const params = new URLSearchParams(location.search);
const debugLevel = TEST_LEVELS[params.get('level') ?? ''] ?? LEVEL_1;
const powerParam = params.get('power');
const forcedPower = (POWER_TYPES as readonly string[]).includes(powerParam ?? '') ? (powerParam as PowerType) : undefined;
const autoPlay = params.has('auto');
const gallery = params.has('gallery');
const dropParam = params.get('drop');
const dropChance = dropParam !== null && dropParam !== '' && Number.isFinite(Number(dropParam)) ? Math.max(0, Math.min(1, Number(dropParam))) : undefined;

const newWorld = (): World =>
  createWorld(debugLevel, {
    seed: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0,
    ...(forcedPower ? { forcedPower } : {}),
    ...(dropChance !== undefined ? { dropChance } : {}),
  });
let world = newWorld();
const renderer = new Renderer();
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
    sound.duckMusic(false);
    sound.nextTrack();
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
    if (world.status === 'serve' || world.balls.some((b) => b.stuck)) {
      inp.fire = inp.fire || Math.floor(world.time * 4) !== Math.floor((world.time - dt) * 4);
    }
  }
  step(world, inp, dt);
}

/** Short vibrations for the big moments (Android; iOS Safari has no vibrate and ignores this). */
function haptics(events: readonly GameEvent[]): void {
  if (!st.haptics || typeof navigator.vibrate !== 'function') return;
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (ua && !ua.hasBeenActive) return;
  let ms = 0;
  for (const e of events) {
    if (e.type === 'lifeLost' || e.type === 'gameover') ms = Math.max(ms, 120);
    else if (e.type === 'explode') ms = Math.max(ms, 40);
    else if (e.type === 'won' || e.type === 'extraLife') ms = Math.max(ms, 60);
    else if (e.type === 'powerup' || e.type === 'combo') ms = Math.max(ms, 18);
    else if (e.type === 'brickBreak') ms = Math.max(ms, 8);
  }
  if (ms > 0) {
    try {
      navigator.vibrate(ms);
    } catch {
      /* not allowed before a gesture */
    }
  }
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
  if (gallery) {
    drawGallery(c, view.pixelScale, now / 1000);
    return;
  }

  renderer.shake.enabled = st.shake && !st.reducedFx;
  renderer.reduced = st.reducedFx;
  renderer.beat = sound.beat();
  renderer.showStatus = ui.started();
  renderer.setPixelScale(view.pixelScale);
  const events = drainEvents(world);
  if (events.length) {
    for (const s of soundsForEvents(events, world)) {
      sound.play(s.id, { pan: panFromX(s.x, world.width), ...(s.volume !== undefined ? { volume: s.volume } : {}), ...(s.pitch !== undefined ? { pitch: s.pitch } : {}) });
    }
    for (const e of events) if (e.type === 'won' || e.type === 'gameover') sound.duckMusic(true);
    haptics(events);
  }
  renderer.onEvents(events, world);
  renderer.draw(c, world, prev, alpha, now / 1000);
}

new Loop(update, render).start();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is optional */
  });
}
