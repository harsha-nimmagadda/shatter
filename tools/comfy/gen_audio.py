#!/usr/bin/env python3
"""Generate SFX variants from sounds.json (Stable Audio Open on ComfyUI). Re-running resumes.

  python3 -I tools/comfy/gen_audio.py --dry-run
  python3 -I tools/comfy/gen_audio.py [--only <id>] [--limit N]
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import comfy  # noqa: E402

OUT = os.path.join(HERE, "out", "audio")


def load_sounds():
    with open(os.path.join(HERE, "sounds.json")) as f:
        data = json.load(f)
    d = data.get("defaults", {})
    jobs = []
    for a in data["sounds"]:
        for i in range(a.get("count", 4)):
            seed = a["seed"] + i
            jobs.append({
                "id": a["id"], "prompt": a["prompt"], "negative": a.get("negative", d.get("negative", "")),
                "seconds": a.get("seconds", 2), "seed": seed,
                "path": os.path.join(OUT, a["id"], f"{seed}.mp3"),
            })
    return jobs


def load_manifest(path):
    try:
        with open(path) as f:
            return {e["file"]: e for e in json.load(f)}
    except (OSError, ValueError, KeyError):
        return {}


def save_manifest(path, entries):
    tmp = path + ".part"
    with open(tmp, "w") as f:
        json.dump(sorted(entries.values(), key=lambda e: e["file"]), f, indent=1)
    os.replace(tmp, path)


def fmt(sec):
    sec = int(sec)
    return f"{sec // 3600}h{sec % 3600 // 60:02d}m" if sec >= 3600 else f"{sec // 60}m{sec % 60:02d}s"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="sound id")
    ap.add_argument("--limit", type=int, help="max new clips to generate")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    jobs = load_sounds()
    if args.only:
        jobs = [j for j in jobs if j["id"] == args.only]
        if not jobs:
            sys.exit(f"no sound named {args.only!r}")
    todo = [j for j in jobs if not os.path.exists(j["path"])]
    if args.limit is not None:
        todo = todo[:args.limit]
    print(f"{len(jobs)} clips in plan, {len([j for j in jobs if os.path.exists(j['path'])])} exist, {len(todo)} to generate")
    if args.dry_run:
        counts = {}
        for j in todo:
            counts[j["id"]] = counts.get(j["id"], 0) + 1
        for k, v in counts.items():
            print(f"  {k}: {v}")
        print(f"estimated time: {fmt(sum(6 + 3 * j['seconds'] for j in todo))}")
        return
    if not todo:
        return
    try:
        comfy.check_server()
    except comfy.ComfyError as e:
        sys.exit(f"error: {e}")

    mpath = os.path.join(OUT, "manifest.json")
    os.makedirs(OUT, exist_ok=True)
    manifest = load_manifest(mpath)
    done = failed = 0
    t0 = time.time()
    try:
        for n, j in enumerate(todo, 1):
            avg = (time.time() - t0) / done if done else None
            eta = f", ETA {fmt(avg * (len(todo) - n + 1))}" if avg else ""
            print(f"[{n}/{len(todo)}] {j['id']} seed {j['seed']} ({j['seconds']}s){eta}", flush=True)
            try:
                comfy.generate_audio(j["path"], prompt=j["prompt"], negative=j["negative"], seconds=j["seconds"],
                                     seed=j["seed"])
            except comfy.ComfyError as e:
                failed += 1
                print(f"  FAILED: {e}", file=sys.stderr, flush=True)
                continue
            done += 1
            rel = os.path.relpath(j["path"], OUT)
            manifest[rel] = {"id": j["id"], "seed": j["seed"], "prompt": j["prompt"], "seconds": j["seconds"],
                             "checkpoint": comfy.AUDIO_CKPT, "file": rel}
            save_manifest(mpath, manifest)
    except KeyboardInterrupt:
        print("\ninterrupted; re-run to resume")
    el = time.time() - t0
    print(f"done {done}, failed {failed}, {fmt(el)}" + (f" ({el / done:.1f}s/clip)" if done else ""))


if __name__ == "__main__":
    main()
