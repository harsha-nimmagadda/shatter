#!/usr/bin/env python3
"""Generate world-1 art from assets.json. Re-running resumes (existing files are skipped).

  python3 -I tools/comfy/gen.py --dry-run
  python3 -I tools/comfy/gen.py [--only <id|group>] [--limit N] [--draft]
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import comfy  # noqa: E402


def load_assets():
    with open(os.path.join(HERE, "assets.json")) as f:
        data = json.load(f)
    d = data.get("defaults", {})
    jobs = []
    for a in data["assets"]:
        for i in range(a.get("count", 1)):
            jobs.append({
                "id": a["id"], "group": a["group"], "prompt": a["prompt"],
                "negative": a.get("negative", d.get("negative", "")),
                "loras": a.get("loras", []), "width": a["width"], "height": a["height"],
                "steps": a.get("steps", 28), "cfg": a.get("cfg", 6), "seed": a["seed"] + i,
                "sampler": a.get("sampler", d.get("sampler", "dpmpp_2m")),
                "scheduler": a.get("scheduler", d.get("scheduler", "karras")),
            })
    return jobs


def draft_size(w, h):
    s = 512 / max(w, h)
    return max(8, round(w * s / 8) * 8), max(8, round(h * s / 8) * 8)


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
    ap.add_argument("--only", help="asset id or group")
    ap.add_argument("--draft", action="store_true", help="SDXL Turbo, 4 steps, 512px, no LoRA, writes out_draft/")
    ap.add_argument("--limit", type=int, help="max new images to generate")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    out_root = os.path.join(HERE, "out_draft" if args.draft else "out")
    jobs = load_assets()
    if args.only:
        jobs = [j for j in jobs if args.only in (j["id"], j["group"])]
        if not jobs:
            sys.exit(f"no asset or group named {args.only!r}")
    for j in jobs:
        j["path"] = os.path.join(out_root, j["group"], j["id"], f"{j['seed']}.png")
    todo = [j for j in jobs if not os.path.exists(j["path"])]
    if args.limit is not None:
        todo = todo[:args.limit]
    print(f"{len(jobs)} images in plan, {len(jobs) - len([j for j in jobs if not os.path.exists(j['path'])])} exist, "
          f"{len(todo)} to generate{' (draft)' if args.draft else ''}")
    if args.dry_run:
        counts = {}
        for j in todo:
            counts[j["id"]] = counts.get(j["id"], 0) + 1
        for k, v in counts.items():
            print(f"  {k}: {v}")
        return
    if not todo:
        return
    try:
        comfy.check_server()
    except comfy.ComfyError as e:
        sys.exit(f"error: {e}")

    mpath = os.path.join(out_root, "manifest.json")
    manifest = {} if args.draft else load_manifest(mpath)
    done = failed = 0
    t0 = time.time()
    try:
        for n, j in enumerate(todo, 1):
            kw = dict(prompt=j["prompt"], negative=j["negative"], width=j["width"], height=j["height"],
                      seed=j["seed"], steps=j["steps"], cfg=j["cfg"], sampler=j["sampler"],
                      scheduler=j["scheduler"], checkpoint=comfy.CHECKPOINT,
                      loras=[(l["name"], l["strength"]) for l in j["loras"]], prefix="shatter")
            if args.draft:
                kw.update(checkpoint=comfy.TURBO, loras=[], steps=4, cfg=1.0, sampler="euler",
                          scheduler="simple")
                kw["width"], kw["height"] = draft_size(j["width"], j["height"])
            avg = (time.time() - t0) / done if done else None
            eta = f", ETA {fmt(avg * (len(todo) - n + 1))}" if avg else ""
            print(f"[{n}/{len(todo)}] {j['id']} seed {j['seed']}{eta}", flush=True)
            try:
                comfy.generate(j["path"], **kw)
            except comfy.ComfyError as e:
                failed += 1
                print(f"  FAILED: {e}", file=sys.stderr, flush=True)
                continue
            done += 1
            if not args.draft:
                rel = os.path.relpath(j["path"], out_root)
                manifest[rel] = {"id": j["id"], "group": j["group"], "seed": j["seed"], "prompt": j["prompt"],
                                 "loras": j["loras"], "checkpoint": kw["checkpoint"], "file": rel}
                save_manifest(mpath, manifest)
    except KeyboardInterrupt:
        print("\ninterrupted; re-run to resume")
    el = time.time() - t0
    print(f"done {done}, failed {failed}, {fmt(el)}" + (f" ({el / done:.1f}s/image)" if done else ""))


if __name__ == "__main__":
    main()
