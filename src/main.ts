import './style.css';
import { View } from './game/view';
import { Loop } from './game/loop';
import { CAMPAIGN, LEVEL_1, POWER_TYPES, TEST_LEVELS, createWorld, drainEvents, step, type GameEvent, type Level, type PowerType, type World } from './engine';
import { Controls } from './input/controls';
import { Renderer } from './render/renderer';
import { drawGallery } from './render/gallery';
import { snapshotBalls, type XY } from './render/powerVisuals';
import { createControlsUi } from './ui/controlsUi';
import { Menus } from './ui/menus';
import { Nav } from './ui/nav';
import { loadProgress, recordWin, saveProgress } from './game/progress';
import { clearRun, continueRun, loadRun, retryLevel, saveRun, startRun, winLevel, type RunState, type WinOutcome } from './game/run';
import { QUALITY_DPR, QualityGovernor, effectiveQuality } from './game/quality';
import { introHint, takeFirstRun } from './game/hints';
import { isFullscreenSupported } from './game/fullscreen';
import { computeHudLayout, readSafeInsets } from './game/hud';
import { WakeLock, shouldHoldWakeLock } from './game/wakeLock';
import { SoundManager } from './audio/sound';
import { panFromX, soundsForEvents } from './audio/events';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D canvas not supported');

const view = new View(canvas);
const controls = new Controls(canvas, view);
const st = controls.settings;
const sound = new SoundManager({ muted: st.muted, volume: st.volume, music: st.music, musicVolume: st.musicVolume });
const uiRoot = document.getElementById('ui') as HTMLElement;
const nav = new Nav(uiRoot);
let lastFrame = performance.now();
const wakeLock = new WakeLock();

// Debug URL params: ?level=<explosive|moving|regen|hidden|mixed>, ?power=<type>, ?drop=<0..1>, ?auto
const params = new URLSearchParams(location.search);
const debugLevel = TEST_LEVELS[params.get('level') ?? ''] ?? LEVEL_1;
const powerParam = params.get('power');
const forcedPower = (POWER_TYPES as readonly string[]).includes(powerParam ?? '') ? (powerParam as PowerType) : undefined;
const autoPlay = params.has('auto');
const gallery = params.has('gallery');
const dropParam = params.get('drop');
const dropChance = dropParam !== null && dropParam !== '' && Number.isFinite(Number(dropParam)) ? Math.max(0, Math.min(1, Number(dropParam))) : undefined;

const campaignParam = Number(params.get('campaign'));
const campaignJump = params.has('campaign') && Number.isInteger(campaignParam) && campaignParam >= 1 && campaignParam <= CAMPAIGN.length ? campaignParam - 1 : -1;
const testMode = campaignJump < 0 && params.has('level');

const mkWorld = (level: Level, o: { lives?: number; score?: number; levelIndex?: number; featured?: PowerType } = {}): World =>
  createWorld(level, {
    seed: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0,
    ...o,
    ...(forcedPower ? { forcedPower } : {}),
    ...(dropChance !== undefined ? { dropChance } : {}),
  });
let world = mkWorld(debugLevel);
const renderer = new Renderer();
renderer.loadLevel(world);
/** Ball positions before the last step, for render interpolation. */
const prev: XY[] = snapshotBalls(world.balls, []);

// ---- Campaign flow ----
let progress = loadProgress();
let run: RunState | null = null;
let inTest = false;
let ended = false;
let endAt = 0;
let outcome: WinOutcome | null = null;
let prevBest = 0;
let levelsStarted = 0;

const menus = new Menus(uiRoot, nav, () => controls.clearFire(), (i) => {
  // Rising chime and a light tick as each star pops in.
  sound.play('star', { pitch: [1, 1.26, 1.5][i] ?? 1.5 });
  if (st.haptics && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(10 + i * 4);
    } catch {
      /* not allowed before a gesture */
    }
  }
});
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const toTitle = (): void => {
  menus.close();
  ui.showTitle();
};

function resetFor(w: World): void {
  world = w;
  renderer.loadLevel(world);
  snapshotBalls(world.balls, prev);
  sound.duckMusic(false);
  if (levelsStarted++ > 0) sound.nextTrack();
  ended = false;
  outcome = null;
  ui.closePause();
  menus.close();
  controls.clearFire();
  // Automatic tilt neutral = how the phone is held as this level's serve starts.
  controls.tilt.armNeutral();
}

function startLevel(r: RunState): void {
  run = r;
  inTest = false;
  const lv = CAMPAIGN[r.levelIndex];
  resetFor(mkWorld(lv, { lives: r.startLives, score: r.startScore, levelIndex: r.levelIndex, ...(lv.featured ? { featured: lv.featured } : {}) }));
  renderer.levelLabel = `LV ${r.levelIndex + 1}`;
  saveRun(r);
  const first = r.levelIndex === 0 && takeFirstRun();
  menus.showIntro(r.levelIndex + 1, lv.name, introHint(lv.hint, first, st.mode), first ? 3200 : 1600);
}

function startTest(): void {
  run = null;
  inTest = true;
  resetFor(mkWorld(debugLevel));
  renderer.levelLabel = '';
}

const governor = new QualityGovernor();
let appliedGfx = st.graphics;
let appliedLevel = -1;
function applyQuality(): void {
  appliedGfx = st.graphics;
  const level = effectiveQuality(st.graphics, governor.level);
  if (level === appliedLevel) return;
  appliedLevel = level;
  renderer.quality = level;
  view.setDprCap(QUALITY_DPR[level]);
}

applyQuality();
const AUTO_MS = autoPlay ? 1500 : 0;

// Top HUD band: one layout shared by the canvas (score / level / hearts) and the DOM buttons (pause / fullscreen).
const fsSupported = isFullscreenSupported();
let hudVersion = -1;
function layoutHud(): void {
  if (view.version === hudVersion) return;
  hudVersion = view.version;
  renderer.hud = computeHudLayout({
    cssW: view.cssWidth,
    cssH: view.cssHeight,
    scale: view.cssScale,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    safe: readSafeInsets(),
    fullscreenSupported: fsSupported,
  });
  ui.layoutHud(renderer.hud);
}

function showLevelSelect(onBack: () => void): void {
  menus.showLevelSelect(progress, { onPick: (i) => startLevel(startRun(i)), onBack });
}

const ui = createControlsUi(
  uiRoot,
  controls,
  sound,
  {
    onPlay: () => {
      if (campaignJump >= 0) startLevel(startRun(campaignJump));
      else if (testMode) startTest();
      else {
        const resume = continueRun(loadRun(), progress.unlocked);
        if (resume) {
          const detail = `Lives ${resume.startLives} · Score ${fmt(resume.startScore)}`;
          menus.showContinue(
            resume.levelIndex + 1,
            { onContinue: () => startLevel(resume), onNew: () => startLevel(startRun(0)), onBack: toTitle },
            resume.startScore > 0 || resume.startLives !== 3 ? detail : undefined,
          );
        } else startLevel(startRun(0));
      }
    },
    onLevels: () => showLevelSelect(toTitle),
    onPauseLevels: () => showLevelSelect(() => menus.close()),
  },
  nav,
);

function showEndCard(): void {
  const won = world.status === 'won';
  if (inTest || !run) {
    menus.card({
      title: won ? 'STAGE CLEAR!' : 'GAME OVER',
      tone: won ? 'win' : 'lose',
      stats: [['Score', fmt(world.score)]],
      buttons: [{ label: 'Play again', primary: true, onClick: startTest }],
      autoMs: AUTO_MS,
    });
    return;
  }
  const r = run;
  const lv = CAMPAIGN[r.levelIndex];
  const levels = (): void => showLevelSelect(toTitle);
  if (won && outcome) {
    const o = outcome;
    if (o.worldComplete) {
      menus.card({
        kicker: 'WORLD 1 COMPLETE',
        title: 'You shattered it all!',
        tone: 'win',
        stars: o.stars,
        stats: [['Level score', fmt(o.levelScore)], ['Total score', fmt(o.totalScore), true]],
        buttons: [{ label: 'Levels', primary: true, onClick: levels }, { label: 'Title', onClick: toTitle }],
        onBack: levels,
      });
      return;
    }
    const next = o.next as RunState;
    menus.card({
      kicker: `LEVEL ${r.levelIndex + 1} COMPLETE`,
      title: lv.name,
      tone: 'win',
      stars: o.stars,
      stats: [
        ['Level score', fmt(o.levelScore), prevBest > 0 && o.levelScore > prevBest],
        ['Total score', fmt(o.totalScore)],
        ...(prevBest > 0 && o.levelScore > prevBest ? ([['New best!', '']] as [string, string][]) : []),
      ],
      buttons: [{ label: 'Next level', primary: true, onClick: () => startLevel(next) }, { label: 'Levels', onClick: levels }],
      onBack: levels,
      autoMs: AUTO_MS,
    });
    return;
  }
  menus.card({
    kicker: `LEVEL ${r.levelIndex + 1}`,
    title: 'GAME OVER',
    subtitle: lv.name,
    tone: 'lose',
    stats: [['Level score', fmt(Math.max(0, world.score - r.startScore))], ['Total score', fmt(world.score)]],
    buttons: [{ label: 'Retry level', primary: true, onClick: () => startLevel(retryLevel(r)) }, { label: 'Levels', onClick: levels }],
    onBack: levels,
    autoMs: AUTO_MS,
  });
}

let introWas = false;
function update(dt: number): void {
  if (!ui.started() || ui.paused()) return;
  const inp = controls.input();
  const intro = menus.introActive();
  if (introWas && !intro) controls.tilt.armNeutral(); // the serve starts now: take the held position as neutral
  introWas = intro;
  if (intro && inp.fire) {
    menus.dismissIntro();
    inp.fire = false;
  }
  if (!ended && (world.status === 'won' || world.status === 'gameover')) {
    ended = true;
    endAt = performance.now() + (world.status === 'won' ? 1400 : 900);
    if (world.status === 'won' && run) {
      const lv = CAMPAIGN[run.levelIndex];
      outcome = winLevel(run, world.lives, world.score, lv.stars, CAMPAIGN.length);
      prevBest = progress.best[run.levelIndex];
      progress = recordWin(progress, run.levelIndex, outcome.stars, outcome.levelScore, CAMPAIGN.length);
      saveProgress(progress);
      if (outcome.next) saveRun(outcome.next);
      else clearRun();
    } else if (world.status === 'gameover' && run) saveRun(retryLevel(run));
  }
  if (ended && performance.now() >= endAt) {
    showEndCard();
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
  nav.poll();
  const pausePressed = controls.pausePressed();
  if (nav.takeBackFlag()) {
    /* Escape already went back in a menu */
  } else if (pausePressed) ui.togglePause();
  ui.setExternalModal(menus.open());
  if (ui.paused()) controls.clearFire();
  wakeLock.update(shouldHoldWakeLock({ started: ui.started(), paused: ui.paused(), hidden: document.visibilityState === 'hidden', status: world.status }));
  controls.setStickGhost(ui.started() && !ui.paused() && world.status === 'serve');
  const c = ctx as CanvasRenderingContext2D;
  if (view.pixelScale <= 0) return; // canvas not laid out yet
  layoutHud();
  view.begin(c);
  if (gallery) {
    drawGallery(c, view.pixelScale, now / 1000);
    return;
  }

  if (governor.frame(now / 1000) || st.graphics !== appliedGfx) applyQuality();
  renderer.shake.enabled = st.shake && !st.reducedFx && renderer.quality === 0;
  renderer.reduced = st.reducedFx;
  renderer.beat = sound.beat();
  renderer.showStatus = ui.started() && !ui.paused();
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
  const t0 = performance.now();
  renderer.draw(c, world, prev, alpha, now / 1000);
  renderer.drawMs += (performance.now() - t0 - renderer.drawMs) * 0.05;
}

if (params.has('fps')) (window as unknown as { __shatter?: unknown }).__shatter = { renderer, get world() { return world; } };
new Loop(update, render).start();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is optional */
  });
}
