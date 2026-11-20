# Shatter art pipeline (ComfyUI)

Needs Python 3 + Pillow. ComfyUI at `http://192.168.1.10:4567` (override with `COMFY_URL`). Run everything from the repo root.

1. `python3 -I tools/comfy/gen.py --dry-run` shows the plan; `python3 -I tools/comfy/gen.py` generates into `tools/comfy/out/<group>/<id>/<seed>.png`
   (resumes, skips existing; `--only <id|group>`, `--limit N`, `--draft` for fast SDXL Turbo checks in `out_draft/`). Prompts live in `assets.json`.
2. `python3 -I tools/comfy/sheet.py`, then open `tools/comfy/out/sheet.html` and click your favourites.
3. Press "Copy picks" and paste the JSON into `tools/comfy/picks.json` (`{"icon-extra-life": [19000], ...}`).
4. `python3 -I tools/comfy/promote.py` writes cropped WebP files and `manifest.json` to `public/assets/world1/`.

Raw images are never pure white (SDXL paints grey/cream paper); `promote.py` levels the border colour to white so `multiply` blending works.
