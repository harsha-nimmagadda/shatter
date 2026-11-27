# Shatter — Game Spec v1.1 (revamp)

Source: Gemini's `revamp-idea/revamp.docx` + mockups, reviewed and corrected on 2026-11-21.
Where the doc and the images disagreed, the decision below wins. Everything not listed here
is unchanged from the current engine (`src/engine/config.ts`).

## Unchanged from today
- 540×960 logical playfield, 120 Hz fixed step, substepped collision.
- Ball: start 420 px/s, +1.2% per brick broken, max 900 (was +1.5%/1000; lowered after the first phone playtest found late-level balls too quick). Launch ±20°, paddle bounce ±60°
  (±40° during Ruler), min vertical ratio 0.3.
- Lives: start 3, max 9. Losing a life resets speed, clears timed effects, falling capsules, staples,
  the combo and the sticky note, then serves.
- Drops: 15% per brick that counts toward winning, max 3 capsules falling.
- **Controls: tilt stays the default on touch devices, drag is the alternative** (your original
  choice; Gemini's doc flipped it — one-line change in `src/input/settings.ts` if you want drag).
- Music: two original synthesized chiptune loops with on/off and volume settings (see Visual direction v1.2 and Audio below).

## Bricks (level chars unchanged: `. 1 2 3 # x m r h`)
| Char | Name | HP | Counts | Notes |
|---|---|---|---|---|
| 1/2/3 | Pencil / Pen / Marker | 1/2/3 | yes | Show crack/tear marks as HP drops (procedural overlay). |
| # | Metal Clip | ∞ | no | Anti-softlock rule below. |
| x | Doodle Bomb | 1 | yes | Elliptical blast, chains (as today). |
| m | Sliding Tab | 1 | yes | Slides **horizontally** at 50 px/s; a faint dotted track is drawn along its path. |
| r | Re-sketching | 1 | no | Re-forms after 6 s. **Scores 0 points and never drops capsules.** |
| h | Invisible Ink | 2 | yes | Drawn as a faint crease (not fully invisible). First hit reveals in highlighter ink, second breaks. |

**Anti-stall nudge.** `world.stallT` counts seconds of play since any breakable brick was last damaged (reset by
any damage, and on losing a life). From 15 s on, each paddle bounce leans toward the nearest counting brick by up
to 15°, growing 1° per further second to a 35° cap, always within the normal bounce limit. Bounce-time nudging was
chosen over continuous steering, which made balls orbit bricks in sims. Added after sims showed the Warm-up level
stalling on its last bricks (worst stall on Hidden test fell from ~205 s to ~66 s, Warm-up timeouts 13.5% -> 9.8%).
Level rule for milestone 7: no lone bricks tucked where a bounce can't reach them.

**Hazards stay gentle** (sims: bots dodge ~70% of hazard capsules and a caught one costs < 0.1 lives per game);
this suits the casual audience.

**Metal Clip anti-softlock.** The world keeps a `clipStreak` count and a per-clip `streakHits`.
- A ball hitting a clip: `clipStreak += 1`, that clip's `streakHits += 1`.
- Any damage to a breakable brick (by ball, staple, blast, splash or eraser) resets `clipStreak`
  and every clip's `streakHits` to 0. Paddle, wall and sticky-note bounces neither add nor reset.
- When `clipStreak` reaches 10, every clip with `streakHits >= 3` pops off (removed, `clipPop`
  event, 0 points), then the streak resets.
- Visual: a clip with `streakHits >= 3` is drawn tilted/loose; it snaps back if the streak resets.

## Paddle
- Base width 96. **The 5 size tiers are removed** (nothing uses them any more).
- Ruler sets width to 160; Sharpener multiplies by 0.7 (both: 112). Scissors cuts a gap.
- **The default paddle becomes a pencil** (new art), so the Ruler power-up is visibly different.

## Scoring
- 10 points per HP removed from a counting brick (a 3-HP marker is worth 30 in total),
  × combo multiplier × 2 while Red Pen is active. Applies to every damage source.
- **Combo**: one shared counter of bricks broken since any ball last touched the paddle
  (glue catches count as touches). Multiplier: 0–2 breaks 1×, 3–5 1.5×, 6–8 2×, 9+ 3×.
  The multiplier is evaluated when the points are awarded (the break that reaches 3 already gets 1.5×).
- +50 for catching a positive capsule (everything except Sharpener, Scissors, Red Pen).
- +250 per remaining life when the level is won.
- +1 life at every 10,000 points (max 9). **The score carries across the whole campaign run** (one level scores
  ~900–2,000, so 10,000 is never reached inside a single level; sims 2026-11-27).
- Stars per level (milestone 7): 1 star = clear, 2 stars = the Casual sim bot's median score on that level,
  3 stars = the Casual bot's top-20% score. Recomputed with `npm run sim` whenever a level changes.

## Power-ups (15)
Badge colour = category: **blue = ball, green = paddle, gold = utility, red = hazard.**
Capsules are round icon badges with no text.

| ID | Name | Cat. | Effect | Duration | Weight |
|---|---|---|---|---|---|
| photocopy | Photocopy | ball | Every moving ball becomes 3 (±20°), max 8 balls. Launches a stuck ball first. | instant | 8 |
| crumpled | Crumpled Wad | ball | 2 damage per hit. If the hit destroys the brick the ball keeps going without bouncing; otherwise it bounces. Clips always bounce. | 10 s | 6 |
| plane | Paper Plane | ball | Balls steer toward the nearest counting brick (as today). | 5 s | 5 |
| highlighter | Highlighter | ball | When a ball damages a brick, each brick touching it edge-to-edge (up/down/left/right, within 2 px) takes 1 splash damage. Splash reveals Invisible Ink, can detonate bombs, ignores clips, does not splash again. | 10 s | 6 |
| correction | Correction Tape | ball | Ball speed −30% (floor 70% of base speed); when it ends, speed ÷0.7 (capped at max). Re-catching only refreshes the timer. Was permanent until the 2026-11-27 sims showed it dragged levels out. | 10 s | 7 |
| ruler | Ruler | paddle | Paddle width 160, bounce angle capped at ±40° (was ±25°, which cancelled out the wider paddle in sims). | 8 s | 8 |
| gluestick | Glue Stick | paddle | Balls stick on paddle contact; fire launches; auto-launch after 3 s. | 12 s | 7 |
| stapler | Stapler | paddle | Fires 2 staples (from both paddle ends) **automatically every 0.4 s**; no tapping. Clips absorb staples. | 10 s | 7 |
| eraser | Pink Eraser | utility | Destroys the lowest row of breakable bricks (as today). | instant | 4 |
| goldstar | Gold Star | utility | +1 life (max 9). | instant | 3 |
| paperclip | Paperclip | utility | Falling positive capsules within 220 px of the paddle drift toward it horizontally at up to 260 px/s. | 12 s | 5 |
| stickynote | Sticky Note | utility | Net across the bottom that bounces one missed ball (as today). | until used | 5 |
| sharpener | Sharpener | hazard | Paddle width ×0.7. | 10 s | 4 |
| scissors | Scissors | hazard | A 24 px gap opens in the paddle centre; balls and capsules fall through it. | 8 s | 3 |
| redpen | Red Pen | hazard | Ball speed +25% (capped at max) and 2× points; when it ends, speed ÷1.25 (not below base). | 10 s | 5 |

Re-catching a timed power-up resets its timer. Removed: expand, shrink, multiball, split, fireball,
through, laser, speedup, slowdown, extralife, killpaddle, inkblot.

## Visual direction (v1.2 neon arcade, 2026-11-27; replaces the notebook look)
- Synthwave backdrop (purple sky, stars, striped sun, perspective grid that speeds up and turns cyan with the combo
  and pulses to the music beat), neon-tube walls, glowing glass bricks. All art is procedural Canvas 2D baked into
  cached sprites; no image assets.
- Bricks: 1/2/3 HP = cyan / pink / violet with HP pips and glass cracks; Metal Clip = chrome "ARMOR" plate;
  Doodle Bomb = red bomb glyph (pulses); Sliding Tab = yellow with arrows and a dotted rail; Re-sketching = mint
  with a cycle glyph; Invisible Ink = flickering dashed "?" outline, revealed as a holographic tile.
- Power-ups keep their engine ids but get neon display names: Triple Ball, Meteor, Homing, Splash, Slow-mo, Wide,
  Sticky, Lasers, Wipe, 1-UP, Magnet, Shield, Shrink, Split, Overdrive ×2. Capsules: round badges in the category
  colour (cyan ball, green paddle, gold utility); hazards are red spinning saw-blade badges.
- Juice: shards/sparks/shockwaves, screen shake, flashes, combo fireworks, level intro, haptics. "Reduced effects"
  setting cuts particles, flashes and background motion. Debug sheet: `?gallery`.

## Audio
All SFX and music are synthesized on the device (`src/audio/synth.ts`, rendered in a worker); no audio files.
Two original chiptune loops (Music on/off + volume settings); break sounds climb a pentatonic ladder with the rally.

## Controls and HUD (2026-11-27 UX pass)
- **HUD band**: `[pause] SCORE | LEVEL | hearts [fullscreen]` laid out once in `src/game/hud.ts` and shared by the canvas and the DOM buttons (44 px touch targets around 22-34 px icons, placed from the View transform, safe-area aware; the fullscreen slot collapses where unsupported).
- **Stick**: spawns under the first finger anywhere; a tap (<=180 ms, <10 px) or any second finger fires; radius 11% of the short side (min 44 px); response curve ^1.6 with a 60 ms velocity ease; the base follows the thumb past the radius.
- **Tilt**: gravity-vector steering (`src/input/gravity.ts`), independent of screen axes. Optional 3-step calibration (neutral / full left / full right) stored as `tiltCal`; otherwise automatic from the screen angle with neutral taken at the level's serve.
- **Pause**: RESUME + tile grid (2x2 portrait, 4x1 landscape) with an in-card quit confirm. Settings: sticky header with CONTROLS / SOUND / GRAPHICS tabs and a sticky DONE footer.
