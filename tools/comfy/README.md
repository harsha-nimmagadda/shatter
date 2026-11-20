# Shatter art pipeline (ComfyUI)

Needs Python 3 + Pillow. ComfyUI at `http://192.168.1.10:4567` (override with `COMFY_URL`). Run everything from the repo root.

1. `python3 -I tools/comfy/gen.py --dry-run` shows the plan; `python3 -I tools/comfy/gen.py` generates into `tools/comfy/out/<group>/<id>/<seed>.png`
   (resumes, skips existing; `--only <id|group>`, `--limit N`, `--draft` for fast SDXL Turbo checks in `out_draft/`). Prompts live in `assets.json`.
2. `python3 -I tools/comfy/sheet.py`, then open `tools/comfy/out/sheet.html` and click your favourites.
3. Press "Copy picks" and paste the JSON into `tools/comfy/picks.json` (`{"icon-extra-life": [19000], ...}`).
4. `python3 -I tools/comfy/promote.py` writes cropped WebP files and `manifest.json` to `public/assets/world1/`.

Raw images are never pure white (SDXL paints grey/cream paper); `promote.py` levels the border colour to white so `multiply` blending works.

## Sound effects (Stable Audio Open on ComfyUI)

Python 3 stdlib only. Needs `stable-audio-open-1.0.safetensors` and `t5_base.safetensors` on the server. MP3 conversion happens inside the ComfyUI graph (`SaveAudioMP3`, V0), so no ffmpeg is needed.

1. `python3 -I tools/comfy/gen_audio.py --dry-run` shows the plan. `python3 -I tools/comfy/gen_audio.py` generates all 19 sounds x 4 variants (about 76 clips, ~12 min) into `tools/comfy/out/audio/<id>/<seed>.mp3`
   (resumes, skips existing; `--only <id>`, `--limit N`). Prompts, lengths and seeds live in `sounds.json`.
2. `python3 -I tools/comfy/audio_sheet.py`, open `tools/comfy/out/audio/sheet.html`, play the variants and click the cards you like (1-3 per sound; the page remembers picks).
3. Press "Copy picks" and paste the JSON into `tools/comfy/audio_picks.json` (`{"paddle": [100, 102], ...}`).
4. `python3 -I tools/comfy/promote_audio.py` copies them to `public/assets/sfx/<id>-<n>.mp3` and writes `manifest.json` (warns over 2 MB).

The game loads `assets/sfx/manifest.json` at start; sounds with no sample (or no manifest at all) use the built-in synth fallback in `src/audio/sound.ts`. Samples are silence-trimmed, peak-normalised and faded in the browser, so raw clips need no editing.
