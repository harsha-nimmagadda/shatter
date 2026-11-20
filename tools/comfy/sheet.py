#!/usr/bin/env python3
"""Writes tools/comfy/out/sheet.html, a self-contained contact sheet for picking favourites."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
MULTI = {"paper", "fill", "margin"}

HTML = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shatter asset picker</title>
<style>
:root{--paper:#fbf6e6;--ink:#2b2b2b}
body{margin:0;font:14px system-ui,sans-serif;background:#e8e4d8;color:var(--ink)}
#bar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:2px solid #999;padding:8px 12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
#bar textarea{flex:1 1 300px;height:42px;font:12px monospace}
button{font:inherit;padding:6px 12px;cursor:pointer}
h2{margin:18px 12px 4px}h2 small{font-weight:normal;color:#666}
h3{margin:12px 12px 4px;font-size:15px}
.grid{display:flex;flex-wrap:wrap;gap:10px;margin:0 12px 8px}
.card{width:220px;background:var(--paper);border:3px solid transparent;border-radius:6px;cursor:pointer;position:relative;box-shadow:0 1px 3px #0003}
.card img{display:block;width:100%;height:auto;mix-blend-mode:multiply}
.card.sel{border-color:#1a9a3c;box-shadow:0 0 0 2px #1a9a3c66}
.card.sel::after{content:"\2713";position:absolute;top:4px;right:6px;color:#1a9a3c;font-size:22px;font-weight:bold}
.card .seed{font:11px monospace;padding:2px 6px;background:#fff9}
body.whiten .card img{filter:brightness(1.12) contrast(1.15)}
.wide .card{width:330px}
</style></head><body>
<div id="bar"><b>Picks: <span id="cnt">0</span></b><span id="per"></span>
<label><input type="checkbox" id="wh"> whiten preview</label>
<button id="copy">Copy picks</button><button id="clear">Clear</button>
<textarea id="json" readonly></textarea></div>
<div id="root"></div>
<script>
const DATA=__DATA__, MULTI=new Set(__MULTI__);
const KEY="shatter-picks";
let picks={};
try{picks=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(picks))}catch(e){}}
function render(){
 const root=document.getElementById("root");root.innerHTML="";
 let g=null;
 for(const a of DATA){
  if(a.group!==g){g=a.group;const h=document.createElement("h2");h.textContent=g;root.appendChild(h);}
  const h=document.createElement("h3");
  h.innerHTML=a.id+" <small>"+(MULTI.has(a.group)?"multi-pick":"pick one (or more)")+"</small>";root.appendChild(h);
  const d=document.createElement("div");d.className="grid"+(a.width>a.height?" wide":"");
  for(const s of a.seeds){
   const c=document.createElement("div");c.className="card";c.dataset.id=a.id;c.dataset.seed=s;
   const im=document.createElement("img");im.loading="lazy";im.src=a.group+"/"+a.id+"/"+s+".png";c.appendChild(im);
   const t=document.createElement("div");t.className="seed";t.textContent="seed "+s;c.appendChild(t);
   c.onclick=()=>{
    const l=picks[a.id]=picks[a.id]||[];const i=l.indexOf(s);
    if(i>=0)l.splice(i,1);else l.push(s);
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
 document.getElementById("per").textContent=" assets without a pick: "+miss+"/"+DATA.length;
 document.getElementById("json").value=JSON.stringify(picks);
}
document.getElementById("copy").onclick=async()=>{
 const ta=document.getElementById("json");ta.select();
 try{await navigator.clipboard.writeText(ta.value)}catch(e){try{document.execCommand("copy")}catch(e2){}}
};
document.getElementById("clear").onclick=()=>{if(confirm("Clear all picks?")){picks={};save();mark();}};
document.getElementById("wh").onchange=e=>document.body.classList.toggle("whiten",e.target.checked);
render();
fetch("../picks.json").then(r=>r.ok?r.json():null).then(p=>{
 if(p&&typeof p==="object"&&!localStorage.getItem(KEY)){picks=p;save();mark();}
}).catch(()=>{});
</script></body></html>
"""


def main():
    with open(os.path.join(HERE, "assets.json")) as f:
        assets = json.load(f)["assets"]
    data = []
    for a in assets:
        d = os.path.join(OUT, a["group"], a["id"])
        if not os.path.isdir(d):
            continue
        seeds = sorted(int(n[:-4]) for n in os.listdir(d) if n.endswith(".png") and n[:-4].isdigit())
        if seeds:
            data.append({"id": a["id"], "group": a["group"], "width": a["width"], "height": a["height"], "seeds": seeds})
    os.makedirs(OUT, exist_ok=True)
    html = HTML.replace("__DATA__", json.dumps(data)).replace("__MULTI__", json.dumps(sorted(MULTI)))
    path = os.path.join(OUT, "sheet.html")
    with open(path, "w") as f:
        f.write(html)
    print(f"wrote {path} ({sum(len(a['seeds']) for a in data)} images, {len(data)} assets)")


if __name__ == "__main__":
    main()
