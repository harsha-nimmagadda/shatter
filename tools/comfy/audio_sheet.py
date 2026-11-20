#!/usr/bin/env python3
"""Writes tools/comfy/out/audio/sheet.html: audio players per variant, click to pick 1-3 per sound."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "audio")

HTML = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shatter sound picker</title>
<style>
:root{--paper:#fbf6e6;--ink:#2b2b2b}
body{margin:0;font:14px system-ui,sans-serif;background:#e8e4d8;color:var(--ink)}
#bar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:2px solid #999;padding:8px 12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
#bar textarea{flex:1 1 300px;height:42px;font:12px monospace}
button{font:inherit;padding:6px 12px;cursor:pointer}
h3{margin:14px 12px 2px;font-size:16px}h3 small{font-weight:normal;color:#666}
.prompt{margin:0 12px 4px;color:#555;font-size:12px}
.grid{display:flex;flex-wrap:wrap;gap:10px;margin:0 12px 8px}
.card{width:260px;background:var(--paper);border:3px solid transparent;border-radius:6px;cursor:pointer;position:relative;box-shadow:0 1px 3px #0003;padding:4px}
.card audio{display:block;width:100%}
.card.sel{border-color:#1a9a3c;box-shadow:0 0 0 2px #1a9a3c66}
.card.sel::after{content:"\2713";position:absolute;top:2px;right:8px;color:#1a9a3c;font-size:20px;font-weight:bold}
.card .seed{font:11px monospace;padding:2px 6px}
</style></head><body>
<div id="bar"><b>Picks: <span id="cnt">0</span></b><span id="per"></span>
<button id="copy">Copy picks</button><button id="clear">Clear</button>
<textarea id="json" readonly></textarea></div>
<div id="root"></div>
<script>
const DATA=__DATA__, MAXPICK=3;
const KEY="shatter-audio-picks";
let picks={};
try{picks=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(picks))}catch(e){}}
function render(){
 const root=document.getElementById("root");root.innerHTML="";
 for(const a of DATA){
  const h=document.createElement("h3");h.innerHTML=a.id+" <small>pick 1-3 &middot; "+a.seconds+" s</small>";root.appendChild(h);
  const p=document.createElement("div");p.className="prompt";p.textContent=a.prompt;root.appendChild(p);
  const d=document.createElement("div");d.className="grid";
  for(const s of a.seeds){
   const c=document.createElement("div");c.className="card";c.dataset.id=a.id;c.dataset.seed=s;
   const au=document.createElement("audio");au.controls=true;au.preload="none";au.src=a.id+"/"+s+".mp3";
   au.onclick=e=>e.stopPropagation();c.appendChild(au);
   const t=document.createElement("div");t.className="seed";t.textContent="seed "+s;c.appendChild(t);
   c.onclick=()=>{
    const l=picks[a.id]=picks[a.id]||[];const i=l.indexOf(s);
    if(i>=0)l.splice(i,1);else if(l.length<MAXPICK)l.push(s);else alert("Max "+MAXPICK+" picks per sound");
    if(!l.length)delete picks[a.id];
    save();mark();};
   d.appendChild(c);
  }
  root.appendChild(d);
 }
 mark();
}
function mark(){
 let n=0;
 for(const c of document.querySelectorAll(".card")){
  const on=(picks[c.dataset.id]||[]).includes(+c.dataset.seed);c.classList.toggle("sel",on);if(on)n++;}
 document.getElementById("cnt").textContent=n;
 const miss=DATA.filter(a=>!picks[a.id]).length;
 document.getElementById("per").textContent=" sounds without a pick: "+miss+"/"+DATA.length;
 document.getElementById("json").value=JSON.stringify(picks);
}
document.getElementById("copy").onclick=async()=>{
 const ta=document.getElementById("json");ta.select();
 try{await navigator.clipboard.writeText(ta.value)}catch(e){try{document.execCommand("copy")}catch(e2){}}
};
document.getElementById("clear").onclick=()=>{if(confirm("Clear all picks?")){picks={};save();mark();}};
render();
fetch("../../audio_picks.json").then(r=>r.ok?r.json():null).then(p=>{
 if(p&&typeof p==="object"&&!localStorage.getItem(KEY)){picks=p;save();mark();}
}).catch(()=>{});
</script></body></html>
"""


def main():
    with open(os.path.join(HERE, "sounds.json")) as f:
        sounds = json.load(f)["sounds"]
    data = []
    for a in sounds:
        d = os.path.join(OUT, a["id"])
        if not os.path.isdir(d):
            continue
        seeds = sorted(int(n[:-4]) for n in os.listdir(d) if n.endswith(".mp3") and n[:-4].isdigit())
        if seeds:
            data.append({"id": a["id"], "prompt": a["prompt"], "seconds": a.get("seconds", 2), "seeds": seeds})
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "sheet.html")
    with open(path, "w") as f:
        f.write(HTML.replace("__DATA__", json.dumps(data)))
    print(f"wrote {path} ({sum(len(a['seeds']) for a in data)} clips, {len(data)} sounds)")


if __name__ == "__main__":
    main()
