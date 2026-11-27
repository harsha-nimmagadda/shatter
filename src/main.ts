import './style.css';
import { View } from './game/view';
import { Loop } from './game/loop';
import { CAMPAIGN, CONFIG, LEVEL_1, POWER_TYPES, TEST_LEVELS, createWorld, drainEvents, step, type GameEvent, type Level, type PowerType, type World } from './engine';
import { Controls } from './input/controls';
import { Renderer } from './render/renderer';
import { drawGallery } from './render/gallery';
import { snapshotBalls, type XY } from './render/powerVisuals';
import { createControlsUi } from './ui/controlsUi';
import { Menus } from './ui/menus';
import { CountdownView } from './ui/countdownView';
import { UiFx, installUiFeedback } from './ui/feedback';
import { enablePressStates, motionOff, setReduceMotion, wipe } from './ui/motion';
import { Nav } from './ui/nav';
import { loadProgress, recordWin, saveProgress } from './game/progress';
import { clearRun, continueRun, loadRun, retryLevel, saveRun, startRun, winLevel, type RunState, type WinOutcome } from './game/run';
import { QUALITY_DPR, QualityGovernor, effectiveQuality } from './game/quality';
import { introHint, takeFirstRun } from './game/hints';
import { Attract } from './game/attract';
import { Countdown, needsCountdown } from './game/countdown';
import { tallyRows } from './game/tally';
import { pickTip } from './game/tips';
import { isFullscreenSupported } from './game/fullscreen';
import { computeHudLayout, readSafeInsets } from './game/hud';
import { Installer, dismissIosHint, iosHintNow } from './game/install';
import { SLOWMO, BRICK_CALLOUT, Taught, pendingBrickCallouts, slowMoScale, teachingAllowed } from './game/teaching';
import { resetProgressData } from './game/reset';
import { defaultProgress } from './game/progress';
import { isBadPower } from './render/powerVisuals';
import { dismissCallout, showCallout } from './ui/callout';
import { removeStore } from './ui/storage';
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
const fx = new UiFx(sound, st);
installUiFeedback(uiRoot, fx);
enablePressStates();
setReduceMotion(st.reduceMotion);
const installer = new Installer();
const taught = new Taught();
/** Real seconds of first-hazard slow-motion left. */
let slowLeft = 0;
let hazardPending = !taught.has('hazard');
nav.onBack = () => fx.play('back');
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
const attractParam = Number(params.get('attract'));
/** Seeds the title-screen demo: the same session seed always shows the same levels. */
const attractSeed = params.has('attract') && Number.isFinite(attractParam) ? attractParam >>> 0 : (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0;

const mkWorld = (level: Level, o: { lives?: number; score?: number; levelIndex?: number; featured?: PowerType } = {}): World =>
  createWorld(level, {
    seed: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0,
    ...o,
    ...(forcedPower ? { forcedPower } : {}),
    ...(dropChance !== undefined ? { dropChance } : {}),
  });
// The title-screen demo plays on the same world / renderer the game uses; a real level replaces it (see resetFor).
const attract = new Attract(attractSeed);
let inGame = false;
let world: World = attract.world;
const renderer = new Renderer();
renderer.showHud = false;
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

const menus = new Menus(uiRoot, nav, () => controls.clearFire(), fx, {
  star: (i) => {
    // Rising chime and a light tick as each star pops in.
    sound.play('star', { pitch: [1, 1.26, 1.5][i] ?? 1.5 });
    fx.haptic(10 + i * 4);
  },
  best: () => {
    sound.play('goldstar');
    fx.haptic(24);
  },
});
const countdown = new Countdown();
const countView = new CountdownView(uiRoot);
let shownCount = 0;
/** Screen jump with the neon wipe: the switch runs while the screen is covered (instant for the autopilot). */
const go = (fn: () => void): void => {
  if (autoPlay) {
    fn();
    return;
  }
  fx.play('whoosh');
  void wipe(uiRoot, fn);
};
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const toTitle = (): void => {
  menus.close();
  ui.showTitle();
};

function resetFor(w: World): void {
  inGame = true;
  countdown.cancel();
  slowLeft = 0;
  dismissCallout(true);
  renderer.showHud = true;
  world = w;
  renderer.loadLevel(world);
  snapshotBalls(world.balls, prev);
  sound.duckMusic(false);
  if (levelsStarted++ > 0) sound.nextTrack();
  ended = false;
  outcome = null;
  ui.closePause();
  menus.close(true);
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
  renderer.starGoals = lv.stars;
  renderer.levelBase = r.startScore;
  saveRun(r);
  const first = r.levelIndex === 0 && takeFirstRun();
  menus.showIntro(r.levelIndex + 1, lv.name, introHint(lv.hint, first, st.mode), first ? 3200 : 1600);
  void teachBricks(world, levelsStarted);
}

/** First time a special brick type shows up in a level: one short callout at a time under the level intro. */
async function teachBricks(w: World, token: number): Promise<void> {
  if (!teachingAllowed(st.tips, performance.now())) return;
  const list = pendingBrickCallouts(new Set(w.bricks.map((b) => b.type)), taught.all);
  for (const t of list) {
    await new Promise((r) => window.setTimeout(r, 350));
    if (token !== levelsStarted || !inGame || !teachingAllowed(st.tips, performance.now())) return;
    taught.mark(`brick:${t}`);
    await showCallout(uiRoot, BRICK_CALLOUT[t]);
  }
}

function startTest(): void {
  run = null;
  inTest = true;
  resetFor(mkWorld(debugLevel));
  renderer.levelLabel = '';
  renderer.starGoals = null;
  renderer.levelBase = 0;
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
  syncLite();
}

/** html[data-lite=1] drops the costly CSS extras (title backdrop blur) on the cheaper effect set. */
function syncLite(): void {
  document.documentElement.dataset.lite = st.reducedFx || renderer.quality > 0 ? '1' : '0';
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
  menus.showLevelSelect(progress, { onPick: (i) => go(() => startLevel(startRun(i))), onBack });
}

/** Back to the title: a fresh demo level starts behind it. */
function resumeAttract(): void {
  inGame = false;
  countdown.cancel();
  menus.dismissIntro();
  renderer.showHud = false;
  renderer.levelLabel = '';
  attract.restart();
  world = attract.world;
  renderer.loadLevel(world);
  snapshotBalls(world.balls, prev);
  ended = false;
  outcome = null;
}

const ui = createControlsUi(
  uiRoot,
  controls,
  sound,
  {
    onPlay: () => {
      if (campaignJump >= 0) go(() => startLevel(startRun(campaignJump)));
      else if (testMode) go(startTest);
      else {
        const resume = continueRun(loadRun(), progress.unlocked);
        if (resume) {
          const detail = `Lives ${resume.startLives} · Score ${fmt(resume.startScore)}`;
          menus.showContinue(
            resume.levelIndex + 1,
            { onContinue: () => go(() => startLevel(resume)), onNew: () => go(() => startLevel(startRun(0))), onBack: toTitle },
            resume.startScore > 0 || resume.startLives !== 3 ? detail : undefined,
          );
        } else go(() => startLevel(startRun(0)));
      }
    },
    onResume: () => {
      // Closing the pause menu mid-rally: 3-2-1 before the ball moves again (a serve resumes at once).
      if (inGame && needsCountdown(world.status) && !menus.introActive()) countdown.start();
    },
    install: installer,
    iosHint: () => iosHintNow(progress.unlocked > 0 || progress.stars.some((x) => x > 0)),
    onIosHintDismiss: dismissIosHint,
    onResetProgress: () => {
      resetProgressData(removeStore);
      progress = defaultProgress();
      taught.reload();
      hazardPending = true;
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
    const tally = tallyRows(o.levelScore, world.lives, CONFIG.winLifeBonus);
    if (o.worldComplete) {
      menus.card({
        kicker: 'WORLD 1 COMPLETE',
        title: 'You shattered it all!',
        tone: 'win',
        stars: o.stars,
        tally,
        stats: [['Total score', fmt(o.totalScore), true]],
        ...(prevBest > 0 && o.levelScore > prevBest ? { badge: 'NEW BEST!' } : {}),
        buttons: [{ label: 'Levels', primary: true, onClick: levels }, { label: 'Title', back: true, onClick: toTitle }],
        onBack: levels,
        autoMs: AUTO_MS,
      });
      return;
    }
    const next = o.next as RunState;
    menus.card({
      kicker: `LEVEL ${r.levelIndex + 1} COMPLETE`,
      title: lv.name,
      tone: 'win',
      stars: o.stars,
      tally,
      stats: [['Run total', fmt(o.totalScore)]],
      ...(prevBest > 0 && o.levelScore > prevBest ? { badge: 'NEW BEST!' } : {}),
      buttons: [{ label: 'Next level', primary: true, onClick: () => go(() => startLevel(next)) }, { label: 'Levels', onClick: levels }],
      next: { index: next.levelIndex },
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
    tip: pickTip(st.mode, Math.random()),
    buttons: [{ label: 'Retry level', primary: true, onClick: () => go(() => startLevel(retryLevel(r))) }, { label: 'Levels', onClick: levels }],
    onBack: levels,
    autoMs: AUTO_MS,
  });
}

let introWas = false;
let reduceSynced = st.reduceMotion;
let fxSynced = st.reducedFx;
let musicScene: 'menu' | 'game' = 'menu';
/** One fixed step of the title-screen demo (frozen while Reduce motion is on). */
function updateAttract(dt: number): void {
  if (motionOff()) return;
  snapshotBalls(world.balls, prev);
  if (attract.update(dt)) {
    world = attract.world;
    renderer.loadLevel(world);
    snapshotBalls(world.balls, prev);
  }
}

function update(dt: number): void {
  if (!inGame) {
    updateAttract(dt);
    return;
  }
  if (!ui.started() || ui.paused()) return;
  if (countdown.active) {
    // Resume countdown: the game stands still and taps do nothing.
    controls.clearFire();
    if (countdown.update(dt).finished) fx.play('go');
    return;
  }
  const inp = controls.input();
  const intro = menus.introActive();
  if (introWas && !intro) controls.tilt.armNeutral(); // the serve starts now: take the held position as neutral
  introWas = intro;
  // Adaptive tilt: learn only while a ball is really in play; ask for its quick start at a serve when it is due.
  controls.tilt.setInPlay(!intro && world.status === 'playing' && world.balls.some((b) => !b.stuck));
  controls.tilt.pollServe(!intro && world.status === 'serve' && st.mode === 'tilt');
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
  const scale = slowMoScale(slowLeft);
  if (slowLeft > 0) slowLeft -= dt;
  step(world, inp, dt * scale);
  if (hazardPending && run && st.tips && world.drops.length > 0 && teachingAllowed(true, performance.now())) {
    for (let i = 0; i < world.drops.length; i++) {
      if (!isBadPower(world.drops[i].type)) continue;
      hazardPending = false;
      taught.mark('hazard');
      renderer.startHazardCallout(world.drops[i].id);
      if (!motionOff()) slowLeft = SLOWMO.seconds;
      break;
    }
  }
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

/** Fades out the inline boot splash (index.html) once the first frame is on the canvas. */
let bootEl: HTMLElement | null = document.getElementById('boot');
function hideBoot(): void {
  const b = bootEl;
  if (!b) return;
  bootEl = null;
  if (motionOff()) b.remove();
  else {
    b.classList.add('done');
    window.setTimeout(() => b.remove(), 450);
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
  if (inGame && ui.titleShown()) resumeAttract(); // quit to title: the demo takes over again
  if (ui.paused()) controls.clearFire();
  if (countdown.active && (ui.paused() || !inGame)) countdown.cancel();
  if (countdown.active) {
    const v = countdown.value;
    if (v !== shownCount) {
      shownCount = v;
      countView.show(v);
      fx.play('count');
    }
  } else if (shownCount !== 0) {
    shownCount = 0;
    countView.hide();
  }
  if (st.reduceMotion !== reduceSynced) {
    reduceSynced = st.reduceMotion;
    setReduceMotion(reduceSynced);
  }
  if (st.reducedFx !== fxSynced) {
    fxSynced = st.reducedFx;
    syncLite();
  }
  // Menus (and the title) get the calm loop; a level in play gets its gameplay track; both crossfade.
  const scene = !inGame || menus.open() || ui.titleShown() ? 'menu' : 'game';
  if (scene !== musicScene) {
    musicScene = scene;
    sound.setScene(scene);
  }
  wakeLock.update(shouldHoldWakeLock({ started: ui.started() && inGame, paused: ui.paused(), hidden: document.visibilityState === 'hidden', status: world.status }));
  controls.setStickGhost(inGame && ui.started() && !ui.paused() && world.status === 'serve');
  const c = ctx as CanvasRenderingContext2D;
  if (view.pixelScale <= 0) return; // canvas not laid out yet
  layoutHud();
  view.begin(c);
  if (gallery) {
    drawGallery(c, view.pixelScale, now / 1000);
    hideBoot();
    return;
  }

  if (governor.frame(now / 1000) || st.graphics !== appliedGfx) applyQuality();
  renderer.shake.enabled = st.shake && !st.reducedFx && !st.reduceMotion && renderer.quality === 0;
  renderer.tips = st.tips;
  renderer.calm = st.reduceMotion;
  renderer.reduced = st.reducedFx;
  renderer.beat = sound.beat();
  renderer.showStatus = ui.started() && !ui.paused();
  renderer.setPixelScale(view.pixelScale);
  const events = drainEvents(world);
  if (events.length && inGame) {
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
  hideBoot();
}

if (params.has('fps')) (window as unknown as { __shatter?: unknown }).__shatter = { renderer, controls, get world() { return world; } };
new Loop(update, render).start();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is optional */
  });
}
