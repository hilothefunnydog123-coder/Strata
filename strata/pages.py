"""Strata Lite — the simple B2C surface: ask one question, get the honest graded answer.

Standard library only, zero external dependencies. The Console lives in ``console_page.py``;
the landing / verify / platform pages in ``pages_web.py``.
"""
from __future__ import annotations

# The B2C 'lite' surface — the original simple search page, kept as the dumbed-down view.
LITE_HTML = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Strata — is it true?</title>
<style>
:root{--bg:#f6f8fb;--card:#fff;--ink:#0f172a;--dim:#64748b;--line:#e2e8f0;
  --brand:#0d9488;--high:#16a34a;--mod:#d97706;--low:#ea580c;--vlow:#dc2626}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:44px 22px 80px}
header{display:flex;align-items:center;gap:12px;margin-bottom:4px}
.logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--brand),#0891b2);
  display:grid;place-items:center;color:#fff;font-weight:800;font-size:19px}
h1{font-size:23px;font-weight:800;letter-spacing:-.02em}
.tag{color:var(--dim);font-size:15px;margin:2px 0 22px 48px}
.search{display:flex;gap:10px;margin-bottom:12px}
.search input{flex:1;padding:15px 18px;border:1px solid var(--line);border-radius:13px;font-size:16px;
  background:var(--card);outline:none}
.search input:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(13,148,136,.12)}
.search button{padding:0 24px;border:0;border-radius:13px;background:var(--brand);color:#fff;font-weight:700;cursor:pointer}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.chip{font-size:13px;color:var(--brand);background:rgba(13,148,136,.08);border:1px solid rgba(13,148,136,.2);
  padding:6px 12px;border-radius:999px;cursor:pointer}
.note{color:var(--dim);font-size:12px;margin-top:14px}.note a{color:var(--brand)}
#out{margin-top:26px}
.verdict{display:inline-flex;align-items:center;gap:10px;margin-bottom:12px}
.badge{font-weight:800;font-size:13px;letter-spacing:.04em;padding:8px 14px;border-radius:10px;color:#fff}
.plain{font-size:19px;font-weight:650;line-height:1.4;margin-bottom:8px}
.summary{color:var(--dim);margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:14px 16px;margin-bottom:10px}
.card .top{display:flex;gap:9px;align-items:center;margin-bottom:6px;flex-wrap:wrap}
.pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:7px;color:#fff}
.yr{color:var(--dim);font-size:12px}.card .ti{font-weight:650;margin-bottom:4px}
.card .sn{color:var(--dim);font-size:14px;margin-bottom:8px}.card a{color:var(--brand);font-size:13px;font-weight:600;text-decoration:none}
.spin{display:inline-block;width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:s .7s linear infinite;vertical-align:-3px}
@keyframes s{to{transform:rotate(360deg)}}
.err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:14px 16px;border-radius:12px}
.foot{color:var(--dim);font-size:12px;margin-top:30px;text-align:center}
</style></head><body><div class="wrap">
<header><div class="logo">S</div><h1>Strata</h1></header>
<div class="tag">Ask a health question — get the honest answer, and how much to trust it.</div>
<div class="search"><input id="q" placeholder="e.g. Does vitamin D prevent colds?" autofocus/><button id="go">Check</button></div>
<div class="chips" id="chips"></div>
<div class="note">Reads public PubMed evidence. Not medical advice. Clinicians &amp; teams: see the <a href="/">Strata Console →</a></div>
<div id="out"></div>
<div class="foot">Strata · evidence-based, honest by design</div>
</div>
<script>
const $=s=>document.querySelector(s);
const EX=["Does vitamin D prevent colds?","Is intermittent fasting good for weight loss?","Does metformin help the heart?"];
const SB={high:'#16a34a',moderate:'#d97706',low:'#ea580c','very low':'#dc2626',none:'#9ca3af'};
const PLAIN={high:"Yes — the evidence is strong.",moderate:"Probably — the evidence is decent but not final.",
  low:"Maybe — the evidence is weak.","very low":"Unclear — there's very little good evidence.",none:"We don't know — no studies were found."};
const esc=s=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
$('#chips').innerHTML=EX.map(e=>`<span class="chip">${esc(e)}</span>`).join('');
$('#chips').onclick=e=>{if(e.target.classList.contains('chip')){$('#q').value=e.target.textContent;run();}};
$('#go').onclick=run;$('#q').addEventListener('keydown',e=>{if(e.key==='Enter')run();});
async function run(){const q=$('#q').value.trim();if(!q)return;
  $('#go').disabled=true;$('#go').innerHTML='<span class="spin"></span>';
  $('#out').innerHTML='<div class="summary">Reading the evidence…</div>';
  try{const d=await(await fetch('/api/ask?q='+encodeURIComponent(q))).json();
    if(d.error){$('#out').innerHTML=`<div class="err">${esc(d.error)}</div>`;return;}render(d);}
  catch(e){$('#out').innerHTML=`<div class="err">${esc(e.message||e)}</div>`;}
  finally{$('#go').disabled=false;$('#go').textContent='Check';}}
function render(d){let cards='';
  for(const s of d.sources){cards+=`<div class="card"><div class="top">
    <span class="pill" style="background:${s.color}">${esc(s.study_type)}</span>
    <span class="pill" style="background:${SB[s.strength]||'#9ca3af'}">${esc(s.strength)}</span>
    <span class="yr">${s.year||'n.d.'}${s.sample_size?' · n='+s.sample_size.toLocaleString():''}</span></div>
    <div class="ti">${esc(s.title)}</div><div class="sn">${esc(s.snippet)}</div>
    <a href="${s.url}" target="_blank">View on PubMed →</a></div>`;}
  $('#out').innerHTML=`<div class="verdict"><span class="badge" style="background:${SB[d.overall_strength]||'#9ca3af'}">${d.overall_strength.toUpperCase()} EVIDENCE</span></div>
    <div class="plain">${esc(PLAIN[d.overall_strength]||'')}</div>
    <div class="summary">${esc(d.summary)}</div>${cards}`;}
</script></body></html>"""

