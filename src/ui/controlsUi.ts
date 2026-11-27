import { enterImmersive } from '../game/fullscreen';
import type { Controls } from '../input/controls';
import { saveSettings } from '../input/settings';
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
  start.append(logo, tag, startBtn, levelsBtn, tip);
  const choose = async (act: (() => void) | undefined): Promise<void> => {
    startBtn.disabled = true;
    levelsBtn.disabled = true;
    let hint = '';
    if (!started) {
      sound?.unlock();
      sound?.playMusic(0);
      void enterImmersive();
      hint = 'Drag anywhere to move · tap to launch';
      if (s.mode === 'tilt') {
        hint = (await tryTilt()) ? 'Tilt to move · tap to launch' : 'Tilt not available here, drag to move';
      }
    }
    start.remove();
    titleOpen = false;
    started = true;
    startBtn.disabled = false;
    levelsBtn.disabled = false;
    controls.clearFire();
    if (hint) showHint(hint);
    act?.();
  };
  startBtn.addEventListener('click', () => void choose(hooks?.onPlay));
  levelsBtn.addEventListener('click', () => void choose(hooks?.onLevels));
  root.appendChild(start);
  nav?.register(start);
  nav?.focusInitial(start);

  // ---- Pause overlay ----
  const pauseOv = el('div', 'ui-overlay');
  pauseOv.append(el('h1', 'ui-h', 'PAUSED'));
  const resumeBtn = el('button', 'ui-btn big', 'RESUME');
  resumeBtn.dataset.primary = '1';
  pauseOv.append(resumeBtn);
  if (hooks) {
    const pauseLevels = el('button', 'ui-btn mid', 'LEVELS');
    pauseLevels.addEventListener('click', () => hooks.onPauseLevels());
    pauseOv.append(pauseLevels);
  }
  nav?.register(pauseOv);
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

  // ---- Settings panel ----
  const gear = el('button', 'ui-btn ui-gear');
  gear.innerHTML =
    '<svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="16" cy="16" r="4.2"/>' +
    '<path d="M16 3.5v4M16 24.5v4M3.5 16h4M24.5 16h4M7.2 7.2l2.8 2.8M22 22l2.8 2.8M7.2 24.8l2.8-2.8M22 10l2.8-2.8"/>' +
    '<circle cx="16" cy="16" r="9"/></svg>';
  gear.setAttribute('aria-label', 'Settings');
  root.appendChild(gear);

  const panelOv = el('div', 'ui-overlay');
  const panel = el('div', 'ui-panel');
  panel.append(el('h2', undefined, 'SETTINGS'));

  const modeRow = el('div', 'ui-row');
  modeRow.append(el('span', undefined, 'Control mode'));
  const seg = el('div', 'ui-seg');
  const tiltBtn = el('button', 'ui-btn', 'TILT');
  const dragBtn = el('button', 'ui-btn', 'DRAG');
  seg.append(tiltBtn, dragBtn);
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
  const closeBtn = el('button', 'ui-btn', 'DONE');

  const refresh = (): void => {
    tiltBtn.classList.toggle('on', s.mode === 'tilt');
    dragBtn.classList.toggle('on', s.mode === 'drag');
    const tilt = s.mode === 'tilt';
    tiltSens.row.style.display = tilt ? '' : 'none';
    invertRow.style.display = tilt ? '' : 'none';
    recal.style.display = tilt ? '' : 'none';
    dragSens.row.style.display = tilt ? 'none' : '';
  };

  dragBtn.addEventListener('click', () => {
    s.mode = 'drag';
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
    modeRow, tiltSens.row, invertRow, recal, dragSens.row,
    soundRow, volume.row, musicRow, musicVol.row,
    shakeRow, fxRow, gfxRow, hapticsRow, msg, closeBtn,
  );
  panelOv.append(panel);

  const openSettings = (): void => {
    if (settingsOpen || !started) return;
    hidePause();
    settingsOpen = true;
    msg.textContent = '';
    refresh();
    root.appendChild(panelOv);
  };
  const closeSettings = (): void => {
    if (!settingsOpen) return;
    settingsOpen = false;
    panelOv.remove();
    controls.clearFire();
  };
  gear.addEventListener('click', openSettings);
  closeBtn.addEventListener('click', closeSettings);

  // ---- Auto pause on focus loss ----
  const onLost = (): void => showPause();
  window.addEventListener('blur', onLost);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') showPause();
    syncAudio();
  });

  return {
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
      root.appendChild(start);
      nav?.focusInitial(start);
    },
    closePause: hidePause,
    setExternalModal: (open) => {
      external = open;
    },
  };
}
