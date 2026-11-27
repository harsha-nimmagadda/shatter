import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POWER_TYPES } from '../src/engine';
import { computeHudLayout, computeSideLayout, type SafeInsets } from '../src/game/hud';
import { installButtonVisible, iosHintEligible, isIosSafari } from '../src/game/install';
import { RESET_KEYS, resetProgressData } from '../src/game/reset';
import { BRICK_CALLOUT, SLOWMO, Taught, parseTaught, pendingBrickCallouts, slowMoScale, teachingAllowed } from '../src/game/teaching';
import { formatVersion } from '../src/game/version';
import { CONTROLS_KEY, defaultSettings, parseSettings } from '../src/input/settings';
import { POWER_EFFECTS, POWER_NAMES, capsuleShape } from '../src/render/powerVisuals';
import { fitPlayfield } from '../src/game/view';
import { precacheList } from '../tools/swPlugin';
import { STARTUP, startupName } from '../tools/genIcons.mjs';

const NO_SAFE: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const hud = (w: number, h: number, safe = NO_SAFE) => {
  const f = fitPlayfield(w, h);
  return computeHudLayout({ cssW: w, cssH: h, scale: f.scale, offsetX: f.offsetX, offsetY: f.offsetY, safe, fullscreenSupported: true });
};

describe('install hint and button', () => {
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  it('detects iOS Safari only', () => {
    expect(isIosSafari(safari, 'iPhone', 5)).toBe(true);
    expect(isIosSafari(safari.replace('Version/17.0', 'CriOS/120'), 'iPhone', 5)).toBe(false);
    expect(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Version/17 Safari/605', 'MacIntel', 5)).toBe(true); // iPadOS
    expect(isIosSafari('Mozilla/5.0 (Macintosh) Version/17 Safari/605', 'MacIntel', 0)).toBe(false);
    expect(isIosSafari('Mozilla/5.0 (Linux; Android 14) Chrome/120', 'Linux armv8l', 5)).toBe(false);
  });
  it('shows the hint once, after the first completed level, never installed', () => {
    const base = { iosSafari: true, standalone: false, dismissed: false, completedLevel: true };
    expect(iosHintEligible(base)).toBe(true);
    expect(iosHintEligible({ ...base, completedLevel: false })).toBe(false);
    expect(iosHintEligible({ ...base, dismissed: true })).toBe(false);
    expect(iosHintEligible({ ...base, standalone: true })).toBe(false);
    expect(iosHintEligible({ ...base, iosSafari: false })).toBe(false);
  });
  it('install button needs a captured prompt and hides when installed or standalone', () => {
    expect(installButtonVisible({ standalone: false, installed: false, promptAvailable: true })).toBe(true);
    expect(installButtonVisible({ standalone: false, installed: false, promptAvailable: false })).toBe(false);
    expect(installButtonVisible({ standalone: false, installed: true, promptAvailable: true })).toBe(false);
    expect(installButtonVisible({ standalone: true, installed: false, promptAvailable: true })).toBe(false);
  });
});

describe('teaching flags', () => {
  it('stays quiet in the first second and when tips are off', () => {
    expect(teachingAllowed(true, 500)).toBe(false);
    expect(teachingAllowed(true, 1000)).toBe(true);
    expect(teachingAllowed(false, 5000)).toBe(false);
  });
  it('queues untaught special bricks in a fixed order, capped', () => {
    expect(pendingBrickCallouts(['normal', 'explosive', 'steel'], new Set())).toEqual(['steel', 'explosive']);
    expect(pendingBrickCallouts(['normal', 'explosive'], new Set(['brick:explosive']))).toEqual([]);
    expect(pendingBrickCallouts(['steel', 'explosive', 'moving'], new Set(), 1)).toEqual(['steel']);
    for (const t of ['steel', 'explosive', 'moving', 'regen', 'hidden']) expect(BRICK_CALLOUT[t]).toMatch(/^NEW: /);
  });
  it('persists flags once and tolerates garbage', () => {
    let store: string | null = null;
    let writes = 0;
    const t = new Taught(() => store, (s) => ((store = s), writes++));
    expect(t.has('hazard')).toBe(false);
    t.mark('hazard');
    t.mark('hazard');
    expect(writes).toBe(1);
    expect(new Taught(() => store, () => undefined).has('hazard')).toBe(true);
    expect(parseTaught('{oops').size).toBe(0);
    expect(parseTaught('[1,"a"]')).toEqual(new Set(['a']));
  });
  it('slow-motion is 0.3x only while time is left', () => {
    expect(slowMoScale(SLOWMO.seconds)).toBe(0.3);
    expect(slowMoScale(0)).toBe(1);
  });
  it('every power-up has a name and a short effect line', () => {
    for (const t of POWER_TYPES) {
      expect(POWER_NAMES[t]).toBeTruthy();
      expect(POWER_EFFECTS[t].split(/\s+/).length).toBeLessThanOrEqual(5);
    }
  });
});

describe('capsule shapes', () => {
  it('give each category its own shape', () => {
    const shapes = new Set(POWER_TYPES.map(capsuleShape));
    expect(shapes).toEqual(new Set(['circle', 'square', 'hexagon', 'saw']));
    expect(capsuleShape('scissors')).toBe('saw');
    expect(capsuleShape('photocopy')).toBe('circle');
    expect(capsuleShape('ruler')).toBe('square');
    expect(capsuleShape('goldstar')).toBe('hexagon');
  });
});

describe('side panel layout', () => {
  it('is used when both bars are at least 160 css px, with the checked sizes', () => {
    expect(hud(1024, 768).side).not.toBeNull();
    expect(hud(1366, 1024).side).not.toBeNull();
    expect(hud(844, 390).side).not.toBeNull();
  });
  it('falls back to the top band on phones and portrait iPads', () => {
    expect(hud(360, 640).side).toBeNull();
    expect(hud(390, 844).side).toBeNull();
    expect(hud(768, 1024).side).toBeNull();
  });
  it('respects safe-area insets and the threshold edge', () => {
    // 844x390: bars are 312 px; a 160 px notch inset on one side leaves 152 < 160.
    expect(hud(844, 390, { top: 0, right: 0, bottom: 0, left: 160 }).side).toBeNull();
    const f = fitPlayfield(1024, 768);
    expect(computeSideLayout({ cssH: 768, scale: f.scale, offsetX: 159, safe: NO_SAFE })).toBeNull();
    expect(computeSideLayout({ cssH: 768, scale: f.scale, offsetX: 160, safe: NO_SAFE })).not.toBeNull();
  });
  it('panels are outside the playfield and content scale fits the screen', () => {
    const l = hud(844, 390);
    const s = l.side!;
    expect(s.left.x1).toBe(0);
    expect(s.right.x0).toBe(540);
    expect(s.left.x0).toBeLessThan(0);
    const f = fitPlayfield(844, 390);
    expect(s.k * f.scale * 330).toBeLessThanOrEqual(390 - 50);
  });
});

describe('version string', () => {
  it('formats version and commit', () => {
    expect(formatVersion('0.1.0', 'abc1234')).toBe('v0.1.0 · abc1234');
    expect(formatVersion('0.1.0', '')).toBe('v0.1.0');
    expect(formatVersion('', '')).toBe('v0.0.0');
  });
});

describe('reset progress', () => {
  it('clears progress, run and first-run flags but never settings', () => {
    const removed: string[] = [];
    resetProgressData((k) => removed.push(k));
    expect(removed).toEqual([...RESET_KEYS]);
    expect(removed).toContain('shatter.progress.v1');
    expect(removed).toContain('shatter.run.v1');
    expect(removed).toContain('shatter.seen.v1');
    expect(removed).toContain('shatter.taught.v1');
    expect(removed).not.toContain(CONTROLS_KEY);
  });
});

describe('reduce motion default', () => {
  it('follows the OS preference when nothing is saved, and the saved value otherwise', () => {
    expect(defaultSettings(true).reduceMotion).toBe(false);
    expect(parseSettings(null, true, true).reduceMotion).toBe(true);
    expect(parseSettings('{}', true, true).reduceMotion).toBe(true);
    expect(parseSettings('{"reduceMotion":false}', true, true).reduceMotion).toBe(false);
    expect(parseSettings('{"tips":false}', true).tips).toBe(false);
  });
});

describe('app shell files', () => {
  const html = readFileSync('index.html', 'utf8');
  it('references an existing startup image for every size, with matching media queries', () => {
    for (const [w, h, r] of STARTUP) {
      const f = startupName(w, h, r);
      expect(existsSync(`public/${f}`)).toBe(true);
      expect(html).toContain(`href="./${f}"`);
      expect(html).toContain(`(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r})`);
    }
  });
  it('paints a boot splash and background inline', () => {
    expect(html).toContain('id="boot"');
    expect(html).toMatch(/<html[^>]*background:#05010f/);
  });
  it('manifest has id, maskable icon, fullscreen portrait, games category', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(m.id).toBeTruthy();
    expect(m.display).toBe('fullscreen');
    expect(m.orientation).toBe('portrait');
    expect(m.categories).toEqual(['games']);
    expect(m.description).toBeTruthy();
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) expect(existsSync(`public/${i.src}`)).toBe(true);
  });
  it('precache keeps icons but skips the iOS startup images', () => {
    const list = precacheList(['index.html', 'icon-192.png', 'maskable-512.png', 'apple-touch-icon.png', 'splash/apple-splash-640x1136.png']);
    expect(list).toContain('./maskable-512.png');
    expect(list).toContain('./icon-192.png');
    expect(list.some((u) => u.includes('splash/'))).toBe(false);
  });
});
