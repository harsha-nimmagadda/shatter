"""Minimal ComfyUI client: SDXL txt2img with 0-2 chained LoRAs. Stdlib only."""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE_URL = os.environ.get("COMFY_URL", "http://192.168.1.10:4567").rstrip("/")
CHECKPOINT = "Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"
TURBO = "sd_xl_turbo_1.0_fp16.safetensors"
CLIENT_ID = str(uuid.uuid4())


class ComfyError(RuntimeError):
    pass


def _req(path, data=None, timeout=30):
    url = BASE_URL + path
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise ComfyError(f"HTTP {e.code} from {url}: {e.read()[:500].decode(errors='replace')}")
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        raise ComfyError(f"ComfyUI unreachable at {BASE_URL} ({e}). Is the server running? Set COMFY_URL to override.")


def check_server():
    _req("/system_stats", timeout=8)


def build_workflow(prompt, negative, width, height, seed, steps=28, cfg=6.0, sampler="dpmpp_2m",
                   scheduler="karras", checkpoint=CHECKPOINT, loras=(), prefix="shatter"):
    """loras: iterable of (name, strength). Returns an API-format workflow dict."""
    wf = {"1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}}}
    model, clip = ["1", 0], ["1", 1]
    nid = 10
    for name, strength in list(loras)[:2]:
        wf[str(nid)] = {"class_type": "LoraLoader", "inputs": {
            "model": model, "clip": clip, "lora_name": name,
            "strength_model": strength, "strength_clip": strength}}
        model, clip = [str(nid), 0], [str(nid), 1]
        nid += 1
    wf["2"] = {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": clip}}
    wf["3"] = {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": clip}}
    wf["4"] = {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}}
    wf["5"] = {"class_type": "KSampler", "inputs": {
        "model": model, "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0],
        "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": sampler, "scheduler": scheduler, "denoise": 1.0}}
    wf["6"] = {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}}
    wf["7"] = {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}}
    return wf


def queue(workflow):
    out = json.loads(_req("/prompt", {"prompt": workflow, "client_id": CLIENT_ID}))
    if out.get("node_errors"):
        raise ComfyError(f"node errors: {out['node_errors']}")
    return out["prompt_id"]


def wait(prompt_id, timeout=600, poll=1.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        hist = json.loads(_req(f"/history/{prompt_id}"))
        if prompt_id in hist:
            h = hist[prompt_id]
            st = h.get("status", {})
            if st.get("status_str") == "error":
                raise ComfyError(f"generation failed: {json.dumps(st)[:500]}")
            for node in h.get("outputs", {}).values():
                if node.get("images"):
                    return node["images"][0]
            if st.get("completed"):
                raise ComfyError("finished without an image")
        time.sleep(poll)
    raise ComfyError(f"timed out after {timeout}s waiting for {prompt_id}")


def download(img):
    q = urllib.parse.urlencode({"filename": img["filename"], "subfolder": img.get("subfolder", ""),
                                "type": img.get("type", "output")})
    return _req("/view?" + q, timeout=120)


def generate(out_path, **kw):
    """Builds, queues, waits and saves one PNG to out_path."""
    pid = queue(build_workflow(**kw))
    data = download(wait(pid))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = out_path + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, out_path)
    return out_path
