import { enterFullscreen, exitFullscreen, isFullscreen, isFullscreenSupported, onFullscreenChange } from '../game/fullscreen';
import type { Controls } from '../input/controls';
import type { ControlSettings } from '../input/settings';
import { hasSavedSettings, hasTouch, saveSettings } from '../input/settings';
import type { SoundManager } from '../audio/sound';
import type { Nav } from './nav';

export interface UiHooks {
  /** PLAY on the title. */
  onPlay(): void;
  /** LEVELS on the title. */
  onLevels(): void;
  /** LEVELS on the pause overlay. */
  onPauseLevels(): void;
}

export interface ControlsUi {
  /** True once the start overlay has been dismissed. */
  started(): boolean;
  /** True while any overlay (settings or pause) stops the game. */
  paused(): boolean;
  /** Toggle pause overlay (keyboard / gamepad). */
  togglePause(): void;
  /** Pause automatically if playing (focus loss). */
  autoPause(): void;
  /** Show the title overlay again (Back from level select). */
  showTitle(): void;
  /** Close the pause overlay if shown. */
  closePause(): void;
  /** Tell the UI an external menu (cards, level select) is open: game stays stopped, no auto-pause overlay. */
  setExternalModal(open: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const svg = (inner: string, size = 26): string =>
  `<svg viewBox="0 0 32 32" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const PAUSE_ICON = svg('<path d="M11 7v18M21 7v18"/>');
const EXPAND_ICON = svg('<path d="M5 12V5h7M27 12V5h-7M5 20v7h7M27 20v7h-7"/>', 24);
const COLLAPSE_ICON = svg('<path d="M12 5v7H5M20 5v7h7M12 27v-7H5M20 27v-7h7"/>', 24);
const TILT_ICON = svg('<rect x="10" y="4" width="12" height="24" rx="3" transform="rotate(-20 16 16)"/><path d="M4 14a14 14 0 0 1 4-7M28 18a14 14 0 0 1-4 7"/>', 30);
const DRAG_ICON = svg('<path d="M4 16h24M9 11l-5 5 5 5M23 11l5 5-5 5"/>', 30);
const STICK_ICON = svg('<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="4" fill="currentColor"/>', 30);

export function createControlsUi(root: HTMLElement, controls: Controls, sound?: SoundManager, hooks?: UiHooks, nav?: Nav): ControlsUi {
  const s = controls.settings;
  let started = false;
  let settingsOpen = false;
  let pauseShown = false;
  let titleOpen = true;
  let external = false;

  // ---- Audio: suspend while the pause overlay or a hidden tab stops the game ----
  const syncAudio = (): void => {
    if (!sound || !started) return;
    if (pauseShown || document.visibilityState === 'hidden') sound.suspend();
    else sound.resume();
  };
  root.addEventListener('click', (e) => {
    if ((e.target as HTMLElement | null)?.closest?.('button')) sound?.play('click');
  });

  // ---- Hint ----
  let hintTimer = 0;
  const showHint = (text: string): void => {
    root.querySelector('.ui-hint')?.remove();
    const h = el('div', 'ui-hint', text);
    root.appendChild(h);
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      h.style.opacity = '0';
      window.setTimeout(() => h.remove(), 500);
    }, 1500);
  };

  // Tries to enable tilt from a user gesture; falls back to drag. Returns true on success.
  const tryTilt = async (): Promise<boolean> => {
    const r = await controls.tilt.enable();
    if (r === 'granted') {
      controls.tilt.calibrate();
      return true;
    }
    s.mode = 'drag';
    saveSettings(s);
    return false;
  };

  // ---- Start overlay ----
  const start = el('div', 'ui-overlay ui-start');
  const logo = el('h1', 'ui-logo');
  logo.setAttribute('aria-label', 'Shatter');
  // Each letter is its own span so the logo can "shatter" in with a stagger.
  'SHATTER'.split('').forEach((ch, i) => {
    const sp = el('span', undefined, ch);
    sp.style.setProperty('--i', String(i));
    sp.setAttribute('aria-hidden', 'true');
    logo.append(sp);
  });
  const tag = el('p', 'ui-tag', 'NEON BRICK BREAKER');
  const startBtn = el('button', 'ui-btn big', 'PLAY');
  startBtn.dataset.primary = '1';
  const levelsBtn = el('button', 'ui-btn mid', 'LEVELS');
  const tip = el('p', 'ui-tip', 'Catch the falling power-ups. Red spiky ones are trouble!');
  const settingsBtn = el('button', 'ui-btn small', 'SETTINGS');
  const titleFs = el('button', 'ui-btn ui-icon-btn');
  const titleRow = el('div', 'ui-title-row');
  titleRow.append(settingsBtn, titleFs);
  start.append(logo, tag, startBtn, levelsBtn, titleRow, tip);
  // First launch on a touch device: ask how to steer. Resolves with the picked mode (saved).
  const askControls = (): Promise<void> =>
    new Promise((resolve) => {
      const ov = el('div', 'ui-overlay ui-cardov');
      const card = el('div', 'ui-card ui-choose');
      card.append(el('h2', 'ui-card-title', 'How do you want to steer?'));
      const opts: [ControlSettings['mode'], string, string, string][] = [
        ['tilt', 'TILT', 'Tilt your phone', TILT_ICON],
        ['drag', 'DRAG', 'Slide a finger anywhere', DRAG_ICON],
        ['stick', 'STICK', 'On-screen thumbstick', STICK_ICON],
      ];
      for (const [mode, name, desc, icon] of opts) {
        const b = el('button', 'ui-choice');
        const ic = el('span', 'ic');
        ic.innerHTML = icon;
        const tx = el('span', 'tx');
        tx.append(el('b', undefined, name), el('i', undefined, desc));
        b.append(ic, tx);
        if (mode === 'tilt') b.dataset.primary = '1';
        b.addEventListener('click', async () => {
          // The tilt permission request must run straight from this tap (iOS).
          s.mode = mode;
          if (mode === 'tilt' && !(await tryTilt())) tiltFailed = true;
          saveSettings(s);
          ov.remove();
          resolve();
        });
        card.append(b);
      }
      card.append(el('p', 'ui-note', 'You can change this later in Settings.'));
      ov.append(card);
      nav?.register(ov);
      root.appendChild(ov);
      nav?.focusInitial(ov);
    });
  let tiltFailed = false;

  const choose = async (act: (() => void) | undefined): Promise<void> => {
    startBtn.disabled = true;
    levelsBtn.disabled = true;
    let hint = '';
    if (!started) {
      sound?.unlock();
      sound?.playMusic(0);
      void enterFullscreen();
      const asked = hasTouch() && !hasSavedSettings();
      if (asked) await askControls();
      if (s.mode === 'tilt' && !asked) tiltFailed = !(await tryTilt());
      hint =
        tiltFailed
          ? 'Tilt not available here, drag to move'
          : s.mode === 'tilt'
            ? 'Tilt to move · tap to launch'
            : s.mode === 'stick'
              ? 'Use the stick on the left to move · tap the right side to launch'
              : 'Drag anywhere to move · tap to launch';
    }
    start.remove();
    titleOpen = false;
    started = true;
    startBtn.disabled = false;
    levelsBtn.disabled = false;
    syncHud();
    controls.clearFire();
    if (hint) showHint(hint);
    act?.();
  };
  startBtn.addEventListener('click', () => void choose(hooks?.onPlay));
  levelsBtn.addEventListener('click', () => void choose(hooks?.onLevels));
  root.appendChild(start);
  nav?.register(start);
  nav?.focusInitial(start);

  // ---- Fullscreen controls (all hidden where the API does not exist, e.g. iPhone Safari) ----
  const fsOK = isFullscreenSupported();
  const fsItems: { btn: HTMLElement; label: boolean }[] = [];
  const fsButton = (btn: HTMLElement, label: boolean): void => {
    btn.addEventListener('click', () => void (isFullscreen() ? exitFullscreen() : enterFullscreen()));
    fsItems.push({ btn, label });
    if (!fsOK) btn.hidden = true;
  };
  const syncFs = (): void => {
    const on = isFullscreen();
    for (const { btn, label } of fsItems) {
      if (label) btn.textContent = on ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
      else btn.innerHTML = on ? COLLAPSE_ICON : EXPAND_ICON;
      btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
    }
  };
  onFullscreenChange(syncFs);
  fsButton(titleFs, false);

  // ---- Pause overlay ----
  const pauseOv = el('div', 'ui-overlay ui-pauseov');
  pauseOv.append(el('h1', 'ui-h', 'PAUSED'));
  const resumeBtn = el('button', 'ui-btn big', 'RESUME');
  resumeBtn.dataset.primary = '1';
  const pauseSettings = el('button', 'ui-btn mid', 'SETTINGS');
  pauseOv.append(resumeBtn, pauseSettings);
  if (hooks) {
    const pauseLevels = el('button', 'ui-btn mid', 'LEVELS');
    pauseLevels.addEventListener('click', () => hooks.onPauseLevels());
    pauseOv.append(pauseLevels);
  }
  const pauseFs = el('button', 'ui-btn mid');
  fsButton(pauseFs, true);
  const quitBtn = el('button', 'ui-btn mid', 'QUIT TO TITLE');
  pauseOv.append(pauseFs, quitBtn);
  nav?.register(pauseOv);
  syncFs();
  const hidePause = (): void => {
    if (!pauseShown) return;
    pauseShown = false;
    pauseOv.remove();
    controls.clearFire();
    syncAudio();
  };
  const showPause = (): void => {
    if (pauseShown || settingsOpen || !started || titleOpen || external) return;
    pauseShown = true;
    root.appendChild(pauseOv);
    nav?.focusInitial(pauseOv);
    syncAudio();
  };
  resumeBtn.addEventListener('click', hidePause);

  // ---- HUD buttons: fullscreen (optional) and pause ----
  const hudFs = el('button', 'ui-btn ui-hud-btn ui-fs');
  fsButton(hudFs, false);
  syncFs();
  const pauseBtn = el('button', 'ui-btn ui-hud-btn ui-pause');
  pauseBtn.innerHTML = PAUSE_ICON;
  pauseBtn.setAttribute('aria-label', 'Pause');
  pauseBtn.addEventListener('click', showPause);
  root.prepend(hudFs, pauseBtn);
  const syncHud = (): void => {
    const show = started && !titleOpen && !external;
    pauseBtn.style.display = show ? '' : 'none';
    hudFs.style.display = show ? '' : 'none';
  };
  syncHud();

  // ---- Settings panel ----
  const panelOv = el('div', 'ui-overlay');
  const panel = el('div', 'ui-panel');
  panel.append(el('h2', undefined, 'SETTINGS'));

  const modeRow = el('div', 'ui-row');
  modeRow.append(el('span', undefined, 'Control mode'));
  const seg = el('div', 'ui-seg');
  const tiltBtn = el('button', 'ui-btn', 'TILT');
  const dragBtn = el('button', 'ui-btn', 'DRAG');
  const stickBtn = el('button', 'ui-btn', 'STICK');
  seg.append(tiltBtn, dragBtn, stickBtn);
  modeRow.append(seg);
  const msg = el('div', 'ui-msg');

  const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
    const row = el('div', 'ui-row');
    row.append(el('span', undefined, label));
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    input.addEventListener('input', () => {
      set(Number(input.value));
      saveSettings(s);
    });
    row.append(input);
    return { row, input };
  };

  const tiltSens = slider('Tilt sensitivity', 1, 10, 0.5, () => s.tiltSensitivity, (v) => (s.tiltSensitivity = v));
  const invertRow = el('label', 'ui-row inline');
  invertRow.append(el('span', undefined, 'Invert tilt'));
  const invert = el('input');
  invert.type = 'checkbox';
  invert.checked = s.invertTilt;
  invert.addEventListener('change', () => {
    s.invertTilt = invert.checked;
    saveSettings(s);
  });
  invertRow.append(invert);
  const shakeRow = el('label', 'ui-row inline');
  shakeRow.append(el('span', undefined, 'Screen shake'));
  const shakeBox = el('input');
  shakeBox.type = 'checkbox';
  shakeBox.checked = s.shake;
  shakeBox.addEventListener('change', () => {
    s.shake = shakeBox.checked;
    saveSettings(s);
  });
  shakeRow.append(shakeBox);
  const soundRow = el('label', 'ui-row inline');
  soundRow.append(el('span', undefined, 'Sound'));
  const soundBox = el('input');
  soundBox.type = 'checkbox';
  soundBox.checked = !s.muted;
  soundBox.addEventListener('change', () => {
    s.muted = !soundBox.checked;
    sound?.setMuted(s.muted);
    saveSettings(s);
    volume.input.disabled = s.muted;
  });
  soundRow.append(soundBox);
  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const row = el('label', 'ui-row inline');
    row.append(el('span', undefined, label));
    const box = el('input');
    box.type = 'checkbox';
    box.checked = get();
    box.addEventListener('change', () => {
      set(box.checked);
      saveSettings(s);
    });
    row.append(box);
    return row;
  };
  const musicRow = toggle('Music', () => s.music, (v) => {
    s.music = v;
    sound?.setMusic(v);
    musicVol.input.disabled = !v;
  });
  const musicVol = slider('Music volume', 0, 1, 0.05, () => s.musicVolume, (v) => {
    s.musicVolume = v;
    sound?.setMusicVolume(v);
  });
  musicVol.input.disabled = !s.music;
  const fxRow = toggle('Reduced effects', () => s.reducedFx, (v) => (s.reducedFx = v));
  const hapticsRow = toggle('Vibration', () => s.haptics, (v) => (s.haptics = v));
  const gfxRow = el('div', 'ui-row');
  gfxRow.append(el('span', undefined, 'Graphics'));
  const gfxSeg = el('div', 'ui-seg');
  const gfxBtns = (['auto', 'high', 'low'] as const).map((g) => {
    const b = el('button', 'ui-btn', g.toUpperCase());
    b.addEventListener('click', () => {
      s.graphics = g;
      saveSettings(s);
      syncGfx();
    });
    return [g, b] as const;
  });
  const syncGfx = (): void => {
    for (const [g, b] of gfxBtns) b.classList.toggle('on', s.graphics === g);
  };
  syncGfx();
  for (const [, b] of gfxBtns) gfxSeg.append(b);
  gfxRow.append(gfxSeg);
  const volume = slider('Volume', 0, 1, 0.05, () => s.volume, (v) => {
    s.volume = v;
    sound?.setVolume(v);
  });
  volume.input.disabled = s.muted;
  volume.input.addEventListener('change', () => sound?.play('powerup'));
  const recal = el('button', 'ui-btn', 'Recalibrate');
  const dragSens = slider('Drag sensitivity', 0.5, 3, 0.1, () => s.dragSensitivity, (v) => (s.dragSensitivity = v));
  const stickSpeed = slider('Stick speed', 0.6, 1.6, 0.05, () => s.stickSpeed, (v) => (s.stickSpeed = v));
  const closeBtn = el('button', 'ui-btn', 'DONE');

  const refresh = (): void => {
    tiltBtn.classList.toggle('on', s.mode === 'tilt');
    dragBtn.classList.toggle('on', s.mode === 'drag');
    stickBtn.classList.toggle('on', s.mode === 'stick');
    const tilt = s.mode === 'tilt';
    tiltSens.row.style.display = tilt ? '' : 'none';
    invertRow.style.display = tilt ? '' : 'none';
    recal.style.display = tilt ? '' : 'none';
    dragSens.row.style.display = s.mode === 'drag' ? '' : 'none';
    stickSpeed.row.style.display = s.mode === 'stick' ? '' : 'none';
  };

  dragBtn.addEventListener('click', () => {
    s.mode = 'drag';
    msg.textContent = '';
    saveSettings(s);
    refresh();
  });
  stickBtn.addEventListener('click', () => {
    s.mode = 'stick';
    msg.textContent = '';
    saveSettings(s);
    refresh();
  });
  tiltBtn.addEventListener('click', async () => {
    // enable() runs directly from this click (needed for the iOS permission prompt).
    const r = await controls.tilt.enable();
    if (r === 'granted') {
      s.mode = 'tilt';
      controls.tilt.calibrate();
      msg.textContent = '';
    } else {
      s.mode = 'drag';
      msg.textContent = 'Tilt not available here, using drag.';
    }
    saveSettings(s);
    refresh();
  });
  recal.addEventListener('click', () => {
    if (recal.dataset.armed !== '1') {
      recal.dataset.armed = '1';
      recal.textContent = 'Tap to set';
      msg.textContent = 'Hold the phone how you like to play, then tap';
      return;
    }
    recal.dataset.armed = '';
    recal.textContent = 'Recalibrate';
    controls.tilt.calibrate();
    msg.textContent = 'Calibrated.';
  });

  panel.append(
    modeRow, tiltSens.row, invertRow, recal, dragSens.row, stickSpeed.row,
    soundRow, volume.row, musicRow, musicVol.row,
    shakeRow, fxRow, gfxRow, hapticsRow, msg, closeBtn,
  );
  panelOv.append(panel);

  const openSettings = (): void => {
    if (settingsOpen) return;
    // From the pause overlay: hide it but keep the game paused (audio stays suspended); closing returns to it.
    if (pauseShown) pauseOv.remove();
    settingsOpen = true;
    msg.textContent = '';
    refresh();
    root.appendChild(panelOv);
    nav?.focusInitial(panelOv);
  };
  const closeSettings = (): void => {
    if (!settingsOpen) return;
    settingsOpen = false;
    panelOv.remove();
    controls.clearFire();
    if (pauseShown) {
      root.appendChild(pauseOv);
      nav?.focusInitial(pauseOv);
    } else if (titleOpen) nav?.focusInitial(start);
  };
  nav?.register(panelOv, closeSettings);
  pauseSettings.addEventListener('click', openSettings);
  settingsBtn.addEventListener('click', openSettings);
  closeBtn.addEventListener('click', closeSettings);
  quitBtn.addEventListener('click', () => api.showTitle());

  // ---- Auto pause on focus loss ----
  const onLost = (): void => showPause();
  window.addEventListener('blur', onLost);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') showPause();
    syncAudio();
  });

  const api: ControlsUi = {
    started: () => started,
    paused: () => settingsOpen || pauseShown || titleOpen || external,
    togglePause: () => {
      if (!started || settingsOpen || titleOpen || external) return;
      if (pauseShown) hidePause();
      else showPause();
    },
    autoPause: showPause,
    showTitle: () => {
      if (titleOpen) return;
      hidePause();
      titleOpen = true;
      syncHud();
      root.appendChild(start);
      nav?.focusInitial(start);
    },
    closePause: hidePause,
    setExternalModal: (open) => {
      if (open === external) return;
      external = open;
      syncHud();
    },
  };
  return api;
}
