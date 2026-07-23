"""Strata Console — the Evidence-Health dashboard.

The enterprise product surface. It answers one question a buyer actually pays for: *what
changed in our evidence base?* Everything on the page is live data from the claim-centered
API — ``/v1/console/summary``, ``/v1/claims``, ``/v1/changes``, ``/v1/claims/:id`` — with no
decorative charts: every number, bar, and timeline is computed from monitored claims and
their graded evidence history.

Layout: an Evidence-Health metric row, a "needs attention" queue, therapeutic-area and
status rollups, a live change feed, and a filterable claims table. Selecting a claim opens
its full dossier — the version timeline (evidence changing over time), the receipt with the
inspectable GRADE rationale and the contradiction analysis, the graded citations, and the
alert history. Standard library only; provisions its own API key when auth is on.
"""
from __future__ import annotations

DASHBOARD_HTML = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Strata Console · Evidence Health</title>
<style>
:root{--bg:#05080d;--bg2:#080d15;--panel:#0b1220;--panel2:#0f1828;--line:rgba(255,255,255,.08);
 --line2:rgba(255,255,255,.14);--ink:#eaf2f0;--dim:#9fb0ae;--faint:#6b7d7a;
 --green:#38e6a6;--amber:#ffc24b;--red:#ff5d73;--blue:#5cc8ff;--grey:#7c8a90;
 --l1:#16a34a;--l2:#22a06b;--l3:#d97706;--l4:#ea580c;--l5:#dc2626;--l6:#64748b;
 --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
 --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(120% 90% at 88% -20%,rgba(56,230,166,.06),transparent 55%),var(--bg);
 color:var(--ink);font-family:var(--sans);font-size:15px;-webkit-font-smoothing:antialiased;letter-spacing:-.01em}
a{color:inherit;text-decoration:none}.mono{font-family:var(--mono)}
.top{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:14px;padding:12px 24px;
 background:rgba(5,8,13,.86);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:10px;font-weight:800}
.logo .g{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#04140f;font-weight:900;
 background:linear-gradient(150deg,#68f0c0,var(--green))}
.logo .k{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--faint);text-transform:uppercase;
 border-left:1px solid var(--line2);padding-left:10px}
.top .sp{flex:1}.top a.lk{font-family:var(--mono);font-size:12px;color:var(--dim)}.top a.lk:hover{color:var(--ink)}
.wrap{max-width:1240px;margin:0 auto;padding:26px 24px 80px}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:22px}
.head h1{font-size:30px;font-weight:800;letter-spacing:-.03em}
.head .sub{color:var(--dim);font-size:15px;margin-top:6px}
.head .ten{text-align:right;font-family:var(--mono);font-size:12px;color:var(--faint)}
.head .ten b{color:var(--ink);font-size:14px;display:block}

.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:20px}
@media(max-width:1000px){.metrics{grid-template-columns:repeat(3,1fr)}}
@media(max-width:560px){.metrics{grid-template-columns:repeat(2,1fr)}}
.metric{background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid var(--line);border-radius:14px;padding:16px 16px 14px}
.metric .v{font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1}
.metric .l{font-size:12px;font-weight:600;color:var(--dim);margin-top:8px;display:flex;align-items:center;gap:6px}
.metric .l .d{width:8px;height:8px;border-radius:50%}
.grid2{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:900px){.grid2{grid-template-columns:1fr}}
.panel{background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid var(--line);border-radius:16px;overflow:hidden}
.ph{display:flex;align-items:center;justify-content:space-between;padding:15px 18px 0}
.ph h2{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.ph .hint{font-family:var(--mono);font-size:10px;color:var(--faint)}
.pb{padding:14px 18px 18px}

/* attention queue */
.aq{display:flex;flex-direction:column}
.arow{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:12px 18px;border-top:1px solid var(--line);cursor:pointer}
.arow:first-child{border-top:0}.arow:hover{background:rgba(255,255,255,.03)}
.sev{width:9px;height:9px;border-radius:50%;flex:none}
.arow .c{font-size:14px;font-weight:600;line-height:1.3}
.arow .m{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}
.trend{font-family:var(--mono);font-size:12px;font-weight:800;padding:4px 9px;border-radius:7px;white-space:nowrap}
.badgeN{font-family:var(--mono);font-size:11px;font-weight:800;color:#04140f;border-radius:7px;padding:3px 8px}

/* areas + status */
.arow2{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.arow2 .nm{width:150px;font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arow2 .bar{flex:1;height:8px;border-radius:6px;background:var(--panel2);overflow:hidden}
.arow2 .fill{height:100%;background:linear-gradient(90deg,#2bb98a,var(--green))}
.arow2 .v{font-family:var(--mono);font-size:12px;color:var(--dim);width:80px;text-align:right}
.statrow{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:13px}
.statrow .sw{width:11px;height:11px;border-radius:3px}
.statrow .n{margin-left:auto;font-family:var(--mono);font-weight:700}

/* change feed */
.feed{display:flex;flex-direction:column;max-height:420px;overflow-y:auto}
.fitem{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:12px 18px;border-top:1px solid var(--line)}
.fitem:first-child{border-top:0}
.fitem .h{font-size:13px;font-weight:700;line-height:1.3}
.fitem .m{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:4px}
.fitem .cl{font-size:12px;color:var(--dim);margin-top:4px}
.chip{font-family:var(--mono);font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;color:#04140f}

/* claims table */
.tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line)}
.tools select,.tools input{background:var(--panel2);border:1px solid var(--line2);border-radius:9px;color:var(--ink);
 font-size:13px;padding:8px 11px;font-family:inherit}
.tools input{flex:1;min-width:160px}
.tools .toggle{font-family:var(--mono);font-size:12px;font-weight:700;color:var(--dim);border:1px solid var(--line2);
 border-radius:9px;padding:8px 12px;cursor:pointer}
.tools .toggle.on{color:var(--green);border-color:var(--green);background:rgba(56,230,166,.06)}
.ctbl{width:100%;border-collapse:collapse}
.ctbl th{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);
 text-align:left;padding:11px 18px;border-bottom:1px solid var(--line);font-weight:700}
.ctbl td{padding:13px 18px;border-bottom:1px solid var(--line);font-size:14px;vertical-align:middle}
.ctbl tr{cursor:pointer}.ctbl tbody tr:hover{background:rgba(255,255,255,.03)}
.ctbl .claimc{font-weight:600;max-width:420px}
.ctbl .areac{font-size:12px;color:var(--dim)}
.stbadge{font-family:var(--mono);font-size:11px;font-weight:800;padding:4px 9px;border-radius:7px;color:#04140f;white-space:nowrap}
.stpill{font-size:12px;font-weight:700;text-transform:capitalize}
.tri{font-weight:800;font-family:var(--mono);font-size:13px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:1px}
.empty{padding:30px 18px;text-align:center;color:var(--faint);font-family:var(--mono);font-size:12px}

/* drawer */
.scrim{position:fixed;inset:0;background:rgba(2,4,8,.72);opacity:0;pointer-events:none;transition:.22s;z-index:60}
.scrim.on{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100%;width:min(760px,96vw);background:var(--bg2);border-left:1px solid var(--line2);
 transform:translateX(100%);transition:transform .26s cubic-bezier(.3,.9,.3,1);z-index:70;overflow-y:auto;box-shadow:-30px 0 80px -40px #000}
.drawer.on{transform:none}
.dh{position:sticky;top:0;background:rgba(8,13,21,.94);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);
 padding:18px 22px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;z-index:2}
.dh .q{font-size:12px;font-family:var(--mono);color:var(--faint)}
.dh .t{font-size:18px;font-weight:800;line-height:1.3;margin-top:4px;letter-spacing:-.01em}
.dh .x{background:transparent;border:1px solid var(--line2);color:var(--ink);border-radius:9px;width:34px;height:34px;
 cursor:pointer;font-size:18px;flex:none}
.db{padding:20px 22px 60px}
.sec{margin-top:22px}.sec:first-child{margin-top:0}
.sec .lab{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:12px}
.vbig{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.vbig .status{font-size:34px;font-weight:900;letter-spacing:-.03em;line-height:1}
.vbig .cert{font-family:var(--mono);font-size:12px;font-weight:700;border:1px solid var(--line2);border-radius:8px;padding:6px 10px;color:var(--ink)}
.split{height:12px;border-radius:7px;overflow:hidden;display:flex;background:var(--panel2);margin:16px 0 8px}
.split .s{background:var(--green)}.split .c{background:var(--red)}.split .n{background:#2b3742}
.slab{display:flex;gap:16px;font-family:var(--mono);font-size:12px;font-weight:700}
.slab .s{color:var(--green)}.slab .c{color:var(--red)}.slab .n{color:var(--dim)}
.pico{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.pico .p{font-size:12px;border:1px solid var(--line);border-radius:20px;padding:6px 11px;color:var(--ink)}
.pico .p b{color:var(--green);font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;margin-right:6px}
/* timeline */
.tl{display:flex;gap:0;align-items:stretch;overflow-x:auto;padding-bottom:6px}
.tln{flex:1;min-width:120px;position:relative;padding:2px 12px}
.tln:not(:last-child)::after{content:"";position:absolute;top:26px;right:-6px;width:12px;height:2px;background:var(--line2)}
.tln .ver{font-family:var(--mono);font-size:10px;color:var(--faint)}
.tln .dt{font-family:var(--mono);font-size:11px;color:var(--dim);margin:3px 0 8px}
.tln .pill{display:inline-block;font-size:12px;font-weight:800;padding:5px 10px;border-radius:8px;color:#04140f}
.tln .str{font-size:11px;color:var(--dim);margin-top:6px;text-transform:capitalize}
.tln .chg{font-size:11px;color:var(--amber);margin-top:6px;line-height:1.35}
/* grade rationale */
.dims{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 16px;margin-bottom:14px}
@media(max-width:560px){.dims{grid-template-columns:repeat(2,1fr)}}
.dim{}
.dim .dn{font-size:11px;color:var(--dim);display:flex;justify-content:space-between;margin-bottom:4px}
.dim .dn b{font-family:var(--mono);text-transform:capitalize}
.dim .db2{height:6px;border-radius:4px;background:var(--panel2);overflow:hidden}
.dim .df{height:100%;border-radius:4px}
.reasons{display:flex;flex-direction:column;gap:6px}
.rz{display:grid;grid-template-columns:16px 1fr;gap:9px;font-size:13px;line-height:1.4;align-items:baseline}
.rz .sg{font-family:var(--mono);font-weight:800}
.contra{border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:10px;background:rgba(255,93,115,.04)}
.contra .t{font-weight:700;font-size:14px;margin-bottom:6px}
.contra .e{font-size:13px;color:var(--dim);line-height:1.5}
.contra .ex{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:8px;display:flex;flex-direction:column;gap:3px}
.cites{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.cite{display:grid;grid-template-columns:auto 1fr auto;gap:11px;align-items:baseline;padding:11px 14px;border-top:1px solid var(--line)}
.cite:first-child{border-top:0}.cite .tg{font-family:var(--mono);font-weight:800;font-size:13px}
.cite .ti{font-size:13px;font-weight:600;line-height:1.35}
.cite .mt{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:3px;display:flex;gap:7px;flex-wrap:wrap}
.pillL{font-family:var(--mono);font-size:9px;font-weight:700;padding:2px 6px;border-radius:5px;color:#fff}
.cite a{font-family:var(--mono);font-size:11px;color:var(--green);white-space:nowrap;font-weight:700}
.alist{display:flex;flex-direction:column;gap:8px}
.al{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.al .h{font-size:13px;font-weight:700}.al .m{font-size:12px;color:var(--dim);margin-top:2px}
.al .dt{font-family:var(--mono);font-size:10px;color:var(--faint)}
.rl{background:transparent;border:1px solid var(--line2);color:var(--ink);border-radius:8px;padding:7px 12px;
 font-family:var(--mono);font-size:12px;font-weight:700;cursor:pointer}
.rl:hover{border-color:var(--green);color:var(--green)}
.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--green);border-top-color:transparent;border-radius:50%;animation:sp .7s linear infinite;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
.err{background:rgba(255,93,115,.08);border:1px solid rgba(255,93,115,.3);color:#ff9aa8;padding:14px 16px;border-radius:12px;font-size:14px;margin-top:16px}
.foot{text-align:center;color:var(--faint);font-family:var(--mono);font-size:11px;margin-top:34px;line-height:1.8}
@media (prefers-reduced-motion:reduce){*{animation-duration:.001s!important;transition:none!important}}
</style></head><body>
<div class="top"><a class="logo" href="/"><span class="g">S</span> Strata <span class="k">Console</span></a>
 <span class="sp"></span><span class="mono" id="tn" style="font-size:11px;color:var(--faint)"></span>
 <a class="lk" href="/search">Search</a><a class="lk" href="/app">Verify</a><a class="lk" href="/docs">API</a><a class="lk" href="/">Home</a></div>
<div class="wrap">
  <div class="head">
    <div><h1>Evidence Health</h1><div class="sub" id="sub">Loading your evidence base…</div></div>
    <div class="ten"><b id="tenant">—</b><span id="wsname"></span></div>
  </div>
  <div id="app"><div style="padding:40px;text-align:center"><span class="spin"></span></div></div>
  <div class="foot">Strata monitors published literature for decision support. Not a medical device. No patient data. No diagnosis.<br>
    Evidence assessments are transparent heuristics — read the cited sources.</div>
</div>
<div class="scrim" id="scrim" onclick="closeDrawer()"></div>
<div class="drawer" id="drawer"><div id="drawerBody"></div></div>
<script>
const $=(s,r=document)=>r.querySelector(s);
const SC={Supported:'#38e6a6',Mixed:'#ffc24b',Contested:'#ffc24b',Contradicted:'#ff5d73',Insufficient:'#7c8a90',Unsupported:'#7c8a90',null:'#7c8a90'};
const STC={high:'#38e6a6',moderate:'#ffc24b',low:'#ff9a4b','very low':'#ff5d73',none:'#7c8a90'};
const SEV={red:'#ff5d73',amber:'#ffc24b',green:'#38e6a6',null:'#7c8a90'};
const SORD={'very low':0.25,low:0.5,moderate:0.75,high:1};
const LC={1:'#16a34a',2:'#22a06b',3:'#d97706',4:'#ea580c',5:'#dc2626',6:'#64748b'};
const LN={1:'Meta-analysis',2:'Randomized trial',3:'Cohort',4:'Observational',5:'Case report',6:'Review'};
const SRC={pubmed:'PubMed',europepmc:'Europe PMC',openalex:'OpenAlex',crossref:'Crossref',clinicaltrials:'ClinicalTrials.gov'};
const GLY={support:['▲','#38e6a6'],contradict:['▼','#ff5d73'],neutral:['●','#7c8a90']};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;
const fdate=s=>s?String(s).slice(0,10):'';
let AUTH=false, KEY=null, CLAIMS=[], SUMMARY=null;

async function api(path,opts){
  const h=(opts&&opts.headers)||{}; if(KEY)h['Authorization']='Bearer '+KEY;
  const r=await fetch(path,Object.assign({},opts,{headers:h}));
  if(r.status===401){throw new Error('This server requires an API key.');}
  return r.json();
}
async function ensureKey(){if(!AUTH||KEY)return;try{KEY=(await(await fetch('/v1/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"label":"console"}'})).json()).key;}catch(e){}}

(async function init(){
  try{const h=await(await fetch('/v1/health')).json();AUTH=!!h.auth;
    $('#tn').textContent=(h.sources||[]).length?('sources · '+(h.sources||[]).join(' · ')):'';}catch(e){}
  await ensureKey();
  try{
    SUMMARY=await api('/v1/console/summary');
    CLAIMS=(await api('/v1/claims')).claims||[];
    const changes=(await api('/v1/changes?limit=40')).changes||[];
    render(SUMMARY,CLAIMS,changes);
  }catch(e){$('#app').innerHTML='<div class="err">'+esc(e.message||e)+' Generate a key at <a href="/app">/app</a> or run Strata in open mode.</div>';}
})();

function metric(v,label,color,dot){return `<div class="metric"><div class="v" style="color:${color||'var(--ink)'}">${v}</div>
  <div class="l">${dot?`<span class="d" style="background:${dot}"></span>`:''}${label}</div></div>`;}

function render(s,claims,changes){
  const tenant=(claims[0]&&claims[0].tenant)||'Your organization';
  $('#tenant').textContent=tenant;$('#wsname').textContent=(s.by_area||[]).length+' therapeutic areas';
  $('#sub').innerHTML=`<b>${s.claims_monitored}</b> claims monitored · <b>${s.open_alerts}</b> open alerts · what changed since the last check`;
  const areas=(s.by_area||[]).slice().sort((a,b)=>b.claims-a.claims);
  const amax=Math.max(1,...areas.map(a=>a.claims));
  const statuses=Object.entries(s.by_status||{}).sort((a,b)=>b[1]-a[1]);
  const stot=statuses.reduce((x,e)=>x+e[1],0)||1;
  $('#app').innerHTML=`
   <div class="metrics">
     ${metric(s.claims_monitored,'Claims monitored')}
     ${metric('↑ '+s.strengthened,'Strengthened','var(--green)','var(--green)')}
     ${metric('↓ '+s.weakened,'Weakened',s.weakened?'var(--red)':'var(--ink)','var(--red)')}
     ${metric('⚠ '+s.newly_contradicted,'Newly contradicted',s.newly_contradicted?'var(--amber)':'var(--ink)','var(--amber)')}
     ${metric('● '+s.new_studies,'New studies','var(--blue)','var(--blue)')}
     ${metric(s.open_alerts,'Open alerts',s.open_alerts?'var(--amber)':'var(--ink)')}
   </div>
   <div class="grid2">
     <div class="panel"><div class="ph"><h2>Needs attention</h2><span class="hint">worst first</span></div>
       <div class="aq" id="aq"></div></div>
     <div class="panel"><div class="ph"><h2>Change feed</h2><span class="hint">${changes.length} events</span></div>
       <div class="feed" id="feed"></div></div>
   </div>
   <div class="grid2">
     <div class="panel"><div class="ph"><h2>Therapeutic areas</h2><span class="hint">activity</span></div>
       <div class="pb">${areas.map(a=>`<div class="arow2"><span class="nm">${esc(a.name||'Unassigned')}</span>
         <span class="bar"><span class="fill" style="width:${Math.round(100*a.claims/amax)}%"></span></span>
         <span class="v">${a.claims} · ${a.changed}▲</span></div>`).join('')||'<div class="empty">No areas</div>'}</div></div>
     <div class="panel"><div class="ph"><h2>Status mix</h2><span class="hint">${stot} claims</span></div>
       <div class="pb">${statuses.map(([k,v])=>`<div class="statrow"><span class="sw" style="background:${SC[k]||'#7c8a90'}"></span>
         <span>${esc(k)}</span><span class="n" style="color:${SC[k]||'#7c8a90'}">${v}</span></div>
         <div class="arow2" style="margin-bottom:12px"><span class="bar"><span class="fill" style="width:${Math.round(100*v/stot)}%;background:${SC[k]||'#7c8a90'}"></span></span></div>`).join('')||'<div class="empty">No claims</div>'}</div></div>
   </div>
   <div class="panel">
     <div class="ph"><h2>Monitored claims</h2><span class="hint" id="ccount"></span></div>
     <div class="tools">
       <select id="fArea"><option value="">All areas</option>${areas.map(a=>`<option value="${esc(a.area_id||'')}">${esc(a.name||'Unassigned')}</option>`).join('')}</select>
       <select id="fStatus"><option value="">Any status</option>${['Supported','Mixed','Contradicted','Insufficient','Unsupported'].map(x=>`<option>${x}</option>`).join('')}</select>
       <select id="fStrength"><option value="">Any strength</option>${['high','moderate','low','very low'].map(x=>`<option>${x}</option>`).join('')}</select>
       <span class="toggle" id="fChanged">● changed only</span>
       <input id="fText" placeholder="Search claims…"/>
     </div>
     <table class="ctbl"><thead><tr><th>Claim</th><th>Status</th><th>Strength</th><th>Trend</th><th>Evidence</th><th>Alerts</th><th>v</th></tr></thead>
       <tbody id="rows"></tbody></table>
   </div>`;
  renderAttention(s.attention||[]);
  renderFeed(changes);
  ['fArea','fStatus','fStrength','fText'].forEach(id=>{const el=$('#'+id);el.oninput=el.onchange=applyFilters;});
  $('#fChanged').onclick=()=>{$('#fChanged').classList.toggle('on');applyFilters();};
  applyFilters();
}

function renderAttention(list){
  $('#aq').innerHTML=list.length?list.map(c=>{const col=SC[c.status]||'#7c8a90';
    const tri=c.trend==='down'?['↓','var(--red)']:c.trend==='up'?['↑','var(--green)']:['→','var(--faint)'];
    return `<div class="arow" onclick="openClaim('${esc(c.id)}')">
      <span class="sev" style="background:${SEV[c.top_severity]||'#7c8a90'}"></span>
      <div><div class="c">${esc(c.claim)}</div><div class="m"><span style="color:${col}">${esc(c.status||'')}</span>
        <span>${esc(c.area||'Unassigned')}</span>${c.open_alerts?`<span style="color:var(--amber)">${c.open_alerts} alert${c.open_alerts>1?'s':''}</span>`:''}</div></div>
      <span class="trend" style="color:${tri[1]}">${tri[0]} ${esc(c.strength||'')}</span></div>`;}).join('')
    :'<div class="empty">Nothing needs attention. Every monitored claim is stable.</div>';
}
function renderFeed(changes){
  $('#feed').innerHTML=changes.length?changes.map(a=>`<div class="fitem">
    <span class="chip" style="background:${SEV[a.severity]||'#7c8a90'}">${esc((a.type||'').replace(/_/g,' '))}</span>
    <div><div class="h">${esc(a.headline)}</div><div class="cl">${esc(a.claim||'')}</div>
      <div class="m">${fdate(a.created)}${a.evidence&&a.evidence.title?' · '+esc((a.evidence.title||'').slice(0,60)):''}</div></div></div>`).join('')
    :'<div class="empty">No changes recorded yet.</div>';
}
function applyFilters(){
  const a=$('#fArea').value,st=$('#fStatus').value,str=$('#fStrength').value,
    txt=$('#fText').value.trim().toLowerCase(),chg=$('#fChanged').classList.contains('on');
  const rows=CLAIMS.filter(c=>(!a||c.area_id===a)&&(!st||c.status===st)&&(!str||c.strength===str)
    &&(!chg||c.evidence_changed)&&(!txt||(c.claim||'').toLowerCase().includes(txt)));
  $('#ccount').textContent=rows.length+' of '+CLAIMS.length;
  $('#rows').innerHTML=rows.length?rows.map(c=>{const col=SC[c.status]||'#7c8a90';
    const tri=c.trend==='down'?['↓','var(--red)']:c.trend==='up'?['↑','var(--green)']:['→','var(--faint)'];
    return `<tr onclick="openClaim('${esc(c.id)}')">
      <td class="claimc">${c.evidence_changed?'<span class="dot" style="background:var(--amber)"></span>':''}${esc(c.claim)}
        <div class="areac">${esc(c.area||'Unassigned')}</div></td>
      <td><span class="stbadge" style="background:${col}">${esc(c.status||'—')}</span></td>
      <td><span class="stpill" style="color:${STC[c.strength]||'#7c8a90'}">${esc(c.strength||'—')}</span></td>
      <td><span class="tri" style="color:${tri[1]}">${tri[0]}</span></td>
      <td class="mono" style="font-size:12px"><span style="color:var(--green)">▲${c.supporting||0}</span> <span style="color:var(--red)">▼${c.contradicting||0}</span></td>
      <td>${c.open_alerts?`<span class="badgeN" style="background:${SEV[c.top_severity]||'#7c8a90'}">${c.open_alerts}</span>`:'<span class="mono" style="color:var(--faint)">0</span>'}</td>
      <td class="mono" style="color:var(--dim)">${c.version||1}</td></tr>`;}).join('')
    :'<tr><td colspan="7" class="empty">No claims match these filters.</td></tr>';
}

/* ---------- claim dossier drawer ---------- */
async function openClaim(id){
  $('#scrim').classList.add('on');$('#drawer').classList.add('on');
  $('#drawerBody').innerHTML='<div style="padding:60px;text-align:center"><span class="spin"></span></div>';
  let d;try{d=await api('/v1/claims/'+encodeURIComponent(id));}catch(e){$('#drawerBody').innerHTML='<div class="db"><div class="err">'+esc(e.message||e)+'</div></div>';return;}
  if(d.error){$('#drawerBody').innerHTML='<div class="db"><div class="err">'+esc(d.error)+'</div></div>';return;}
  $('#drawerBody').innerHTML=dossier(d);
}
function closeDrawer(){$('#scrim').classList.remove('on');$('#drawer').classList.remove('on');}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});

function dossier(d){
  const c=d.claim,r=d.receipt||{},col=SC[r.status]||'#7c8a90';
  const t=Math.max(1,(r.supporting||0)+(r.contradicting||0)+(r.neutral||0)),w=n=>Math.round(100*(n||0)/t);
  const pico=r.pico||{};
  const picoH=[['Population',pico.population],['Intervention',pico.intervention],['Comparator',pico.comparator],['Outcome',pico.outcome]]
    .filter(x=>x[1]).map(x=>`<span class="p"><b>${x[0]}</b>${esc(x[1])}</span>`).join('');
  return `<div class="dh"><div><div class="q">${esc(c.area||'Unassigned')} · v${c.version} · checked ${fdate(r.checked)}</div>
      <div class="t">${esc(c.claim)}</div></div>
      <button class="x" onclick="closeDrawer()">×</button></div>
    <div class="db">
      <div class="vbig"><span class="status" style="color:${col}">${esc((r.status||'—').toUpperCase())}</span>
        <span class="cert">${esc((r.strength||'—').toUpperCase())} · ${Math.round((r.confidence||0)*100)}% CONFIDENCE</span>
        ${r.claim_status?`<span class="stbadge" style="background:${col}">${esc(r.claim_status)}</span>`:''}</div>
      <div class="split"><span class="s" style="width:${w(r.supporting)}%"></span><span class="c" style="width:${w(r.contradicting)}%"></span><span class="n" style="width:${w(r.neutral)}%"></span></div>
      <div class="slab"><span class="s">${r.supporting||0} supporting</span><span class="c">${r.contradicting||0} contradicting</span><span class="n">${r.neutral||0} neutral</span></div>
      ${picoH?`<div class="pico">${picoH}</div>`:''}
      <div style="margin-top:16px"><button class="rl" onclick="recheck('${esc(c.id)}',this)">↻ Re-check now</button></div>

      <div class="sec"><div class="lab">Evidence timeline</div>${timeline(d.timeline||[])}</div>
      ${gradeSec(r.strength_rationale)}
      ${contraSec(r.contradiction)}
      <div class="sec"><div class="lab">Graded evidence · ${(r.citations||[]).length} studies</div>
        <div class="cites">${(r.citations||[]).map(citeRow).join('')||'<div class="empty">No citations</div>'}</div></div>
      ${alertsSec(d.alerts||[])}
    </div>`;
}
function timeline(tl){
  if(!tl.length)return '<div class="empty">No history yet.</div>';
  return `<div class="tl">${tl.map(x=>{const col=SC[x.status]||'#7c8a90';
    return `<div class="tln"><div class="ver">VERSION ${x.version}</div><div class="dt">${fdate(x.checked)}</div>
      <span class="pill" style="background:${col}">${esc(x.status||'—')}</span>
      <div class="str">${esc(x.strength||'')} · ▲${x.supporting||0} ▼${x.contradicting||0}</div>
      ${x.changed&&x.headline?`<div class="chg">${esc(x.headline)}</div>`:''}</div>`;}).join('')}</div>`;
}
function gradeSec(g){
  if(!g||!g.dimensions)return '';
  const order=['study_design','consistency','directness','precision','recency','replication'];
  const dims=order.filter(k=>g.dimensions[k]).map(k=>{const v=g.dimensions[k],p=Math.round((SORD[v]||0.5)*100);
    return `<div class="dim"><div class="dn">${cap(k.replace('_',' '))}<b style="color:${STC[v]||'#7c8a90'}">${esc(v)}</b></div>
      <div class="db2"><div class="df" style="width:${p}%;background:${STC[v]||'#7c8a90'}"></div></div></div>`;}).join('');
  const facs=(g.factors||[]).map(f=>`<div class="rz"><span class="sg" style="color:var(--green)">+</span><span>${esc(f.text)}</span></div>`).join('');
  const lims=(g.limitations||[]).map(l=>`<div class="rz"><span class="sg" style="color:var(--amber)">−</span><span>${esc(l.text)}</span></div>`).join('');
  return `<div class="sec"><div class="lab">Why this grade · ${esc(g.grade||'')}</div>
    <div style="font-size:13px;color:var(--dim);margin-bottom:12px">${esc(g.summary||'')}</div>
    <div class="dims">${dims}</div><div class="reasons">${facs}${lims}</div></div>`;
}
function contraSec(c){
  if(!c||!c.reasons||!c.reasons.length)return c&&c.note?`<div class="sec"><div class="lab">Contradiction analysis</div>
    <div style="font-size:13px;color:var(--dim)">${esc(c.note)}</div></div>`:'';
  return `<div class="sec"><div class="lab">Why the studies disagree · ${c.supporting}▲ vs ${c.contradicting}▼</div>
    ${c.reasons.map(r=>`<div class="contra"><div class="t">${esc(r.title)}</div><div class="e">${esc(r.explanation)}</div>
      <div class="ex">${r.support_example?`▲ ${esc((r.support_example.label||'')+': '+(r.support_example.title||'')).slice(0,90)}`:''}
        ${r.contradict_example?`▼ ${esc((r.contradict_example.label||'')+': '+(r.contradict_example.title||'')).slice(0,90)}`:''}</div></div>`).join('')}</div>`;
}
function citeRow(c){const g=GLY[c.stance]||GLY.neutral;
  const eff=c.effect&&c.effect.value!=null?`${c.effect.measure} ${Number(c.effect.value).toFixed(2)}`:'';
  return `<div class="cite"><span class="tg" style="color:${g[1]}">${g[0]}</span>
    <div><div class="ti">${esc(c.title)}</div><div class="mt"><span class="pillL" style="background:${LC[c.level]||'#64748b'}">${esc(c.label||'')}</span>
      <span>${c.year||''} ${eff?'· '+esc(eff):''} · ${esc(SRC[c.source]||c.source||'')}</span></div></div>
    <a href="${esc(c.url||'#')}" target="_blank" rel="noopener">${c.source==='clinicaltrials'?'Trial':'Source'} ↗</a></div>`;}
function alertsSec(al){
  if(!al.length)return '';
  return `<div class="sec"><div class="lab">Alerts · ${al.length}</div><div class="alist">${al.map(a=>`<div class="al">
    <span class="sev" style="background:${SEV[a.severity]||'#7c8a90'}"></span>
    <div><div class="h">${esc(a.headline)}</div><div class="m">${esc(a.detail||'')}</div></div>
    <span class="dt">${fdate(a.created)}${a.acknowledged?' · ack':''}</span></div>`).join('')}</div></div>`;
}
async function recheck(id,btn){btn.disabled=true;btn.innerHTML='<span class="spin"></span> checking';
  try{await api('/v1/claims/'+encodeURIComponent(id)+'/recheck',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    await openClaim(id);
    SUMMARY=await api('/v1/console/summary');CLAIMS=(await api('/v1/claims')).claims||[];
    renderAttention(SUMMARY.attention||[]);applyFilters();
  }catch(e){btn.disabled=false;btn.textContent='↻ Re-check now';}
}
</script></body></html>"""
