#!/usr/bin/env python3
"""Copies audio_picks.json ({id: [seeds]}) to public/assets/sfx/<id>-<n>.mp3 and writes manifest.json."""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(HERE, "out", "audio")
DEST = os.path.join(ROOT, "public", "assets", "sfx")
LIMIT = 2 * 1024 * 1024


def main():
    try:
        with open(os.path.join(HERE, "audio_picks.json")) as f:
            picks = json.load(f)
    except (OSError, ValueError) as e:
        sys.exit(f"error: cannot read tools/comfy/audio_picks.json ({e})")
    os.makedirs(DEST, exist_ok=True)
    manifest, total = {}, 0
    for sid, seeds in sorted(picks.items()):
        files = []
        for n, seed in enumerate(seeds[:3], 1):
            src = os.path.join(SRC, sid, f"{seed}.mp3")
            if not os.path.exists(src):
                print(f"warning: missing {src}", file=sys.stderr)
                continue
            name = f"{sid}-{n}.mp3"
            shutil.copyfile(src, os.path.join(DEST, name))
            total += os.path.getsize(src)
            files.append(name)
        if files:
            manifest[sid] = files
    with open(os.path.join(DEST, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"{sum(len(v) for v in manifest.values())} files, {len(manifest)} sounds, {total / 1024:.0f} KB in {DEST}")
    if total > LIMIT:
        print(f"warning: total exceeds {LIMIT // 1024 // 1024} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
