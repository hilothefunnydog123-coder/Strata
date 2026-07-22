"""`strata serve` — a local web app for asking clinical questions.

Standard library only. A clean search page: ask a question, and Strata renders
the evidence-strength verdict, a visual evidence pyramid, and the graded, linked
sources. Nothing is stored; every answer is fetched live from public PubMed.
"""
from __future__ import annotations

import json
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .query import ask

_LEVEL_COLOR = {1: "#16a34a", 2: "#22a06b", 3: "#d97706",
                4: "#ea580c", 5: "#dc2626", 6: "#9ca3af"}
_LEVEL_NAME = {1: "Systematic review / meta-analysis", 2: "Randomized controlled trial",
               3: "Cohort / prospective", 4: "Observational", 5: "Case report / series",
               6: "Review / opinion"}


def _first_sentences(text, n=2):
    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return " ".join(parts[:n]).strip()


def _payload(result) -> dict:
    pyramid = {i: 0 for i in range(1, 7)}
    sources = []
    for i, e in enumerate(result.evidence, 1):
        pyramid[e.grade.level] += 1
        sources.append({
            "n": i, "title": e.article.title, "year": e.article.year,
            "url": e.article.url, "study_type": e.grade.label,
            "strength": e.grade.strength, "level": e.grade.level,
            "sample_size": e.grade.sample_size,
            "snippet": _first_sentences(e.article.abstract) or "(no abstract)",
            "color": _LEVEL_COLOR[e.grade.level],
        })
    return {"question": result.question, "overall_strength": result.body.overall_strength,
            "summary": result.body.summary, "pyramid": pyramid, "sources": sources,
            "levels": _LEVEL_NAME, "colors": _LEVEL_COLOR}


def _handler():
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, body: bytes, ctype: str, code=200):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            if u.path == "/api/ask":
                q = urllib.parse.parse_qs(u.query)
                question = (q.get("q") or [""])[0].strip()
                k = int((q.get("k") or ["8"])[0])
                if not question:
                    return self._send(b'{"error":"empty question"}', "application/json", 400)
                try:
                    result = ask(question, k=k)
                    self._send(json.dumps(_payload(result)).encode(), "application/json")
                except Exception as exc:
                    self._send(json.dumps({"error": str(exc)}).encode(),
                               "application/json", 500)
            else:
                self._send(PAGE.encode(), "text/html; charset=utf-8")
    return H


def serve(port: int = 8600) -> None:
    httpd = ThreadingHTTPServer(("127.0.0.1", port), _handler())
    print(f"Strata running on http://127.0.0.1:{port}   (ctrl-c to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


PAGE = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Strata — clinical evidence</title>
<style>
:root{--bg:#f6f8fb;--card:#fff;--ink:#0f172a;--dim:#64748b;--line:#e2e8f0;
  --brand:#0d9488;--high:#16a34a;--mod:#d97706;--low:#ea580c;--vlow:#dc2626}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:40px 22px 80px}
header{display:flex;align-items:center;gap:12px;margin-bottom:6px}
.logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--brand),#0891b2);
  display:grid;place-items:center;color:#fff;font-weight:800;font-size:19px}
h1{font-size:23px;font-weight:800;letter-spacing:-.02em}
.tag{color:var(--dim);font-size:14px;margin:2px 0 24px 48px}
.search{display:flex;gap:10px;margin-bottom:12px}
.search input{flex:1;padding:15px 18px;border:1px solid var(--line);border-radius:13px;font-size:16px;
  background:var(--card);box-shadow:0 1px 2px rgba(15,23,42,.04);outline:none}
.search input:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(13,148,136,.12)}
.search button{padding:0 24px;border:0;border-radius:13px;background:var(--brand);color:#fff;
  font-weight:700;font-size:15px;cursor:pointer}
.search button:disabled{opacity:.5;cursor:default}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.chip{font-size:13px;color:var(--brand);background:rgba(13,148,136,.08);border:1px solid rgba(13,148,136,.2);
  padding:6px 12px;border-radius:999px;cursor:pointer}
.note{color:var(--dim);font-size:12px;margin-top:14px}
#out{margin-top:26px}
.verdict{display:flex;align-items:center;gap:12px;margin-bottom:6px}
.badge{font-weight:800;font-size:12px;letter-spacing:.04em;padding:6px 12px;border-radius:8px;color:#fff}
.q{font-size:19px;font-weight:700;margin-bottom:14px}
.summary{color:var(--dim);margin-bottom:24px}
.cols{display:grid;grid-template-columns:300px 1fr;gap:26px}
@media(max-width:720px){.cols{grid-template-columns:1fr}}
.pyr h3,.srcs h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--dim);font-weight:700;margin-bottom:12px}
.tier{margin:0 auto 5px;min-height:44px;border-radius:7px;display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:6px 11px;color:#fff;font-size:11px;line-height:1.15;font-weight:600;opacity:.28;transition:.2s}
.tier.has{opacity:1;box-shadow:0 2px 8px rgba(15,23,42,.12)}
.tier .cnt{background:rgba(255,255,255,.28);border-radius:6px;padding:1px 8px;font-weight:800;font-size:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:15px 17px;margin-bottom:11px}
.card .top{display:flex;align-items:center;gap:9px;margin-bottom:7px;flex-wrap:wrap}
.pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:7px;color:#fff}
.yr{color:var(--dim);font-size:12px}
.card .ti{font-weight:650;margin-bottom:5px}
.card .sn{color:var(--dim);font-size:13.5px;margin-bottom:8px}
.card a{color:var(--brand);font-size:13px;text-decoration:none;font-weight:600}
.spin{display:inline-block;width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;
  border-radius:50%;animation:s .7s linear infinite;vertical-align:-3px}
@keyframes s{to{transform:rotate(360deg)}}
.err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:14px 16px;border-radius:12px}
.foot{color:var(--dim);font-size:12px;margin-top:34px;text-align:center}
</style></head><body><div class="wrap">
<header><div class="logo">S</div><h1>Strata</h1></header>
<div class="tag">Clinical questions, answered from real PubMed evidence — and graded by how strong that evidence is.</div>
<div class="search">
  <input id="q" placeholder="Ask a clinical question…" autofocus/>
  <button id="go">Search</button>
</div>
<div class="chips" id="chips"></div>
<div class="note">Reads public PubMed data. Not medical advice, and not a substitute for reading the sources.</div>
<div id="out"></div>
<div class="foot">Strata · evidence-based, honest by design</div>
</div>
<script>
const $=s=>document.querySelector(s);
const EX=["Does vitamin D prevent respiratory infections?",
  "Does metformin reduce cardiovascular mortality in type 2 diabetes?",
  "Is intermittent fasting effective for weight loss?"];
const SB={high:'#16a34a',moderate:'#d97706',low:'#ea580c','very low':'#dc2626',none:'#9ca3af'};
const esc=s=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
$('#chips').innerHTML=EX.map(e=>`<span class="chip">${esc(e)}</span>`).join('');
$('#chips').onclick=e=>{if(e.target.classList.contains('chip')){$('#q').value=e.target.textContent;run();}};
$('#go').onclick=run; $('#q').addEventListener('keydown',e=>{if(e.key==='Enter')run();});

async function run(){
  const q=$('#q').value.trim(); if(!q)return;
  $('#go').disabled=true; $('#go').innerHTML='<span class="spin"></span>';
  $('#out').innerHTML='<div class="summary">Searching PubMed and grading the evidence…</div>';
  try{
    const r=await fetch('/api/ask?q='+encodeURIComponent(q)); const d=await r.json();
    if(d.error){$('#out').innerHTML=`<div class="err">${esc(d.error)}</div>`;return;}
    render(d);
  }catch(e){$('#out').innerHTML=`<div class="err">${esc(e.message||e)}</div>`;}
  finally{$('#go').disabled=false; $('#go').textContent='Search';}
}
function render(d){
  const widths=[46,58,68,78,88,98];
  let pyr='<div class="pyr"><h3>Evidence pyramid</h3>';
  for(let L=1;L<=6;L++){const c=d.pyramid[L]||0;
    pyr+=`<div class="tier ${c?'has':''}" style="width:${widths[L-1]}%;background:${d.colors[L]}">
      <span>${esc(d.levels[L])}</span><span class="cnt">${c}</span></div>`;}
  pyr+='</div>';
  let cards='<div class="srcs"><h3>Sources · strongest first</h3>';
  for(const s of d.sources){
    cards+=`<div class="card"><div class="top">
      <span class="pill" style="background:${s.color}">${esc(s.study_type)}</span>
      <span class="pill" style="background:${SB[s.strength]||'#9ca3af'}">${esc(s.strength)}</span>
      <span class="yr">${s.year||'n.d.'}${s.sample_size?' · n='+s.sample_size.toLocaleString():''}</span></div>
      <div class="ti">${esc(s.title)}</div><div class="sn">${esc(s.snippet)}</div>
      <a href="${s.url}" target="_blank">View on PubMed →</a></div>`;}
  cards+='</div>';
  $('#out').innerHTML=`<div class="verdict">
      <span class="badge" style="background:${SB[d.overall_strength]||'#9ca3af'}">${d.overall_strength.toUpperCase()} EVIDENCE</span></div>
    <div class="q">${esc(d.question)}</div><div class="summary">${esc(d.summary)}</div>
    <div class="cols"><div>${pyr}</div><div>${cards}</div></div>`;
}
</script></body></html>"""
