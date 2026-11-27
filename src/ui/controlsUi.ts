import { enterFullscreen, exitFullscreen, isFullscreen, isFullscreenSupported, onFullscreenChange } from '../game/fullscreen';
import type { Controls } from '../input/controls';
import type { ControlSettings } from '../input/settings';
import { hasSavedSettings, hasTouch, saveSettings } from '../input/settings';
import type { SoundManager } from '../audio/sound';
import type { HudLayout } from '../game/hud';
import type { Nav } from './nav';
import { enter, leave } from './motion';
import { runTiltWizard } from './tiltWizard';
import type { Installer } from '../game/install';
import { versionString } from '../game/version';
import { CATEGORY_COLORS } from '../render/powerVisuals';

export interface UiHooks {
  /** PLAY on the title. */
  onPlay(): void;
  /** LEVELS on the title. */
  onLevels(): void;
  /** LEVELS on the pause overlay. */
  onPauseLevels(): void;
  /** The pause menu was closed by the player (not by quitting): play continues. */
  onResume?(): void;
  /** Add-to-Home-Screen: the captured install prompt (Chrome / Android / desktop). */
  install?: Installer;
  /** True when the one-time iPhone / iPad Safari "Add to Home Screen" hint should show on the title. */
  iosHint?(): boolean;
  /** The iOS hint was dismissed (persist it). */
  onIosHintDismiss?(): void;
  /** RESET PROGRESS was confirmed: clear progress, the saved run and first-run flags (settings stay). */
  onResetProgress?(): void;
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
  /** True while the title screen is up (also on the first launch, before PLAY). */
  titleShown(): boolean;
  /** Show the title overlay again (Back from level select). */
  showTitle(): void;
  /** Close the pause overlay if shown. */
  closePause(): void;
  /** Tell the UI an external menu (cards, level select) is open: game stays stopped, no auto-pause overlay. */
  setExternalModal(open: boolean): void;
  /** Place the pause / fullscreen HUD buttons from the shared HUD band layout (call when the View transform changes). */
  layoutHud(layout: HudLayout): void;
  /** Re-evaluate the title's INSTALL APP button and the iOS hint (call when the title shows or install state changes). */
  refreshTitle(): void;
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
const SETTINGS_ICON = svg('<path d="M4 9h12M24 9h4M4 16h4M16 16h12M4 23h14M26 23h2"/><circle cx="20" cy="9" r="3.5"/><circle cx="12" cy="16" r="3.5"/><circle cx="22" cy="23" r="3.5"/>', 28);
const LEVELS_ICON = svg('<rect x="5" y="5" width="9" height="9" rx="2"/><rect x="18" y="5" width="9" height="9" rx="2"/><rect x="5" y="18" width="9" height="9" rx="2"/><rect x="18" y="18" width="9" height="9" rx="2"/>', 28);
const HOME_ICON = svg('<path d="M4 15 16 5l12 10M8 13v14h16V13"/>', 28);
const EXPAND_ICON_L = svg('<path d="M5 12V5h7M27 12V5h-7M5 20v7h7M27 20v7h-7"/>', 28);
const COLLAPSE_ICON_L = svg('<path d="M12 5v7H5M20 5v7h7M12 27v-7H5M20 27v-7h7"/>', 28);
const SHARE_ICON = svg('<path d="M16 21V5M10 11l6-6 6 6M8 14H6v13h20V14h-2"/>', 22);
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
  let wizardOpen = false;

  // ---- Audio: suspend while the pause overlay or a hidden tab stops the game ----
  const syncAudio = (): void => {
    if (!sound || !started) return;
    sound.setPaused(pauseShown);
    if (document.visibilityState === 'hidden') sound.suspend();
    else sound.resume();
  };

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
    if (r === 'granted') return true;
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
  const installBtn = el('button', 'ui-btn small ui-install', 'INSTALL APP');
  installBtn.hidden = true;
  const iosNote = el('div', 'ui-ioshint');
  iosNote.hidden = true;
  const iosIcon = el('span', 'ic');
  iosIcon.innerHTML = SHARE_ICON;
  const iosText = el('span', 'tx');
  iosText.append(el('b', undefined, 'Add Shatter to your Home Screen for fullscreen play'), el('i', undefined, 'Tap the Share button, then "Add to Home Screen".'));
  const iosOk = el('button', 'ui-btn small', 'GOT IT');
  iosOk.dataset.sfx = 'back';
  iosNote.append(iosIcon, iosText, iosOk);
  const refreshTitle = (): void => {
    installBtn.hidden = !(hooks?.install?.canInstall ?? false);
    aboutInstall.hidden = installBtn.hidden;
    iosNote.hidden = !(hooks?.iosHint?.() ?? false);
  };
  installBtn.addEventListener('click', () => void hooks?.install?.prompt());
  iosOk.addEventListener('click', () => {
    hooks?.onIosHintDismiss?.();
    iosNote.hidden = true;
    nav?.focusInitial(start);
  });
  start.append(logo, tag, startBtn, levelsBtn, titleRow, installBtn, iosNote, tip);
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
          if (mode === 'tilt') {
            if (await tryTilt()) await openWizard('SKIP');
            else tiltFailed = true;
          }
          saveSettings(s);
          void leave(ov);
          resolve();
        });
        card.append(b);
      }
      card.append(el('p', 'ui-note', 'You can change this later in Settings.'));
      ov.append(card);
      nav?.register(ov);
      root.appendChild(ov);
      void enter(ov);
      nav?.focusInitial(ov);
    });
  let tiltFailed = false;

  const choose = async (act: (() => void) | undefined): Promise<void> => {
    startBtn.disabled = true;
    levelsBtn.disabled = true;
    let hint = '';
    if (!started) {
      sound?.unlock();
      sound?.setScene('menu');
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
              ? 'Hold anywhere to steer · tap to launch'
              : 'Drag anywhere to move · tap to launch';
    }
    void leave(start);
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
  void enter(start);
  nav?.register(start);
  nav?.focusInitial(start);


  // ---- Tilt calibration wizard (modal; over whatever is open) ----
  const openWizard = async (skipLabel = 'SKIP'): Promise<boolean> => {
    wizardOpen = true;
    const r = await runTiltWizard(root, nav, controls.tilt, skipLabel);
    wizardOpen = false;
    controls.clearFire();
    controls.tilt.armNeutral();
    return r === 'saved';
  };

  // ---- Fullscreen controls (all hidden where the API does not exist, e.g. iPhone Safari) ----
  const fsOK = isFullscreenSupported();
  const fsItems: { btn: HTMLElement; kind: 'label' | 'icon' | 'tile' }[] = [];
  const fsButton = (btn: HTMLElement, kind: 'label' | 'icon' | 'tile'): void => {
    btn.addEventListener('click', () => void (isFullscreen() ? exitFullscreen() : enterFullscreen()));
    fsItems.push({ btn, kind });
    if (!fsOK) btn.hidden = true;
  };
  const syncFs = (): void => {
    const on = isFullscreen();
    for (const { btn, kind } of fsItems) {
      if (kind === 'label') btn.textContent = on ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
      else if (kind === 'tile') {
        btn.querySelector('.ic')!.innerHTML = on ? COLLAPSE_ICON_L : EXPAND_ICON_L;
        btn.querySelector('.lb')!.textContent = on ? 'EXIT FULL' : 'FULLSCREEN';
      } else {
        const hi = btn.querySelector('.hi');
        if (hi) hi.innerHTML = on ? COLLAPSE_ICON : EXPAND_ICON;
        else btn.innerHTML = on ? COLLAPSE_ICON : EXPAND_ICON;
      }
      btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
    }
  };
  onFullscreenChange(syncFs);
  fsButton(titleFs, 'icon');

  // ---- Pause overlay: RESUME on top, then a compact tile grid (2x2 portrait, 4x1 landscape); never scrolls ----
  const pauseOv = el('div', 'ui-overlay ui-pauseov');
  const pcard = el('div', 'ui-pausecard');
  const pTitle = el('h1', 'ui-h ui-ph', 'PAUSED');
  const resumeBtn = el('button', 'ui-btn big ui-resume', 'RESUME');
  resumeBtn.dataset.primary = '1';
  const pgrid = el('div', 'ui-pgrid');
  const tile = (label: string, icon: string): HTMLButtonElement => {
    const b = el('button', 'ui-ptile');
    const ic = el('span', 'ic');
    ic.innerHTML = icon;
    b.append(ic, el('span', 'lb', label));
    return b;
  };
  const pauseSettings = tile('SETTINGS', SETTINGS_ICON);
  pgrid.append(pauseSettings);
  if (hooks) {
    const pauseLevels = tile('LEVELS', LEVELS_ICON);
    pauseLevels.addEventListener('click', () => hooks.onPauseLevels());
    pgrid.append(pauseLevels);
  }
  if (fsOK) {
    const pauseFs = tile('FULLSCREEN', EXPAND_ICON_L);
    fsButton(pauseFs, 'tile');
    pgrid.append(pauseFs);
  }
  const quitBtn = tile('QUIT', HOME_ICON);
  quitBtn.classList.add('quit');
  pgrid.append(quitBtn);
  // One-step confirm, inside the same card.
  const confirmBox = el('div', 'ui-pconfirm');
  confirmBox.hidden = true;
  const cQ = el('h2', undefined, 'Quit to title?');
  const cSub = el('p', undefined, 'Progress in this level is lost.');
  const cBtns = el('div', 'ui-pconfirm-btns');
  const cCancel = el('button', 'ui-btn mid', 'CANCEL');
  cCancel.dataset.sfx = 'back';
  const cQuit = el('button', 'ui-btn mid danger', 'QUIT');
  cBtns.append(cCancel, cQuit);
  confirmBox.append(cQ, cSub, cBtns);
  pcard.append(pTitle, resumeBtn, pgrid, confirmBox);
  pauseOv.append(pcard);
  let confirming = false;
  const setConfirm = (on: boolean): void => {
    confirming = on;
    confirmBox.hidden = !on;
    pgrid.hidden = on;
    resumeBtn.hidden = on;
    pTitle.hidden = on;
    if (on) {
      cCancel.dataset.primary = '1';
      resumeBtn.removeAttribute('data-primary');
      nav?.focusInitial(pauseOv);
    } else {
      resumeBtn.dataset.primary = '1';
      cCancel.removeAttribute('data-primary');
    }
  };
  syncFs();
  /** Closes the pause menu. `resume` = the player chose to carry on (starts the countdown); `instant` skips the fade. */
  const hidePause = (resume = false, instant = false): void => {
    if (!pauseShown) return;
    pauseShown = false;
    setConfirm(false);
    void leave(pauseOv, instant);
    controls.clearFire();
    syncAudio();
    if (resume) hooks?.onResume?.();
  };
  const showPause = (): void => {
    if (pauseShown || settingsOpen || wizardOpen || !started || titleOpen || external) return;
    pauseShown = true;
    setConfirm(false);
    root.appendChild(pauseOv);
    void enter(pauseOv);
    nav?.focusInitial(pauseOv);
    syncAudio();
  };
  resumeBtn.addEventListener('click', () => hidePause(true));
  cCancel.addEventListener('click', () => {
    setConfirm(false);
    quitBtn.focus({ preventScroll: true });
  });
  cQuit.addEventListener('click', () => api.showTitle());
  quitBtn.addEventListener('click', () => setConfirm(true));
  nav?.register(pauseOv, () => {
    if (confirming) {
      setConfirm(false);
      quitBtn.focus({ preventScroll: true });
    } else hidePause(true);
  });

  // ---- HUD buttons: pause (far left of the band) and fullscreen (far right, collapses when unsupported) ----
  const hudBtn = (cls: string, icon: string, label: string): HTMLButtonElement => {
    const b = el('button', `ui-hud-btn ${cls}`);
    const hi = el('span', 'hi');
    hi.innerHTML = icon;
    b.append(hi);
    b.setAttribute('aria-label', label);
    return b;
  };
  const hudPause = hudBtn('ui-pause', PAUSE_ICON, 'Pause');
  hudPause.addEventListener('click', showPause);
  const hudFs = hudBtn('ui-fs', EXPAND_ICON, 'Fullscreen');
  fsButton(hudFs, 'icon');
  syncFs();
  root.prepend(hudFs, hudPause);
  const syncHud = (): void => {
    const show = started && !titleOpen && !external;
    hudPause.style.display = show ? '' : 'none';
    hudFs.style.display = show ? '' : 'none';
  };
  syncHud();
  const placeHud = (b: HTMLElement, c: { x: number; y: number }, touch: number): void => {
    b.style.width = b.style.height = `${touch}px`;
    b.style.left = `${c.x - touch / 2}px`;
    b.style.top = `${c.y - touch / 2}px`;
  };

  // ---- Settings panel: sticky header with tabs, scrolling body, sticky DONE footer ----
  const panelOv = el('div', 'ui-overlay ui-settingsov');
  const panel = el('div', 'ui-panel ui-settings');
  const head = el('div', 'ui-panel-head');
  head.append(el('h2', undefined, 'SETTINGS'));
  const tabsEl = el('div', 'ui-tabs');
  tabsEl.setAttribute('role', 'tablist');
  const TABS = ['CONTROLS', 'SOUND', 'GRAPHICS', 'ABOUT'] as const;
  const tabBtns = TABS.map((t) => {
    const b = el('button', 'ui-tab', t);
    b.setAttribute('role', 'tab');
    return b;
  });
  tabsEl.append(...tabBtns);
  head.append(tabsEl);
  const wrap = el('div', 'ui-panel-bodywrap');
  const body = el('div', 'ui-panel-body');
  const fade = el('div', 'ui-scrollfade', '▾ SCROLL');
  fade.setAttribute('aria-hidden', 'true');
  wrap.append(body, fade);
  const foot = el('div', 'ui-panel-foot');
  const closeBtn = el('button', 'ui-btn', 'DONE');
  closeBtn.dataset.sfx = 'back';
  foot.append(closeBtn);
  panel.append(head, wrap, foot);
  panelOv.append(panel);
  const panes = TABS.map(() => el('div', 'ui-pane'));
  body.append(...panes);

  const updateFade = (): void => {
    wrap.classList.toggle('more', body.scrollHeight - body.scrollTop - body.clientHeight > 6);
  };
  body.addEventListener('scroll', updateFade, { passive: true });
  window.addEventListener('resize', updateFade);
  let tabNow = 0;
  const setTab = (i: number): void => {
    tabNow = i;
    panes.forEach((p, k) => (p.hidden = k !== i));
    tabBtns.forEach((b, k) => {
      b.classList.toggle('on', k === i);
      b.setAttribute('aria-selected', String(k === i));
    });
    body.scrollTop = 0;
    updateFade();
  };
  tabBtns.forEach((b, i) => b.addEventListener('click', () => setTab(i)));

  const modeRow = el('div', 'ui-row');
  modeRow.append(el('span', undefined, 'Control mode'));
  const seg = el('div', 'ui-seg');
  const tiltBtn = el('button', 'ui-btn', 'TILT');
  const dragBtn = el('button', 'ui-btn', 'DRAG');
  const stickBtn = el('button', 'ui-btn', 'STICK');
  seg.append(tiltBtn, dragBtn, stickBtn);
  modeRow.append(seg);
  const msg = el('div', 'ui-msg');
  const say = (text: string, ok = false): void => {
    msg.textContent = text;
    msg.classList.toggle('ok', ok);
  };

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

  // Controls tab
  const tiltBox = el('div', 'ui-row ui-tiltbox');
  const tiltStatus = el('span', 'ui-tiltstatus');
  const calRow = el('div', 'ui-seg');
  const calBtn = el('button', 'ui-btn', 'CALIBRATE TILT');
  const autoBtn = el('button', 'ui-btn', 'USE AUTO');
  calRow.append(calBtn, autoBtn);
  tiltBox.append(tiltStatus, calRow);
  const tiltSens = slider('Tilt sensitivity', 1, 10, 0.5, () => s.tiltSensitivity, (v) => (s.tiltSensitivity = v));
  const invertRow = toggle('Invert tilt', () => s.invertTilt, (v) => (s.invertTilt = v));
  const dragSens = slider('Drag sensitivity', 0.5, 3, 0.1, () => s.dragSensitivity, (v) => (s.dragSensitivity = v));
  const stickSpeed = slider('Stick speed', 0.6, 1.6, 0.05, () => s.stickSpeed, (v) => (s.stickSpeed = v));
  panes[0].append(modeRow, tiltBox, tiltSens.row, invertRow, dragSens.row, stickSpeed.row, msg);

  // Sound tab
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
  const volume = slider('Volume', 0, 1, 0.05, () => s.volume, (v) => {
    s.volume = v;
    sound?.setVolume(v);
  });
  volume.input.disabled = s.muted;
  volume.input.addEventListener('change', () => sound?.play('powerup'));
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
  panes[1].append(soundRow, volume.row, musicRow, musicVol.row);

  // Graphics tab
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
  const shakeRow = toggle('Screen shake', () => s.shake, (v) => (s.shake = v));
  const motionRow = toggle('Reduce motion (menus, title demo, shake)', () => s.reduceMotion, (v) => (s.reduceMotion = v));
  const fxRow = toggle('Fewer effects (particles, flashes)', () => s.reducedFx, (v) => (s.reducedFx = v));
  const hapticsRow = toggle('Vibration', () => s.haptics, (v) => (s.haptics = v));
  panes[2].append(gfxRow, motionRow, shakeRow, fxRow, hapticsRow);

  // About tab
  const about = panes[3];
  about.classList.add('ui-about');
  const aboutHead = el('div', 'ui-about-head');
  aboutHead.append(el('b', undefined, 'SHATTER'), el('span', undefined, versionString()));
  const credits = el('p', 'ui-about-p', 'Design & development: Harsha Nimmagadda, with Claude.');
  const gen = el('p', 'ui-about-p', 'All art and sound are generated in code.');
  const tipsRow = toggle('In-game tips', () => s.tips, (v) => (s.tips = v));
  const aboutInstall = el('div', 'ui-row');
  aboutInstall.hidden = true;
  const aboutInstallBtn = el('button', 'ui-btn', 'INSTALL APP');
  aboutInstallBtn.addEventListener('click', () => void hooks?.install?.prompt());
  aboutInstall.append(el('span', undefined, 'Play fullscreen from your Home Screen'), aboutInstallBtn);
  // Capsule key: each category has its own colour AND shape.
  const key = el('div', 'ui-capkey');
  key.append(el('span', 'ui-capkey-t', 'Power-up badges'));
  const shapes: [string, string, string][] = [
    ['BALL', CATEGORY_COLORS.ball, '<circle cx="16" cy="16" r="12"/>'],
    ['PADDLE', CATEGORY_COLORS.paddle, '<rect x="5" y="5" width="22" height="22" rx="7"/>'],
    ['UTILITY', CATEGORY_COLORS.utility, '<path d="M16 3.5 27 9.8v12.4L16 28.5 5 22.2V9.8z"/>'],
    ['HAZARD', CATEGORY_COLORS.hazard, '<path d="M16 2 19 9.5 26.5 6 23.5 13.5 31 16 23.5 18.5 26.5 26 19 22.5 16 30 13 22.5 5.5 26 8.5 18.5 1 16 8.5 13.5 5.5 6 13 9.5z"/>'],
  ];
  for (const [name, col, inner] of shapes) {
    const it = el('span', 'ui-capkey-i');
    it.style.color = col;
    const ic = el('span');
    ic.innerHTML = `<svg viewBox="0 0 32 32" width="34" height="34" fill="rgba(0,0,0,0.45)" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
    it.append(ic, el('em', undefined, name));
    key.append(it);
  }
  // Two-step reset: RESET PROGRESS opens an inline confirm; ERASE does it.
  const resetRow = el('div', 'ui-row ui-reset');
  const resetBtn = el('button', 'ui-btn danger', 'RESET PROGRESS');
  const resetBox = el('div', 'ui-resetbox');
  resetBox.hidden = true;
  const resetBtns = el('div', 'ui-pconfirm-btns');
  const resetNo = el('button', 'ui-btn mid', 'CANCEL');
  resetNo.dataset.sfx = 'back';
  const resetYes = el('button', 'ui-btn mid danger', 'ERASE');
  resetBtns.append(resetNo, resetYes);
  resetBox.append(el('p', undefined, 'Erase all stars, best scores, your saved run and first-time tips? Settings are kept. This cannot be undone.'), resetBtns);
  const resetMsg = el('div', 'ui-msg');
  let resetTimer = 0;
  const setResetConfirm = (on: boolean): void => {
    window.clearTimeout(resetTimer);
    resetBtn.hidden = on;
    resetBox.hidden = !on;
    if (on) {
      resetTimer = window.setTimeout(() => setResetConfirm(false), 8000);
      resetNo.dataset.primary = '1';
      nav?.focusInitial(panelOv);
    }
    updateFade();
  };
  resetBtn.addEventListener('click', () => {
    resetMsg.textContent = '';
    setResetConfirm(true);
    resetBox.scrollIntoView?.({ block: 'nearest' });
  });
  resetNo.addEventListener('click', () => {
    setResetConfirm(false);
    resetBtn.focus({ preventScroll: true });
  });
  resetYes.addEventListener('click', () => {
    setResetConfirm(false);
    hooks?.onResetProgress?.();
    resetMsg.textContent = 'Progress reset.';
    resetMsg.classList.add('ok');
    resetBtn.focus({ preventScroll: true });
  });
  resetRow.append(resetBtn);
  about.append(aboutHead, credits, gen, key, tipsRow, aboutInstall, resetRow, resetBox, resetMsg);
  hooks?.install?.onChange(refreshTitle);
  refreshTitle();

  const refresh = (): void => {
    tiltBtn.classList.toggle('on', s.mode === 'tilt');
    dragBtn.classList.toggle('on', s.mode === 'drag');
    stickBtn.classList.toggle('on', s.mode === 'stick');
    const tilt = s.mode === 'tilt';
    for (const r of [tiltBox, tiltSens.row, invertRow]) r.style.display = tilt ? '' : 'none';
    dragSens.row.style.display = s.mode === 'drag' ? '' : 'none';
    stickSpeed.row.style.display = s.mode === 'stick' ? '' : 'none';
    const c = s.tiltCal;
    tiltStatus.textContent = c ? `Calibrated · left ${Math.round(c.left)}° · right ${Math.round(c.right)}°` : 'Automatic · follows your screen orientation';
    autoBtn.hidden = !c;
    updateFade();
  };

  dragBtn.addEventListener('click', () => {
    s.mode = 'drag';
    say('');
    saveSettings(s);
    refresh();
  });
  stickBtn.addEventListener('click', () => {
    s.mode = 'stick';
    say('');
    saveSettings(s);
    refresh();
  });
  tiltBtn.addEventListener('click', async () => {
    // enable() runs directly from this click (needed for the iOS permission prompt).
    const r = await controls.tilt.enable();
    if (r === 'granted') {
      s.mode = 'tilt';
      say(s.tiltCal ? '' : 'Tip: calibrate tilt for the best feel.', true);
    } else {
      s.mode = 'drag';
      say('Tilt not available here, using drag.');
    }
    saveSettings(s);
    refresh();
  });
  calBtn.addEventListener('click', async () => {
    // Permission requests must start inside this tap; skip when tilt is already running.
    if (!controls.tilt.active) {
      const r = await controls.tilt.enable();
      if (r !== 'granted') {
        say(r === 'denied' ? 'Motion access was denied. Allow it in your browser settings.' : 'Tilt not available here.');
        updateFade();
        return;
      }
    }
    say('');
    const saved = await openWizard('CANCEL');
    say(saved ? 'Tilt calibrated.' : '', true);
    refresh();
    calBtn.focus({ preventScroll: true });
  });
  autoBtn.addEventListener('click', () => {
    controls.tilt.setCalibration(null);
    controls.tilt.armNeutral();
    say('Using automatic tilt.', true);
    refresh();
  });

  const openSettings = (): void => {
    if (settingsOpen) return;
    // From the pause overlay: hide it but keep the game paused (audio stays suspended); closing returns to it.
    if (pauseShown) void leave(pauseOv);
    settingsOpen = true;
    say('');
    setResetConfirm(false);
    resetMsg.textContent = '';
    refresh();
    refreshTitle();
    root.appendChild(panelOv);
    void enter(panelOv);
    setTab(tabNow);
    nav?.focusInitial(panelOv);
  };
  const closeSettings = (): void => {
    if (!settingsOpen) return;
    settingsOpen = false;
    void leave(panelOv);
    controls.clearFire();
    if (pauseShown) {
      root.appendChild(pauseOv);
      void enter(pauseOv);
      nav?.focusInitial(pauseOv);
    } else if (titleOpen) nav?.focusInitial(start);
  };
  nav?.register(panelOv, closeSettings);
  pauseSettings.addEventListener('click', openSettings);
  settingsBtn.addEventListener('click', openSettings);
  closeBtn.addEventListener('click', closeSettings);

  // ---- Toast: the saved tilt calibration may not fit after the screen rotates ----
  let toast: HTMLElement | null = null;
  let toastTimer = 0;
  const hideToast = (): void => {
    window.clearTimeout(toastTimer);
    toast?.remove();
    toast = null;
  };
  const showToast = (text: string, action: string, onAction: () => void): void => {
    hideToast();
    const t = el('div', 'ui-toast');
    const b = el('button', 'ui-btn small', action);
    b.addEventListener('click', () => {
      hideToast();
      onAction();
    });
    t.append(el('span', undefined, text), b);
    root.appendChild(t);
    toast = t;
    toastTimer = window.setTimeout(hideToast, 9000);
  };
  controls.tilt.onOrientationChange = () => {
    if (!started || titleOpen || external || s.mode !== 'tilt' || !s.tiltCal) return;
    showToast('Orientation changed — recalibrate tilt?', 'RECALIBRATE', () => {
      showPause();
      void openWizard('CANCEL').then(() => {
        if (pauseShown) nav?.focusInitial(pauseOv);
      });
    });
  };

  // ---- Auto pause on focus loss ----
  const onLost = (): void => showPause();
  window.addEventListener('blur', onLost);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') showPause();
    syncAudio();
  });

  const api: ControlsUi = {
    started: () => started,
    paused: () => settingsOpen || pauseShown || wizardOpen || titleOpen || external,
    togglePause: () => {
      if (!started || settingsOpen || wizardOpen || titleOpen || external) return;
      if (pauseShown) hidePause(true);
      else showPause();
    },
    autoPause: showPause,
    titleShown: () => titleOpen,
    showTitle: () => {
      if (titleOpen) return;
      hidePause(false, true);
      hideToast();
      refreshTitle();
      titleOpen = true;
      syncHud();
      root.appendChild(start);
      void enter(start);
      nav?.focusInitial(start);
    },
    closePause: () => hidePause(false, true),
    setExternalModal: (open) => {
      if (open === external) return;
      external = open;
      syncHud();
    },
    refreshTitle,
    layoutHud: (l) => {
      root.style.setProperty('--hud-v', `${l.v}px`);
      placeHud(hudPause, l.pause, l.touch);
      if (l.fs) placeHud(hudFs, l.fs, l.touch);
    },
  };
  return api;
}
