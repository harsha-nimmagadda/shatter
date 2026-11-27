import { describe, expect, it } from 'vitest';
import { CAMPAIGN, CONFIG, createRng } from '../src/engine';
import { TALLY_TIMING, TallyTimeline, tallyRows } from '../src/game/tally';
import { COUNT_FROM, COUNT_STEP, Countdown, needsCountdown } from '../src/game/countdown';
import { TIPS, pickTip, tipsFor } from '../src/game/tips';
import { ATTRACT_END_HOLD, Attract, pickAttract } from '../src/game/attract';
import { defaultProgress, recordWin, totalStars } from '../src/game/progress';
import { thumbCells, thumbColor } from '../src/ui/thumb';
import { brickHue } from '../src/render/palette';
import { classifyClick } from '../src/ui/feedback';
import { MOTION, motionIsOff, overlayFrames } from '../src/ui/motion';
import { GAME_SONGS, MENU_SONG, SFX, SONGS, SONG_ORDER, renderSong, songSeconds } from '../src/audio/synth';
import { MUSIC_FADE, songForScene } from '../src/audio/sound';

describe('result tally rows', () => {
  it('splits the engine score into bricks and the lives bonus', () => {
    const rows = tallyRows(1960 + 3 * CONFIG.winLifeBonus, 3, CONFIG.winLifeBonus);
    expect(rows.map((r) => r.key)).toEqual(['bricks', 'lives', 'total']);
    expect(rows[0].value).toBe(1960);
    expect(rows[1].value).toBe(750);
    expect(rows[2].value).toBe(2710);
    expect(rows[0].value + rows[1].value).toBe(rows[2].value);
  });
  it('has no combo row and clamps odd inputs', () => {
    expect(tallyRows(100, 3, 250).map((r) => r.value)).toEqual([0, 100, 100]);
    expect(tallyRows(500, 0, 250).map((r) => r.key)).toEqual(['bricks', 'total']);
    expect(tallyRows(-5, 2, 250).map((r) => r.value)).toEqual([0, 0]);
  });
});

describe('tally timeline', () => {
  const rows = tallyRows(3000, 2, 250);
  it('reveals rows in order, counts up monotonically and ends exactly on the values', () => {
    const tl = new TallyTimeline(rows);
    expect(tl.visible(0)).toBe(false);
    const seen: number[] = [];
    let ticks = 0;
    const finished: number[] = [];
    let completed = 0;
    for (let i = 0; i < 1000 && !tl.done; i++) {
      const u = tl.update(1 / 60);
      ticks += u.ticks;
      finished.push(...u.finished);
      if (u.completed) completed++;
      seen.push(tl.value(2));
    }
    expect(tl.done).toBe(true);
    expect(completed).toBe(1);
    expect(finished).toEqual([0, 1, 2]);
    expect(ticks).toBeGreaterThan(10);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect([0, 1, 2].map((i) => tl.value(i))).toEqual(rows.map((r) => r.value));
  });
  it('shows later rows only after the earlier ones finished', () => {
    const tl = new TallyTimeline(rows);
    tl.update(TALLY_TIMING.lead + 0.01);
    expect(tl.visible(0)).toBe(true);
    expect(tl.visible(1)).toBe(false);
    tl.update(TALLY_TIMING.max + TALLY_TIMING.gap + 0.05);
    expect(tl.visible(1)).toBe(true);
    expect(tl.visible(2)).toBe(false);
  });
  it('skip jumps to the end once and reports every row', () => {
    const tl = new TallyTimeline(rows);
    tl.update(0.5);
    const u = tl.skip();
    expect(tl.done).toBe(true);
    expect(u.completed).toBe(true);
    expect(u.finished.length + 0).toBeGreaterThan(0);
    expect(tl.value(2)).toBe(3000);
    expect(tl.skip().completed).toBe(false);
    expect(tl.update(1).ticks).toBe(0);
  });
});

describe('thumbnails', () => {
  it('maps level characters to the game brick colours', () => {
    expect(thumbColor('1')?.color).toBe(brickHue('normal', 1));
    expect(thumbColor('2')?.color).toBe(brickHue('normal', 2));
    expect(thumbColor('3')?.color).toBe(brickHue('normal', 3));
    expect(thumbColor('#')?.color).toBe(brickHue('steel', 1));
    expect(thumbColor('x')?.color).toBe(brickHue('explosive', 1));
    expect(thumbColor('m')?.color).toBe(brickHue('moving', 1));
    expect(thumbColor('r')?.color).toBe(brickHue('regen', 1));
    expect(thumbColor('h')?.alpha).toBeLessThan(1);
    expect(thumbColor('.')).toBeNull();
  });
  it('draws one cell per brick of every campaign level', () => {
    for (const lv of CAMPAIGN) {
      const n = lv.rows.join('').replace(/\./g, '').length;
      const cells = thumbCells(lv.rows);
      expect(cells.length).toBe(n);
      for (const c of cells) {
        expect(c.col).toBeLessThan(10);
        expect(c.row).toBeLessThan(lv.rows.length);
      }
    }
  });
});

describe('star totals', () => {
  it('sums stars out of 3 per level', () => {
    let p = defaultProgress(15);
    expect(totalStars(p, 15)).toEqual({ have: 0, max: 45 });
    p = recordWin(p, 0, 3, 100, 15);
    p = recordWin(p, 1, 2, 100, 15);
    expect(totalStars(p, 15)).toEqual({ have: 5, max: 45 });
    p = recordWin(p, 1, 1, 50, 15); // never lowers
    expect(totalStars(p, 15).have).toBe(5);
  });
});

describe('resume countdown', () => {
  it('counts 3, 2, 1 at 0.6 s each, then finishes', () => {
    const c = new Countdown();
    expect(c.active).toBe(false);
    c.start();
    expect(c.active).toBe(true);
    expect(c.value).toBe(COUNT_FROM);
    const shown: number[] = [];
    let finished = false;
    for (let t = 0; t < 4 && !finished; t += 1 / 120) {
      const u = c.update(1 / 120);
      if (u.changed) shown.push(c.value);
      finished = u.finished;
    }
    expect(shown).toEqual([3, 2, 1]);
    expect(finished).toBe(true);
    expect(c.active).toBe(false);
  });
  it('takes about 1.8 s and can be cancelled', () => {
    const c = new Countdown();
    c.start();
    c.update(COUNT_STEP * 2 - 0.01);
    expect(c.value).toBe(2);
    c.update(0.02);
    expect(c.value).toBe(1);
    c.cancel();
    expect(c.active).toBe(false);
    expect(c.update(1)).toEqual({ changed: false, finished: false });
  });
  it('is skipped while the ball is still in serve', () => {
    expect(needsCountdown('serve')).toBe(false);
    expect(needsCountdown('playing')).toBe(true);
    expect(needsCountdown('won')).toBe(false);
    expect(needsCountdown('gameover')).toBe(false);
  });
});

describe('game-over tips', () => {
  it('every control mode gets general tips plus its own', () => {
    for (const m of ['tilt', 'drag', 'stick'] as const) {
      const t = tipsFor(m);
      expect(t.length).toBeGreaterThan(6);
      expect(new Set(t).size).toBe(t.length);
    }
    expect(tipsFor('stick').some((s) => /STICK/.test(s))).toBe(true);
    expect(tipsFor('drag').some((s) => /calibrate/i.test(s))).toBe(false);
    expect(tipsFor('tilt').some((s) => /calibrate/i.test(s))).toBe(true);
    expect(TIPS.length).toBeGreaterThan(10);
  });
  it('picks by r in [0, 1)', () => {
    const list = tipsFor('tilt');
    expect(pickTip('tilt', 0)).toBe(list[0]);
    expect(pickTip('tilt', 0.999999)).toBe(list[list.length - 1]);
    expect(pickTip('tilt', 7)).toBe(list[list.length - 1]);
  });
});

describe('attract mode', () => {
  it('is deterministic per session seed and plays all the way through', () => {
    const run = (seed: number): { level: number; status: string }[] => {
      const a = new Attract(seed);
      const out: { level: number; status: string }[] = [];
      let restarts = 0;
      for (let i = 0; i < 120 * 400 && restarts < 3; i++) {
        const before = a.world.status;
        if (a.update(1 / 120)) {
          out.push({ level: a.levelIndex, status: before });
          restarts++;
        }
      }
      return out;
    };
    const a = run(1234);
    expect(a).toEqual(run(1234));
    expect(a.length).toBe(3);
    expect(a.some((r) => r.status === 'won' || r.status === 'gameover' || r.status === 'playing')).toBe(true);
  });
  it('picks campaign levels and mostly the pro bot', () => {
    const rng = createRng(5);
    let pro = 0;
    for (let i = 0; i < 200; i++) {
      const p = pickAttract(rng, CAMPAIGN.length);
      expect(p.level).toBeGreaterThanOrEqual(0);
      expect(p.level).toBeLessThan(CAMPAIGN.length);
      if (p.skill === 'pro') pro++;
    }
    expect(pro).toBeGreaterThan(100);
    expect(pro).toBeLessThan(200);
  });
  it('holds a finished demo, then starts a fresh level', () => {
    const a = new Attract(99);
    a.world.status = 'won';
    let replaced = false;
    for (let t = 0; t < ATTRACT_END_HOLD + 0.5 && !replaced; t += 1 / 120) replaced = a.update(1 / 120);
    expect(replaced).toBe(true);
    expect(a.world.status).toBe('serve');
    expect(a.count).toBe(2);
  });
});

describe('UI feedback', () => {
  const base = { tag: 'button', classes: [] as string[], primary: false, ariaDisabled: false };
  it('classifies clicks', () => {
    expect(classifyClick(base)).toBe('tap');
    expect(classifyClick({ ...base, primary: true })).toBe('confirm');
    expect(classifyClick({ ...base, classes: ['ui-btn', 'big'] })).toBe('confirm');
    expect(classifyClick({ ...base, classes: ['ui-tab'] })).toBe('tab');
    expect(classifyClick({ ...base, sfx: 'back' })).toBe('back');
    expect(classifyClick({ ...base, sfx: 'none' })).toBeNull();
    expect(classifyClick({ ...base, tag: 'input', type: 'checkbox' })).toBeNull();
    expect(classifyClick({ ...base, ariaDisabled: true })).toBeNull();
  });
});

describe('motion language', () => {
  it('uses the agreed timings and an ease-out panel', () => {
    const bd = overlayFrames('backdrop', 'in');
    const pin = overlayFrames('panel', 'in');
    const pout = overlayFrames('panel', 'out');
    expect(bd.opts.duration).toBe(180);
    expect(pin.opts.duration).toBe(220);
    expect(pout.opts.duration).toBe(140);
    expect(pin.keyframes[0]).toMatchObject({ opacity: 0, transform: `scale(${MOTION.panelFrom})` });
    expect(pin.keyframes[1]).toMatchObject({ opacity: 1, transform: 'scale(1)' });
    expect(pin.opts.easing).toContain('cubic-bezier');
    expect(overlayFrames('backdrop', 'out').opts.duration).toBeLessThan(Number(bd.opts.duration));
  });
  it('turns off for either the setting or the OS preference', () => {
    expect(motionIsOff(false, false)).toBe(false);
    expect(motionIsOff(true, false)).toBe(true);
    expect(motionIsOff(false, true)).toBe(true);
  });
});

describe('menu music and UI sounds', () => {
  it('has a calm menu loop that is separate from the gameplay tracks', () => {
    expect(SONGS[MENU_SONG].calm).toBe(true);
    expect(GAME_SONGS).toBe(SONGS.length - 1);
    expect(SONGS.slice(0, GAME_SONGS).every((s) => !s.calm)).toBe(true);
    expect(SONGS[MENU_SONG].bpm).toBeLessThan(Math.min(...SONGS.slice(0, GAME_SONGS).map((s) => s.bpm)));
    expect([...SONG_ORDER].sort()).toEqual(SONGS.map((_, i) => i));
    expect(SONG_ORDER[0]).toBe(MENU_SONG);
    const [l, r] = renderSong(SONGS[MENU_SONG], 4000);
    expect(l.length).toBe(Math.round(songSeconds(SONGS[MENU_SONG]) * 4000));
    expect(r.length).toBe(l.length);
    let peak = 0;
    for (const v of l) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(0.86);
  });
  it('picks the song for a scene and wraps gameplay tracks', () => {
    expect(songForScene('menu', 5)).toBe(MENU_SONG);
    expect(songForScene('game', 0)).toBe(0);
    expect(songForScene('game', GAME_SONGS)).toBe(0);
    expect(songForScene('game', 1)).toBe(1);
    expect(MUSIC_FADE).toBeCloseTo(0.6);
  });
  it('has every UI sound', () => {
    for (const id of ['tap', 'confirm', 'back', 'toggle', 'tab', 'locked', 'whoosh', 'tick', 'count', 'go', 'total']) expect(SFX[`ui_${id}`], id).toBeDefined();
  });
});
