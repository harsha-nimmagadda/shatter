# Shatter — Development Plan

A brick-breaker in the spirit of DX-Ball with an animated, hand-drawn look. Mobile phones first (portrait,
tilt to steer), built so PC and consoles can be added later. Reuses the stack and several modules from
[TriLine](https://github.com/harsha-nimmagadda/TriLine).

## Decisions (from Q&A)

| Topic | Decision |
|---|---|
| Tech | Vite + TypeScript + HTML Canvas 2D, no game framework (same stack as TriLine) |
| First release | Web / installable PWA on GitHub Pages |
| Later platforms | Android/iOS via Capacitor, PC via Tauri (Steam), consoles via gamepad support + a port later |
| Controls (phone) | Tilt by default (calibrate + sensitivity slider); relative drag as a settings option and automatic fallback |
| Controls (other) | Mouse, keyboard, Gamepad API from day one (cheap now, needed for PC/console later) |
| Art style | Hand-drawn, animated ("boiling" lines). Hybrid: SDXL on the local ComfyUI makes backgrounds, paper/pencil textures, icons, paddle, ball, title art; bricks, cracks and outlines are drawn in code with seeded random strokes so every brick is unique |
| Content v1 | Campaign: 1 world x 15 levels, star ratings, saved progress |
| Power-ups | Classic DX-Ball set + brick variety + new doodle-themed ones (lists below) |
| Sound | First choice: SFX generated on the local ComfyUI (Stable Audio Open). Fallback: synthesized Web Audio SFX like TriLine. No music in v1 |
| Money | Free, no ads; code kept clean so this can change |

### Defaults I picked (tell me to change any)
- Portrait only, logical playfield 540 x 960 scaled to the screen (letterboxed with paper margins on wide screens).
- 3 lives, extra life at score thresholds; ball launches with a tap.
- World 1 theme: "school notebook" (ruled paper, ballpoint + coloured pencil). More worlds later = new notebooks.
- Generated assets are committed to the repo, so building the game never needs ComfyUI.

## What we reuse from TriLine

| TriLine file | Use in Shatter |
|---|---|
| `package.json`, `vite.config.ts`, `tsconfig.json`, Vitest setup | Copied as-is (renamed), `peerjs` dependency dropped for v1 |
| `.github/workflows/deploy.yml` | Copied as-is: test, build, deploy to Pages on push to `main` |
| `src/ui/storage.ts` | Copied as-is (settings, progress, high scores) |
| `src/ui/sound.ts` | Base for `audio/sound.ts`: same mute/AudioContext handling, adds playback of generated samples; its synth code becomes the fallback |
| `src/ui/dialog.ts`, `widgets.ts`, `dom.ts`, `screens.ts`, `style.css` | Menus, pause, settings, level-complete dialogs as DOM overlays above the canvas, restyled hand-drawn |
| `src/ui/themes/*` (CSS-var theme + manager + contrast test) | Pattern for per-world skins (UI colours + which asset set to load) |
| `tests/*` layout | Same structure: pure engine tested in Node |
| `src/net/*` (PeerJS, session, protocol) | Not in v1. Kept for a later online versus/co-op mode |
| `PLAN.md` milestone + subagent workflow | Same process (below) |

## Architecture

```
src/
  engine/          pure, deterministic, no DOM (tested in Node)
    rng.ts           seeded PRNG (same seed -> same level wobble, replays, tests)
    state.ts         World: balls, paddle, bricks, drops, lasers, score, lives, timers
    physics.ts       fixed 120 Hz step; swept circle-vs-box collision (no tunnelling at high speed),
                     paddle bounce angle by hit position, min/max speed, anti-horizontal-loop nudge
    bricks.ts        brick types + hit/destroy rules, chain explosions
    powerups.ts      drop table, timed effects, stacking rules
    level.ts         parse level files, star thresholds
  render/
    sketch.ts        seeded hand-drawn primitives: wobbly line, rough rect, hatch/scribble fill, crack paths
    boil.ts          each sprite pre-rendered with 3 jitter seeds to offscreen canvases, cycled ~10 fps
    renderer.ts      draws world; interpolates between physics steps; DPR capped at 2
    particles.ts     paper shreds, eraser crumbs, ink splats, pencil shavings, screen shake
    assets.ts        loads SDXL images; paper-white art is drawn with 'multiply' blending, so no
                     background removal is needed
  input/
    tilt.ts          DeviceOrientation, iOS permission prompt, calibrate, dead zone, smoothing, sensitivity
    pointer.ts       relative drag (finger never covers the paddle), tap to launch/fire
    keyboard.ts, gamepad.ts
    controls.ts      merges all into one "paddle target + fire" signal
  audio/sound.ts     sample bank + synth fallback (from TriLine)
  game/              loop, scenes (title, level select, play, pause, results), progress save
  ui/                reused TriLine DOM overlay modules
levels/              15 level files (text grid, one char per brick type) + metadata
assets/              generated images/audio + manifest.json (prompt, seed, model per file)
tools/comfy/         asset generation scripts + ComfyUI API workflow JSON
tests/               physics, collisions, bricks, power-ups, level parsing
```

The engine never touches the screen or input: `step(world, input, dt) -> world`. That keeps it testable,
lets a later PC/console build reuse it untouched, and makes a future online mode possible.

## Hand-drawn look: how "every brick is unique" works
- Each brick gets a seed from (level, row, column). Its outline, hatch direction, pencil pressure and small
  doodles (smiley, star, scribble) come from that seed, so no two bricks match but a level always looks the same.
- Fills use SDXL-generated textures (coloured pencil, crayon, marker swatches) clipped to the wobbly outline.
- Lines "boil" by cycling 3 pre-drawn variants at ~10 fps (cheap: drawn once per brick, not every frame).
- Damage draws seeded crack lines; destroy spawns paper-shred particles with the brick's own colours.

## ComfyUI asset pipeline (your PC, http://192.168.1.10:4567)

Checked the server: ComfyUI 0.46, RTX 3070 Ti 8 GB, SDXL checkpoints `Juggernaut-XL_v9` and `sd_xl_turbo`,
upscaler `RealESRGAN_x4plus`, and `RemoveBackground` / Stable Audio / ACE-Step nodes are present.
No sketch-style LoRA and no audio models are installed.

- `tools/comfy/gen.ts` reads `tools/comfy/prompts.json` (asset name, prompt, size, count, seed), queues jobs via
  the `/prompt` API, downloads results, writes `assets/manifest.json`. Re-running only fills missing files.
- Images: SDXL Turbo for quick drafts (many variants per asset), Juggernaut XL for finals, white background,
  then you pick favourites in a small contact-sheet HTML page the script writes.
- Assets: notebook backgrounds (ruled, graph, margin doodles), 6-8 colour fill textures, paddle variants, ball
  (graphite, crumpled paper), ~22 power-up icons, title logo, UI frames/buttons.
- Audio: Stable Audio Open 1.0 via ComfyUI's audio nodes: ~25 short SFX (pencil tap bounce, paper rip,
  eraser rub, explosion poof, power-up pickup, life lost, level clear), 3-5 variants each, picked at random.
  If quality is poor, fall back to synthesized SFX.

## Power-ups and bricks

> **Superseded by [SPEC.md](SPEC.md) (v1.1 revamp, 2026-11-21).** The list below is the original v1 set.

**Classic:** expand paddle, shrink paddle, multi-ball (x3), fireball (smashes through), catch/sticky,
laser guns, speed up, slow down, extra life, kill paddle (lose a life), split ball, "through" ball.

**Bricks:** 1/2/3-hit (crack stages), indestructible (ink-filled), explosive (chain reactions), moving
(slides side to side), regenerating (redraws itself after a few seconds), hidden (appears when hit).

**Doodle extras:** eraser (wipes a whole row), ink blot (lands on paddle: sticky + slower), paper plane
(ball homes toward the nearest brick for 5 s), pencil sharpener (shrinks paddle), ruler (extra-wide straight
paddle), crumpled ball (heavy ball, 2 damage), sticky note (a safety net under the paddle that absorbs one miss).

## Milestones and who builds them

Opus (me) writes briefs and reviews each milestone; Sonnet/Haiku subagents write the code, to save your quota.

| # | Milestone | Model | Done when |
|---|---|---|---|
| 0 | Scaffold: copy TriLine config, deploy workflow, storage, PWA manifest + service worker, blank canvas loop, fullscreen + portrait lock | Haiku | `npm run dev` shows a resizing canvas; Pages deploy works |
| 1 | Engine + physics + tests: ball, paddle, walls, basic bricks, lives, score, fixed timestep | Sonnet | Tests pass incl. high-speed no-tunnelling; playable with plain rectangles |
| 2 | Input: tilt (permission, calibrate, sensitivity), relative drag, keyboard, gamepad, settings screen | Sonnet | Playable on your phone over HTTPS with tilt and drag |
| 3 | Sketch renderer: seeded strokes, boil, cracks, particles, screen shake, procedural placeholder art | Sonnet (Opus reviews the look) | Fully hand-drawn look without any SDXL files |
| 4 | ComfyUI image pipeline + contact sheet; generate and pick world-1 assets | Sonnet writes, Haiku runs batches, you pick | All world-1 images in `assets/` |
| 5 | All bricks and power-ups | Sonnet | Each one has a test level + unit tests |
| 6 | Audio: ComfyUI SFX pipeline (or synth fallback), reuse TriLine SoundManager | Sonnet / Haiku runs | All game events have sounds; mute works |
| 6.5 | Revamp to SPEC.md v1.1: 15 stationery power-ups, combo scoring, clip anti-softlock, pencil paddle, new icons/SFX | Sonnet, you pick assets | SPEC.md implemented and tested |
| 6.6 | Autopilot simulations over all power-up/brick combos, data saved for analysis | Sonnet | CSV/JSON results to tune levels and stars |
| 7 | 15 levels + level select, stars, saved progress | Haiku drafts levels, you playtest, Sonnet tunes | Campaign playable start to finish |
| 8 | Menus (reused TriLine UI), polish, offline PWA, performance on a mid-range phone, deploy | Sonnet | 60 fps on your phone; live on GitHub Pages |

**Later:** Capacitor Android/iOS builds, Tauri PC build for Steam, full gamepad menu navigation, more worlds,
endless mode, level editor, online versus/co-op (TriLine's `net/`), console port.

## What I need from you
1. **Audio model (for milestone 6):** download Stable Audio Open 1.0 from Hugging Face (`stabilityai/stable-audio-open-1.0`,
   needs you to accept its licence) into ComfyUI `models/checkpoints`, and a T5-base text encoder into
   `models/text_encoders`. Skip this and we use synthesized sounds.
2. **Optional style LoRA (milestone 4):** an SDXL pencil-sketch / doodle LoRA from Civitai into `models/loras`
   gives much more consistent hand-drawn art than prompts alone. Tell me its file name.
3. **GitHub repo:** create `Shatter` (or tell me to init git here and you'll add the remote), and set Pages
   source to GitHub Actions like TriLine.
4. **Phone testing:** tilt needs HTTPS. We'll test on the GitHub Pages build, or the dev server with a
   self-signed certificate on your LAN (your phone will show a warning once).
