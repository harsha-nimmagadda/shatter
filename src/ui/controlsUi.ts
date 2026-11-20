import { enterImmersive } from '../game/fullscreen';
import type { Controls } from '../input/controls';
import { saveSettings } from '../input/settings';

export interface ControlsUi {
  /** True once the start overlay has been dismissed. */
  started(): boolean;
  /** True while any overlay (settings or pause) stops the game. */
  paused(): boolean;
  /** Toggle pause overlay (keyboard / gamepad). */
  togglePause(): void;
  /** Pause automatically if playing (focus loss). */
  autoPause(): void;
  /** Swap the text title on the start overlay for the hand-lettered image (text stays if it is not an <img>). */
  setTitleImage(img: CanvasImageSource): void;
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

export function createControlsUi(root: HTMLElement, controls: Controls): ControlsUi {
  const s = controls.settings;
  let started = false;
  let settingsOpen = false;
  let pauseShown = false;

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
  const start = el('div', 'ui-overlay');
  const startTitle = el('h1', undefined, 'Shatter');
  start.append(startTitle);
  const startBtn = el('button', 'ui-btn big', 'Tap to start');
  start.append(startBtn);
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    void enterImmersive();
    let hint = 'Drag anywhere to move · tap to launch';
    if (s.mode === 'tilt') {
      hint = (await tryTilt()) ? 'Tilt to move · tap to launch' : 'Tilt not available here, drag to move';
    }
    start.remove();
    started = true;
    controls.clearFire();
    showHint(hint);
  });
  root.appendChild(start);

  // ---- Pause overlay ----
  const pauseOv = el('div', 'ui-overlay');
  pauseOv.append(el('h1', undefined, 'Paused'));
  const resumeBtn = el('button', 'ui-btn big', 'Tap to resume');
  pauseOv.append(resumeBtn);
  const hidePause = (): void => {
    if (!pauseShown) return;
    pauseShown = false;
    pauseOv.remove();
    controls.clearFire();
  };
  const showPause = (): void => {
    if (pauseShown || settingsOpen || !started) return;
    pauseShown = true;
    root.appendChild(pauseOv);
  };
  resumeBtn.addEventListener('click', hidePause);

  // ---- Settings panel ----
  const gear = el('button', 'ui-btn ui-gear');
  gear.innerHTML =
    '<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M24.5 15.2c.4 5-3.6 9.3-8.6 9.3s-8.9-4.3-8.2-9.2c.7-4.6 4.5-8 8.8-7.7 4.2.3 7.6 3.6 8 7.6z"/>' +
    '<path d="M26.0 16.0L30.0 16.4M23.1 23.1L25.6 26.2M16.0 26.0L15.6 30.0M8.9 23.1L5.8 25.6M6.0 16.0L2.0 15.6M8.9 8.9L6.4 5.8M16.0 6.0L16.4 2.0M23.1 8.9L26.2 6.4"/>' +
    '<path d="M18.6 15.6c.2 1.7-1.2 3-2.8 2.9-1.6-.2-2.7-1.6-2.4-3.1.3-1.5 1.6-2.4 3-2.2 1.2.2 2.1 1.2 2.2 2.4z"/></svg>';
  gear.setAttribute('aria-label', 'Settings');
  root.appendChild(gear);

  const panelOv = el('div', 'ui-overlay');
  const panel = el('div', 'ui-panel');
  panel.append(el('h2', undefined, 'Settings'));

  const modeRow = el('div', 'ui-row');
  modeRow.append(el('span', undefined, 'Control mode'));
  const seg = el('div', 'ui-seg');
  const tiltBtn = el('button', 'ui-btn', 'Tilt');
  const dragBtn = el('button', 'ui-btn', 'Drag');
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
  const recal = el('button', 'ui-btn', 'Recalibrate');
  const dragSens = slider('Drag sensitivity', 0.5, 3, 0.1, () => s.dragSensitivity, (v) => (s.dragSensitivity = v));
  const closeBtn = el('button', 'ui-btn', 'Close');

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

  panel.append(modeRow, tiltSens.row, invertRow, recal, dragSens.row, shakeRow, msg, closeBtn);
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
  });

  return {
    started: () => started,
    paused: () => settingsOpen || pauseShown,
    togglePause: () => {
      if (!started || settingsOpen) return;
      if (pauseShown) hidePause();
      else showPause();
    },
    autoPause: showPause,
    setTitleImage: (src) => {
      if (!(src instanceof HTMLImageElement) || !src.src || !startTitle.isConnected) return;
      const img = el('img', 'ui-title');
      img.alt = 'Shatter';
      img.draggable = false;
      img.addEventListener('error', () => {
        img.replaceWith(startTitle);
      });
      img.src = src.src;
      startTitle.replaceWith(img);
    },
  };
}
