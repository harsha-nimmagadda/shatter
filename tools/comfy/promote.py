#!/usr/bin/env python3
"""Turns picks.json ({assetId: [seeds]}) into game-ready WebP files in public/assets/world1/."""
import json
import os
import sys

from PIL import Image, ImageChops, ImageFilter, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "world1")
QUALITY = 82
LIMIT = 3 * 1024 * 1024


def whiten(im):
    """Scales each channel so the paper background (median of the border ring) becomes pure white."""
    im = im.convert("RGB")
    w, h = im.size
    b = max(4, min(w, h) // 20)
    ring = []
    for box in ((0, 0, w, b), (0, h - b, w, h), (0, 0, b, h), (w - b, 0, w, h)):
        ring.append(im.crop(box))
    gains = []
    for ch in range(3):
        vals = sorted(b for r in ring for b in r.split()[ch].tobytes())
        gains.append(255.0 / max(1.0, 0.92 * vals[len(vals) // 2]))
    chans = [c.point(lambda v, g=g: min(255, int(v * g))) for c, g in zip(im.split(), gains)]
    return Image.merge("RGB", chans)


def crop_content(im, pad_frac=0.06, square=False, thresh=205):
    g = im.convert("L").point(lambda v: 255 if v < thresh else 0)
    g = g.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(7))  # drops paper specks
    bbox = g.getbbox()
    if not bbox:
        return im
    x0, y0, x1, y1 = bbox
    pad = int(max(x1 - x0, y1 - y0) * pad_frac) + 2
    if square:
        s = max(x1 - x0, y1 - y0)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        x0, x1, y0, y1 = cx - s // 2, cx + s // 2, cy - s // 2, cy + s // 2
    box = (x0 - pad, y0 - pad, x1 + pad, y1 + pad)
    # Pad with white when the box leaves the image.
    out = Image.new("RGB", (box[2] - box[0], box[3] - box[1]), (255, 255, 255))
    out.paste(im, (-box[0], -box[1]))
    return out


def fit_width(im, w):
    return im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)


def process(group, im):
    if group == "paper":
        return cover_max(im, 1080, 1920)
    if group == "fill":
        return im.convert("RGB").resize((512, 512), Image.LANCZOS)
    im = whiten(im)
    if group == "paddle":
        return fit_width(crop_content(im), 512)
    if group == "ball":
        return crop_content(im, square=True).resize((128, 128), Image.LANCZOS)
    if group == "title":
        return fit_width(crop_content(im), 1024)
    if group == "icon":
        return crop_content(im, square=True).resize((128, 128), Image.LANCZOS)
    if group == "margin":
        return crop_content(im, square=True).resize((128, 128), Image.LANCZOS)
    return im


def cover_max(im, mw, mh):
    """Cover-crops to the 9:16 page ratio, then downsizes to at most mw x mh."""
    im = im.convert("RGB")
    ratio = mw / mh
    w, h = im.size
    if w / h > ratio:
        nw = int(h * ratio)
        im = im.crop(((w - nw) // 2, 0, (w + nw) // 2, h))
    else:
        nh = int(w / ratio)
        im = im.crop((0, (h - nh) // 2, w, (h + nh) // 2))
    if im.width > mw:
        im = im.resize((mw, mh), Image.LANCZOS)
    return im


def main():
    picks_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "picks.json")
    try:
        with open(picks_path) as f:
            picks = json.load(f)
    except (OSError, ValueError) as e:
        sys.exit(f"cannot read {picks_path}: {e}")
    with open(os.path.join(HERE, "assets.json")) as f:
        groups = {a["id"]: a["group"] for a in json.load(f)["assets"]}
    manifest = {}
    for aid, seeds in picks.items():
        group = groups.get(aid)
        if not group:
            print(f"skip unknown asset {aid}", file=sys.stderr)
            continue
        for n, seed in enumerate(seeds, 1):
            src = os.path.join(HERE, "out", group, aid, f"{seed}.png")
            if not os.path.exists(src):
                print(f"missing {src}", file=sys.stderr)
                continue
            im = process(group, Image.open(src))
            rel = f"{group}/{aid}-{n}.webp"
            dst = os.path.join(OUT, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            im.save(dst, "WEBP", quality=QUALITY, method=6)
            manifest.setdefault(aid, {"group": group, "files": []})["files"].append(rel)
            print(f"{rel} {im.size[0]}x{im.size[1]} {os.path.getsize(dst) // 1024} KB")
    if not manifest:
        sys.exit("nothing promoted")
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    total = sum(os.path.getsize(os.path.join(d, n)) for d, _, ns in os.walk(OUT) for n in ns)
    print(f"total {total / 1024:.0f} KB in {OUT}")
    if total > LIMIT:
        print("WARNING: folder exceeds 3 MB", file=sys.stderr)


if __name__ == "__main__":
    main()
