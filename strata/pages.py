"""Served HTML surfaces, standard library only, zero external dependencies.

* ``CONSOLE_HTML`` — Strata Console, the B2B surface: a dark 'mission-control' dashboard
  for a hospital / health-system evidence team. A live 3-D anatomical model pinpoints
  where a body of evidence acts, beside a forest plot, a living-evidence accumulation
  curve, a PRISMA flow, a GRADE-style certainty gauge, and a surveillance timeline.
* ``LITE_HTML`` — Strata Lite, the simple B2C surface: ask one question, get the honest
  graded answer. The 'dumbed-down' view.

Everything is inlined — no CDNs, no fonts to fetch, no libraries. The Console deliberately
commits to a single dark instrument aesthetic; it is a control room, not a document.
All visuals are hand-drawn on Canvas / SVG so the app stays dependency-free and works on a
locked-down hospital network or fully offline in demo mode.
"""
from __future__ import annotations

# The console is data-driven: it fetches /api/reviews and /api/review and renders. No
# server-side templating, so the page is a static constant.
CONSOLE_HTML = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Strata Console — living evidence intelligence</title>
<style>
:root{
  --bg:#060c0e; --bg-2:#0a1315; --panel:#0c181a; --panel-2:#0f2023; --raise:#12282b;
  --line:#193034; --line-2:#22454a; --ink:#e8f2f0; --dim:#8ba39f; --faint:#5d7573;
  --accent:#2dd4bf; --accent-2:#38bdf8; --accent-ink:#8ff3e8;
  --high:#22c55e; --moderate:#f59e0b; --low:#fb7139; --vlow:#f2564a; --none:#5f7573;
  --l1:#16a34a; --l2:#1f9e6b; --l3:#d97706; --l4:#ea580c; --l5:#dc2626; --l6:#64748b;
  --mono:ui-monospace,"SF Mono","JetBrains Mono","Cascadia Code",Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --glow:0 0 0 1px var(--line),0 18px 46px -22px rgba(0,0,0,.9);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:
    radial-gradient(120% 90% at 82% -10%,rgba(45,212,191,.08),transparent 55%),
    radial-gradient(90% 70% at 0% 0%,rgba(56,189,248,.06),transparent 50%),
    var(--bg);
  color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.5;
  -webkit-font-smoothing:antialiased}
.mono{font-family:var(--mono)}
a{color:var(--accent);text-decoration:none}
::selection{background:rgba(45,212,191,.28)}

/* ---------- top bar ---------- */
.topbar{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:16px;
  padding:11px 20px;background:rgba(6,12,14,.82);backdrop-filter:blur(12px) saturate(1.3);
  border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:11px;white-space:nowrap}
.logo{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#03110f;
  font-weight:800;font-size:17px;background:linear-gradient(150deg,var(--accent-2),var(--accent));
  box-shadow:0 0 18px -2px rgba(45,212,191,.5)}
.brand b{font-size:15px;letter-spacing:.02em}
.brand .k{font-family:var(--mono);font-size:10px;letter-spacing:.22em;color:var(--faint);
  text-transform:uppercase;border-left:1px solid var(--line-2);padding-left:11px;margin-left:2px}
.tenant{font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:.04em}
.tenant b{color:var(--accent-ink);font-weight:600}
.spacer{flex:1}
.tgl{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;
  color:var(--dim);letter-spacing:.05em;cursor:pointer;user-select:none}
.switch{width:34px;height:19px;border-radius:20px;background:var(--panel-2);border:1px solid var(--line-2);
  position:relative;transition:.2s}
.switch::after{content:"";position:absolute;top:1.5px;left:1.5px;width:14px;height:14px;border-radius:50%;
  background:var(--dim);transition:.2s}
.tgl.on .switch{background:rgba(45,212,191,.3);border-color:var(--accent)}
.tgl.on .switch::after{transform:translateX(15px);background:var(--accent)}
.btn{font-family:var(--mono);font-size:12px;letter-spacing:.04em;color:#04120f;font-weight:600;
  background:linear-gradient(180deg,var(--accent),#12b5a3);border:0;border-radius:9px;
  padding:8px 15px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;
  box-shadow:0 0 20px -6px rgba(45,212,191,.7)}
.btn.ghost{background:transparent;color:var(--dim);border:1px solid var(--line-2);box-shadow:none}
.btn:disabled{opacity:.55;cursor:default}
.btn .sp{width:12px;height:12px;border:2px solid #04120f;border-top-color:transparent;border-radius:50%;
  animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* ---------- shell ---------- */
.shell{display:grid;grid-template-columns:250px 1fr;min-height:calc(100vh - 53px)}
@media(max-width:900px){.shell{grid-template-columns:1fr}.rail{display:none}}
.rail{border-right:1px solid var(--line);padding:16px 12px;background:linear-gradient(180deg,var(--bg-2),transparent)}
.rail h3{font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;
  color:var(--faint);margin:6px 8px 12px;display:flex;justify-content:space-between}
.rev{display:block;width:100%;text-align:left;background:transparent;border:1px solid transparent;
  border-radius:11px;padding:11px 12px;margin-bottom:6px;cursor:pointer;color:var(--ink)}
.rev:hover{background:var(--panel)}
.rev.sel{background:var(--panel-2);border-color:var(--line-2);box-shadow:inset 2px 0 0 var(--accent)}
.rev .t{font-size:13px;font-weight:600;line-height:1.3;margin-bottom:7px}
.rev .m{display:flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10.5px;color:var(--faint)}
.dotc{width:8px;height:8px;border-radius:50%;flex:none}
.nw{font-family:var(--mono);font-size:9.5px;font-weight:700;color:#04120f;background:var(--accent);
  border-radius:20px;padding:1px 7px;letter-spacing:.02em}

.main{padding:20px 22px 40px;min-width:0}
.grid{display:grid;gap:16px}

/* ---------- panels ---------- */
.panel{background:linear-gradient(180deg,var(--panel),var(--bg-2));border:1px solid var(--line);
  border-radius:16px;box-shadow:var(--glow);position:relative;overflow:hidden}
.phead{display:flex;align-items:center;justify-content:space-between;padding:13px 16px 0}
.phead h2{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--dim);font-weight:600;display:flex;align-items:center;gap:9px}
.phead .hint{font-family:var(--mono);font-size:10px;color:var(--faint);letter-spacing:.03em}
.pmark{display:flex;flex-direction:column;gap:2px;width:13px}
.pmark i{height:2px;border-radius:2px;display:block}
.pmark i:nth-child(1){width:55%;background:var(--high)}
.pmark i:nth-child(2){width:78%;background:var(--moderate)}
.pmark i:nth-child(3){width:100%;background:var(--vlow)}

/* hero */
.hero{display:grid;grid-template-columns:1.15fr .85fr;gap:16px}
@media(max-width:1080px){.hero{grid-template-columns:1fr}}
.bodywrap{position:relative;min-height:430px}
#body{display:block;width:100%;height:430px}
.bodytag{position:absolute;left:16px;bottom:14px;font-family:var(--mono);font-size:10.5px;
  color:var(--faint);letter-spacing:.04em;max-width:60%}
.scan{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(180deg,transparent 0 48%,rgba(45,212,191,.06) 50%,transparent 52% 100%);
  mix-blend-mode:screen;opacity:.0}
.bodywrap.syncing .scan{animation:scan 1.5s ease-in-out infinite;opacity:1}
@keyframes scan{0%{transform:translateY(-46%)}100%{transform:translateY(46%)}}

.verdict{padding:16px}
.vq{font-size:12px;color:var(--dim);margin-bottom:4px}
.vtitle{font-size:19px;font-weight:700;letter-spacing:-.01em;line-height:1.22;margin-bottom:14px;text-wrap:balance}
.gaugerow{display:flex;align-items:center;gap:16px;margin-bottom:12px}
#gauge{width:150px;height:92px;flex:none}
.gtext .lab{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.gtext .val{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.1;text-transform:capitalize}
.gtext .sub{font-size:12px;color:var(--dim);margin-top:2px}
.summary{font-size:13px;color:var(--dim);line-height:1.55;border-top:1px solid var(--line);padding-top:12px}
.surv{margin-top:12px;border:1px solid var(--line-2);border-radius:12px;padding:11px 13px;
  background:rgba(45,212,191,.05)}
.surv .h{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--accent);display:flex;align-items:center;gap:8px;margin-bottom:7px}
.surv .h .pd{width:7px;height:7px;border-radius:50%;background:var(--accent);
  box-shadow:0 0 0 0 var(--accent);animation:pp 2.2s infinite}
@keyframes pp{0%{box-shadow:0 0 0 0 rgba(45,212,191,.5)}70%,100%{box-shadow:0 0 0 8px transparent}}
.surv ul{list-style:none;display:flex;flex-direction:column;gap:5px}
.surv li{font-size:12px;color:var(--ink);display:flex;gap:8px;line-height:1.4}
.surv li .yb{font-family:var(--mono);font-size:10px;color:var(--accent);flex:none;margin-top:1px}
.surv.calm{background:transparent}.surv.calm .h{color:var(--dim)}.surv.calm .h .pd{background:var(--dim);animation:none}

/* metrics */
.tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
@media(max-width:1080px){.tiles{grid-template-columns:repeat(3,1fr)}}
@media(max-width:560px){.tiles{grid-template-columns:repeat(2,1fr)}}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:13px 14px}
.tile .n{font-size:24px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.tile .l{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-top:3px}

/* charts row */
.charts{display:grid;grid-template-columns:1.15fr 1fr;gap:16px}
@media(max-width:1080px){.charts{grid-template-columns:1fr}}
.pbody{padding:14px 16px 16px}
#curve{display:block;width:100%;height:210px}
.forest{padding:6px 10px 14px}
.axis{font-family:var(--mono);font-size:10px;fill:var(--faint)}
.frow .lab{font-family:var(--mono);font-size:10.5px;fill:var(--dim)}
.legend{display:flex;gap:14px;flex-wrap:wrap;padding:0 16px 14px;font-family:var(--mono);font-size:10px;color:var(--faint)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:9px;height:9px;border-radius:2px;display:inline-block}

/* lower row: pyramid / prisma / timeline */
.lower{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
@media(max-width:1080px){.lower{grid-template-columns:1fr}}
.tier{height:30px;border-radius:6px;margin:0 0 5px auto;display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:0 10px;color:#fff;font-family:var(--mono);font-size:11px;opacity:.32}
.tier.on{opacity:1}
.tier .c{background:rgba(255,255,255,.25);border-radius:5px;padding:0 7px;font-weight:700}
.prisma{display:flex;flex-direction:column;gap:0;align-items:center}
.pstep{width:100%;max-width:230px;text-align:center;border:1px solid var(--line-2);border-radius:11px;
  padding:11px;background:var(--panel)}
.pstep .n{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}
.pstep .l{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.parrow{color:var(--faint);font-size:15px;margin:5px 0}
.pexcl{font-family:var(--mono);font-size:10.5px;color:var(--faint);margin:3px 0 0}
.tl{position:relative;padding:8px 6px 6px}
.tl .line{position:absolute;left:14px;right:14px;top:22px;height:2px;background:var(--line-2)}
.tl .pts{display:flex;justify-content:space-between;position:relative}
.tlp{display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;position:relative}
.tlp .d{width:13px;height:13px;border-radius:50%;border:2px solid var(--bg);z-index:1}
.tlp.last .d{box-shadow:0 0 0 0 currentColor;animation:pp2 2.2s infinite}
@keyframes pp2{0%{box-shadow:0 0 0 0 rgba(45,212,191,.4)}70%,100%{box-shadow:0 0 0 7px transparent}}
.tlp .dt{font-family:var(--mono);font-size:9.5px;color:var(--faint)}
.tlp .st{font-family:var(--mono);font-size:9px;text-transform:capitalize}

/* sources */
.srcs{display:flex;flex-direction:column}
.src{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;
  padding:12px 16px;border-top:1px solid var(--line)}
.src:first-child{border-top:0}
.src .rank{font-family:var(--mono);font-size:11px;color:var(--faint)}
.pill{font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.03em;color:#fff;
  padding:2px 7px;border-radius:5px;white-space:nowrap}
.src .ti{font-size:13px;font-weight:600;line-height:1.3}
.src .meta{display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap}
.src .yr{font-family:var(--mono);font-size:10.5px;color:var(--faint)}
.chip{font-family:var(--mono);font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;border:1px solid}
.src a.pm{font-family:var(--mono);font-size:11px;white-space:nowrap}
.src .snip{font-size:12px;color:var(--dim);margin-top:5px;line-height:1.45}

.foot{color:var(--faint);font-size:11px;font-family:var(--mono);letter-spacing:.02em;
  text-align:center;padding:26px 16px;line-height:1.7;border-top:1px solid var(--line);margin-top:22px}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--raise);
  border:1px solid var(--line-2);border-radius:11px;padding:11px 16px;font-family:var(--mono);font-size:12px;
  box-shadow:var(--glow);opacity:0;pointer-events:none;transition:.25s;z-index:60}
.toast.show{opacity:1;transform:translateX(-50%) translateY(-4px)}
.empty{padding:60px 20px;text-align:center;color:var(--dim)}
@media (prefers-reduced-motion:reduce){*{animation-duration:.001s!important}}
</style></head><body>

<div class="topbar">
  <div class="brand"><span class="logo">S</span><b>Strata</b><span class="k">Console</span></div>
  <span class="tenant" id="tenant"></span>
  <span class="spacer"></span>
  <div class="tgl" id="plainTgl" title="Switch between clinical and plain-language readouts">
    <span>PLAIN&nbsp;LANGUAGE</span><span class="switch"></span></div>
  <button class="btn ghost" id="newBtn">+ New review</button>
  <button class="btn" id="syncBtn">↻ Sync</button>
</div>

<div class="shell">
  <aside class="rail">
    <h3><span>Living reviews</span><span id="revCount" class="mono"></span></h3>
    <div id="revList"></div>
  </aside>

  <main class="main">
    <div id="stage" class="grid"></div>
    <div class="foot">
      Strata Console grades <b>published literature</b> for decision support · it is not a medical
      device, handles no patient data, and does not diagnose or treat.<br>
      The anatomical view maps where a body of <i>evidence</i> concentrates — not a patient. Effect
      signals are heuristic; verify against the primary sources.
    </div>
  </main>
</div>
<div class="toast" id="toast"></div>

<script>
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const SC={high:'#22c55e',moderate:'#f59e0b',low:'#fb7139','very low':'#f2564a',none:'#5f7573'};
const LC={1:'#16a34a',2:'#1f9e6b',3:'#d97706',4:'#ea580c',5:'#dc2626',6:'#64748b'};
const LNAME={1:'Meta-analysis',2:'Randomized trial',3:'Cohort',4:'Observational',5:'Case report',6:'Review / opinion'};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const RM=matchMedia('(prefers-reduced-motion:reduce)').matches;
let PLAIN=false, CUR=null, DATA=null;

function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2600);}
function fmt(n){return n==null?'—':Number(n).toLocaleString();}

/* ---------------- data ---------------- */
async function boot(){
  try{
    const d = window.EMBED ? {tenant:EMBED.tenant, reviews:EMBED.reviews}
                           : await (await fetch('/api/reviews')).json();
    $('#tenant').innerHTML='Tenant · <b>'+esc(d.tenant||'Demo Health System')+'</b> · Evidence Office';
    DATA=d.reviews||[];
    renderRail();
    if(DATA.length) select(DATA[0].protocol.id);
    else $('#stage').innerHTML='<div class="panel"><div class="empty">No living reviews yet. Click <b>+ New review</b> to start one.</div></div>';
  }catch(e){$('#stage').innerHTML='<div class="panel"><div class="empty">Could not reach the Strata service.</div></div>';}
}
function renderRail(){
  $('#revCount').textContent=DATA.length;
  $('#revList').innerHTML=DATA.map(r=>{
    const p=r.protocol, s=r.overall_strength||'none';
    return `<button class="rev" data-id="${esc(p.id)}">
      <div class="t">${esc(p.title)}</div>
      <div class="m"><span class="dotc" style="background:${SC[s]}"></span>
        <span style="text-transform:capitalize">${esc(s)}</span>
        <span>· ${fmt(r.included)} studies</span></div></button>`;}).join('');
  $$('.rev').forEach(b=>b.onclick=()=>select(b.dataset.id));
}
async function select(id){
  CUR=id;
  $$('.rev').forEach(b=>b.classList.toggle('sel',b.dataset.id===id));
  $('#stage').innerHTML='<div class="panel"><div class="empty">Loading review…</div></div>';
  try{
    const v = window.EMBED ? EMBED.views[id]
                           : await (await fetch('/api/review?id='+encodeURIComponent(id))).json();
    if(!v||v.error){toast((v&&v.error)||'Review not found');return;}
    render(v);
  }catch(e){toast('Failed to load review');}
}
async function sync(){
  if(!CUR)return;
  if(window.EMBED){ const bw=$('.bodywrap'); if(bw){bw.classList.add('syncing');setTimeout(()=>bw.classList.remove('syncing'),1400);}
    toast('Demo dataset — connect a live evidence source to sync'); return; }
  const b=$('#syncBtn'); b.disabled=true; b.innerHTML='<span class="sp"></span> Syncing';
  const bw=$('.bodywrap'); if(bw)bw.classList.add('syncing');
  try{
    const r=await fetch('/api/review/run?id='+encodeURIComponent(CUR)); const v=await r.json();
    if(v.error){toast(v.error);}
    else{ render(v); const s=v.surveillance||{};
      toast(s.first_sync?'First sync complete': s.changed?((s.new_pmids?.length||0)+' new stud'+((s.new_pmids?.length===1)?'y':'ies')+' found'):'Up to date — no new evidence');
      await refreshRail();
    }
  }catch(e){toast('Sync failed — the evidence source may be unreachable');}
  finally{ b.disabled=false; b.innerHTML='↻ Sync'; const w=$('.bodywrap'); if(w)w.classList.remove('syncing'); }
}
async function refreshRail(){ try{const d=await(await fetch('/api/reviews')).json();DATA=d.reviews||[];renderRail();}catch(e){} }
async function newReview(){
  if(window.EMBED){ toast('New living reviews are created in the live product'); return; }
  const q=prompt('Clinical question for the new living review:'); if(!q)return;
  const title=prompt('Short title:', q.slice(0,48))||q.slice(0,48);
  toast('Creating & running first sync…');
  try{
    const r=await fetch('/api/review/new?q='+encodeURIComponent(q)+'&title='+encodeURIComponent(title));
    const v=await r.json(); if(v.error){toast(v.error);return;}
    await refreshRail(); select(v.protocol.id);
  }catch(e){toast('Could not create review (evidence source unreachable?)');}
}

/* ---------------- render ---------------- */
function render(v){
  const s=v.snapshot; if(!s){$('#stage').innerHTML='<div class="panel"><div class="empty">No sync yet for this review.</div></div>';return;}
  const p=v.protocol, sv=v.surveillance||{}, hist=v.history||[];
  const strength=s.overall_strength, col=SC[strength]||SC.none;
  const nEff=(s.effects||[]).length;
  $('#stage').innerHTML=`
    <div class="panel hero-panel"><div class="hero">
      <div class="panel" style="box-shadow:none;border:0;background:transparent">
        <div class="phead"><h2><span class="pmark"><i></i><i></i><i></i></span>Evidence focus · anatomy</h2>
          <span class="hint">where this literature acts</span></div>
        <div class="bodywrap"><canvas id="body"></canvas><div class="scan"></div>
          <div class="bodytag">Live model · pins mark the organ systems this body of evidence concerns, sized by share of signal.</div></div>
      </div>
      <div class="verdict">
        <div class="vq mono">${esc(p.id)}</div>
        <div class="vtitle">${esc(p.question||p.title)}</div>
        <div class="gaugerow">
          <canvas id="gauge" width="300" height="184"></canvas>
          <div class="gtext"><div class="lab">Certainty (GRADE-style)</div>
            <div class="val" style="color:${col}">${esc(strength)}</div>
            <div class="sub">best evidence: ${esc(LNAME[s.best_level]||'—')}</div></div>
        </div>
        <div class="summary" id="summaryLine"></div>
        ${survHTML(sv)}
      </div>
    </div></div>

    <div class="tiles">
      ${tile(fmt(s.prisma.included),'Studies included')}
      ${tile(fmt(s.prisma.identified),'Records identified')}
      ${tile(LNAME[s.best_level]||'—','Highest evidence')}
      ${tile(fmt(nEff),'Effect sizes')}
      ${tile((hist.length||1)+'','Syncs')}
      ${tile(sinceLabel(s.taken),'Last synced')}
    </div>

    <div class="charts">
      <div class="panel"><div class="phead"><h2><span class="pmark"><i></i><i></i><i></i></span>Living evidence curve</h2>
        <span class="hint">studies accrued · certainty over time</span></div>
        <div class="pbody"><canvas id="curve" width="900" height="210"></canvas></div></div>
      <div class="panel"><div class="phead"><h2><span class="pmark"><i></i><i></i><i></i></span>Forest plot</h2>
        <span class="hint">effect vs. no-effect (ratio = 1)</span></div>
        <div class="forest" id="forest"></div>
        <div class="legend"><span><i style="background:${SC.high}"></i>significant</span>
          <span><i style="background:${SC.none}"></i>crosses 1 (null)</span>
          <span>◇ point estimate · — 95% CI</span></div></div>
    </div>

    <div class="lower">
      <div class="panel"><div class="phead"><h2><span class="pmark"><i></i><i></i><i></i></span>Evidence pyramid</h2></div>
        <div class="pbody" id="pyr"></div></div>
      <div class="panel"><div class="phead"><h2><span class="pmark"><i></i><i></i><i></i></span>PRISMA flow</h2></div>
        <div class="pbody" id="prisma"></div></div>
      <div class="panel"><div class="phead"><h2><span class="pmark"><i></i><i></i><i></i></span>Surveillance</h2>
        <span class="hint">sync history</span></div>
        <div class="pbody" id="timeline"></div></div>
    </div>

    <div class="panel"><div class="phead"><h2><span class="pmark"><i></i><i></i><i></i></span>Graded sources · strongest first</h2>
      <span class="hint">${fmt(s.studies.length)} shown</span></div>
      <div class="srcs" id="srcs"></div></div>`;

  drawGauge(strength);
  drawCurve(s.cumulative||[]);
  drawForest(s.effects||[]);
  drawPyramid(s.pyramid||{});
  drawPrisma(s.prisma||{});
  drawTimeline(hist);
  drawSources(s.studies||[]);
  applyPlain(s);
  startBody(s.hotspots||[], col);
}
function tile(n,l){return `<div class="tile"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`;}
function sinceLabel(iso){if(!iso)return '—';const d=new Date(iso);const days=Math.round((Date.now()-d)/864e5);
  return days<=0?'today':days===1?'1 day ago':days<30?days+' days ago':d.toISOString().slice(0,10);}
function survHTML(sv){
  if(sv.first_sync)return `<div class="surv calm"><div class="h"><span class="pd"></span>Baseline established</div>
    <ul><li>First sync — future syncs will report what changes.</li></ul></div>`;
  const changed=sv.changed && ((sv.new_pmids||[]).length || sv.strength_change);
  let items=[];
  if(sv.strength_change)items.push(`<li><span class="yb">▲</span>Certainty moved <b style="text-transform:capitalize">${esc(sv.strength_change[0])}</b> → <b style="text-transform:capitalize;color:${SC[sv.strength_change[1]]}">${esc(sv.strength_change[1])}</b></li>`);
  (sv.new_studies||[]).slice(0,3).forEach(x=>items.push(`<li><span class="yb">NEW</span>${esc(x.title)}</li>`));
  if(!items.length)items.push('<li>No new evidence since the last sync — up to date.</li>');
  return `<div class="surv ${changed?'':'calm'}"><div class="h"><span class="pd"></span>${changed?'What changed since '+sinceLabel(sv.last_synced):'Surveillance'}</div><ul>${items.join('')}</ul></div>`;
}
function applyPlain(s){
  const line=$('#summaryLine'); if(!line)return;
  line.innerHTML = PLAIN ? esc(s.plain||s.summary) : esc(s.summary);
  $$('#srcs .snip').forEach(el=>el.style.display=PLAIN?'none':'block');
  $$('#srcs .pill.lvl').forEach(el=>el.style.opacity=PLAIN?'.45':'1');
}

/* ---------------- gauge ---------------- */
function drawGauge(strength){
  const c=$('#gauge'); if(!c)return; const x=c.getContext('2d'); const W=c.width,H=c.height;
  x.clearRect(0,0,W,H); const cx=W/2,cy=H-14,r=W/2-16; const segs=['very low','low','moderate','high'];
  const a0=Math.PI, a1=2*Math.PI;
  for(let i=0;i<4;i++){x.beginPath();x.lineWidth=18;x.strokeStyle=SC[segs[i]];
    x.arc(cx,cy,r,a0+(a1-a0)*i/4+.02,a0+(a1-a0)*(i+1)/4-.02);x.stroke();}
  const idx=segs.indexOf(strength); const frac=idx<0?0:(idx+0.5)/4;
  const ang=a0+(a1-a0)*frac;
  x.strokeStyle='#e8f2f0';x.lineWidth=3;x.beginPath();x.moveTo(cx,cy);
  x.lineTo(cx+Math.cos(ang)*(r-2),cy+Math.sin(ang)*(r-2));x.stroke();
  x.fillStyle='#e8f2f0';x.beginPath();x.arc(cx,cy,4.5,0,7);x.fill();
}

/* ---------------- living evidence curve ---------------- */
function drawCurve(pts){
  const c=$('#curve'); if(!c)return; fitCanvas(c); const x=c.getContext('2d');
  const W=c.width/ (window.devicePixelRatio||1), H=c.height/(window.devicePixelRatio||1);
  x.clearRect(0,0,W,H);
  const padL=34,padR=14,padT=14,padB=26;
  if(!pts.length){x.fillStyle='#5d7573';x.font='11px ui-monospace';x.fillText('No dated studies included.',padL,H/2);return;}
  const years=pts.map(p=>p.year), maxC=Math.max(...pts.map(p=>p.count),1);
  const y0=Math.min(...years), y1=Math.max(...years), span=Math.max(1,y1-y0);
  const X=yr=>padL+(W-padL-padR)*((yr-y0)/span);
  const Y=ct=>H-padB-(H-padT-padB)*(ct/maxC);
  // grid
  x.strokeStyle='rgba(255,255,255,.05)';x.lineWidth=1;x.fillStyle='#5d7573';x.font='10px ui-monospace';
  for(let i=0;i<=3;i++){const gy=padT+(H-padT-padB)*i/3;x.beginPath();x.moveTo(padL,gy);x.lineTo(W-padR,gy);x.stroke();
    x.fillText(String(Math.round(maxC*(3-i)/3)),6,gy+3);}
  // area
  const grad=x.createLinearGradient(0,padT,0,H-padB);grad.addColorStop(0,'rgba(45,212,191,.28)');grad.addColorStop(1,'rgba(45,212,191,0)');
  x.beginPath();x.moveTo(X(y0),Y(0));
  pts.forEach(p=>x.lineTo(X(p.year),Y(p.count)));
  x.lineTo(X(pts[pts.length-1].year),Y(0));x.closePath();x.fillStyle=grad;x.fill();
  // line
  x.beginPath();pts.forEach((p,i)=>{const fx=X(p.year),fy=Y(p.count);i?x.lineTo(fx,fy):x.moveTo(fx,fy);});
  x.strokeStyle='#2dd4bf';x.lineWidth=2;x.stroke();
  // dots colored by certainty reached
  pts.forEach(p=>{x.beginPath();x.arc(X(p.year),Y(p.count),3.6,0,7);x.fillStyle=SC[p.strength]||'#2dd4bf';x.fill();
    x.strokeStyle='#060c0e';x.lineWidth=1.5;x.stroke();});
  // x labels
  x.fillStyle='#5d7573';x.textAlign='center';
  [y0,pts[Math.floor(pts.length/2)].year,y1].forEach(yr=>x.fillText(String(yr),X(yr),H-8));
  x.textAlign='start';
}

/* ---------------- forest plot (SVG) ---------------- */
function drawForest(effects){
  const host=$('#forest'); if(!host)return;
  if(!effects.length){host.innerHTML='<div class="mono" style="color:#5d7573;padding:22px 6px">No numeric effect sizes were extracted from the included abstracts.</div>';return;}
  const rows=effects.slice(0,7);
  const W=100, rh=26, top=8, bot=26, H=top+rows.length*rh+bot;
  const lo=0.3, hi=3.0, L=Math.log(lo), Rg=Math.log(hi);
  const X=v=>8+ (W-8)*( (Math.log(Math.max(lo,Math.min(hi,v)))-L)/(Rg-L) );  // percent
  const ticks=[0.5,1,2];
  let g=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H*2.0}" preserveAspectRatio="none" style="overflow:visible">`;
  // no-effect line + ticks
  ticks.forEach(t=>{const xp=X(t);g+=`<line x1="${xp}" x2="${xp}" y1="${top}" y2="${top+rows.length*rh}" stroke="${t===1?'#5d7573':'rgba(255,255,255,.08)'}" stroke-width="${t===1?0.5:0.3}" stroke-dasharray="${t===1?'':'1 1'}"/>`;
    g+=`<text class="axis" x="${xp}" y="${H-8}" text-anchor="middle" style="font-size:6px">${t}</text>`;});
  rows.forEach((e,i)=>{
    const y=top+i*rh+rh/2; const c=e.significant?(SC[e.strength]||'#22c55e'):SC.none;
    const xl=X(e.ci_low),xh=X(e.ci_high),xv=X(e.value);
    g+=`<line x1="${xl}" x2="${xh}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="0.8"/>`;
    g+=`<line x1="${xl}" x2="${xl}" y1="${y-2}" y2="${y+2}" stroke="${c}" stroke-width="0.7"/>`;
    g+=`<line x1="${xh}" x2="${xh}" y1="${y-2}" y2="${y+2}" stroke="${c}" stroke-width="0.7"/>`;
    g+=`<rect x="${xv-1.6}" y="${y-1.6}" width="3.2" height="3.2" transform="rotate(45 ${xv} ${y})" fill="${e.significant?c:'#0c181a'}" stroke="${c}" stroke-width="0.6"/>`;
    g+=`<text class="lab" x="8" y="${y-4}" style="font-size:5.4px">${esc((e.measure||'')+' '+e.value.toFixed(2))} <tspan fill="#5d7573">(${e.ci_low.toFixed(2)}–${e.ci_high.toFixed(2)})</tspan></text>`;
    g+=`<title>${esc(e.title)}</title>`;
  });
  g+=`<text class="axis" x="8" y="${H-8}" style="font-size:5px" fill="#5d7573">favors intervention ←   → favors control</text>`;
  g+='</svg>'; host.innerHTML=g;
}

/* ---------------- pyramid / prisma / timeline / sources ---------------- */
function drawPyramid(pyr){
  const host=$('#pyr'); if(!host)return; const widths=[52,63,72,82,91,100];
  host.innerHTML=[1,2,3,4,5,6].map(L=>{const c=pyr[L]||0;
    return `<div class="tier ${c?'on':''}" style="width:${widths[L-1]}%;background:${LC[L]}">
      <span>${esc(LNAME[L])}</span><span class="c">${c}</span></div>`;}).join('');
}
function drawPrisma(pr){
  const host=$('#prisma'); if(!host)return;
  host.innerHTML=`<div class="prisma">
    <div class="pstep"><div class="n">${fmt(pr.identified)}</div><div class="l">Identified</div></div>
    <div class="parrow">↓</div>
    <div class="pstep"><div class="n">${fmt(pr.screened)}</div><div class="l">Screened</div></div>
    <div class="pexcl">− ${fmt(pr.excluded_level)} below evidence threshold${pr.excluded_year?` · − ${fmt(pr.excluded_year)} too old`:''}</div>
    <div class="parrow">↓</div>
    <div class="pstep" style="border-color:var(--accent)"><div class="n" style="color:var(--accent)">${fmt(pr.included)}</div><div class="l">Included</div></div></div>`;
}
function drawTimeline(hist){
  const host=$('#timeline'); if(!host)return;
  if(!hist.length){host.innerHTML='<div class="mono" style="color:#5d7573">No history.</div>';return;}
  const pts=hist.slice(-6);
  host.innerHTML=`<div class="tl"><div class="line"></div><div class="pts">`+pts.map((h,i)=>{
    const c=SC[h.overall_strength]||SC.none, last=i===pts.length-1;
    return `<div class="tlp ${last?'last':''}" style="color:${c}"><div class="d" style="background:${c}"></div>
      <div class="dt">${esc((h.taken||'').slice(5,10))}</div>
      <div class="st" style="color:${c}">${esc(h.overall_strength||'')}</div></div>`;}).join('')+`</div></div>
    <div class="mono" style="color:#5d7573;font-size:10.5px;margin-top:12px">${pts.length} sync${pts.length>1?'s':''} · included studies: ${pts.map(h=>h.included).join(' → ')}</div>`;
}
function drawSources(studies){
  const host=$('#srcs'); if(!host)return;
  host.innerHTML=studies.map(s=>{
    const eff=s.effect, ec=effChip(eff);
    return `<div class="src">
      <span class="rank mono">[${s.n}]</span>
      <div><div class="ti">${esc(s.title)}</div>
        <div class="meta">
          <span class="pill lvl" style="background:${LC[s.level]}">${esc(s.label)}</span>
          <span class="pill" style="background:${SC[s.strength]||SC.none}">${esc(s.strength)}</span>
          <span class="yr">${s.year||'n.d.'}${s.sample_size?' · n='+fmt(s.sample_size):''}</span>
          ${ec}</div>
        <div class="snip">${esc(s.snippet)}</div></div>
      <a class="pm" href="${esc(s.url)}" target="_blank" rel="noopener">PubMed ↗</a></div>`;}).join('');
}
function effChip(e){
  if(!e)return '';
  const map={reduction:['↓','#22c55e'],increase:['↑','#f2564a'],null:['—','#5f7573']};
  const m=map[e.direction]||['','#5f7573'];
  const txt=e.value!=null?`${e.measure} ${e.value.toFixed(2)}`:(e.direction==='null'?'no sig. effect':e.direction);
  const col=e.direction==='null'?'#5f7573':m[1];
  return `<span class="chip" style="color:${col};border-color:${col}">${m[0]} ${esc(txt)}</span>`;
}

/* ---------------- 3D anatomy ---------------- */
let bodyPts=null, bodyRAF=0;
function makeHumanoid(){
  const P=[], rnd=Math.random;
  const ell=(cx,cy,cz,rx,ry,rz,n)=>{for(let i=0;i<n;i++){const u=rnd()*2-1,th=rnd()*6.2832,r=Math.cbrt(rnd());
    const s=Math.sqrt(1-u*u);P.push([cx+r*s*Math.cos(th)*rx,cy+r*u*ry,cz+r*s*Math.sin(th)*rz]);}};
  const cap=(x0,y0,z0,x1,y1,z1,rr,n)=>{for(let i=0;i<n;i++){const t=rnd(),u=rnd()*2-1,th=rnd()*6.2832,r=Math.cbrt(rnd())*rr;
    const s=Math.sqrt(1-u*u);P.push([x0+(x1-x0)*t+r*s*Math.cos(th),y0+(y1-y0)*t+r*u*0.7,z0+(z1-z0)*t+r*s*Math.sin(th)]);}};
  ell(0,0.90,0.02,0.13,0.16,0.13,240);            // head
  cap(0,0.72,0.02,0,0.80,0.02,0.05,40);           // neck
  ell(0,0.44,0.0,0.205,0.25,0.12,760);            // chest/torso
  ell(0,0.08,0.0,0.175,0.13,0.11,260);            // pelvis
  cap(-0.19,0.60,0.02,-0.30,0.30,0.02,0.052,120); cap(-0.30,0.30,0.02,-0.34,0.02,0.03,0.045,120); // L arm
  cap(0.19,0.60,0.02,0.30,0.30,0.02,0.052,120);   cap(0.30,0.30,0.02,0.34,0.02,0.03,0.045,120);   // R arm
  cap(-0.09,-0.02,0,-0.11,-0.46,0.02,0.075,190);  cap(-0.11,-0.46,0.02,-0.12,-0.92,0.03,0.055,190);// L leg
  cap(0.09,-0.02,0,0.11,-0.46,0.02,0.075,190);    cap(0.11,-0.46,0.02,0.12,-0.92,0.03,0.055,190);  // R leg
  return P;
}
function fitCanvas(c){const dpr=window.devicePixelRatio||1;const r=c.getBoundingClientRect();
  c.width=Math.max(1,r.width*dpr);c.height=Math.max(1,r.height*dpr);const g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);return g;}
function startBody(hotspots,col){
  cancelAnimationFrame(bodyRAF);
  const c=$('#body'); if(!c)return; if(!bodyPts)bodyPts=makeHumanoid();
  let g=fitCanvas(c); let ang=0.5;
  const draw=(t)=>{
    const W=c.clientWidth,H=c.clientHeight; g.clearRect(0,0,W,H);
    const cx=W/2,cy=H*0.5+H*0.03,R=Math.min(W,H)*0.44,f=2.6;
    const ca=Math.cos(ang),sa=Math.sin(ang);
    const proj=p=>{const px=p[0]*ca-p[2]*sa, pz=p[0]*sa+p[2]*ca; const sc=f/(f-pz);
      return [cx+px*R*sc,cy-p[1]*R*sc,pz,sc];};
    // body points, depth sorted
    const pr=bodyPts.map(proj).sort((a,b)=>a[2]-b[2]);
    for(const q of pr){const depth=(q[2]+0.45)/0.9;const a=0.10+0.42*Math.max(0,Math.min(1,depth));
      g.fillStyle='rgba(125,196,206,'+a.toFixed(3)+')';const s=1.1*q[3];g.fillRect(q[0],q[1],s,s);}
    // hotspot pins + annotations
    hotspots.forEach((h,i)=>{
      const q=proj([h.x,h.y,h.z]); const front=q[2]>-0.02; const c2=SC[h.strength]||col;
      const pulse=RM?0.6:(0.5+0.5*Math.sin(t/500+i));
      const rad=(h.systemic?10:7)+ (h.intensity*10) + pulse*4;
      const gr=g.createRadialGradient(q[0],q[1],0,q[0],q[1],rad*2.2);
      gr.addColorStop(0,c2);gr.addColorStop(0.4,hexA(c2,front?0.5:0.2));gr.addColorStop(1,hexA(c2,0));
      g.fillStyle=gr;g.beginPath();g.arc(q[0],q[1],rad*2.2,0,7);g.fill();
      g.fillStyle=front?c2:hexA(c2,0.5);g.beginPath();g.arc(q[0],q[1],2.4,0,7);g.fill();
      // annotation on the right
      const ly=26+i*24, lx=W-8;
      g.strokeStyle=hexA(c2,0.5);g.lineWidth=1;g.beginPath();g.moveTo(q[0],q[1]);g.lineTo(lx-116,ly-3);g.lineTo(lx-8,ly-3);g.stroke();
      g.textAlign='right';g.font='11px ui-monospace';g.fillStyle=c2;
      g.fillText(h.name,lx,ly);
      g.fillStyle='#5d7573';g.font='9px ui-monospace';g.fillText(Math.round(h.intensity*100)+'% of signal',lx,ly+11);
      g.textAlign='start';
    });
    if(!hotspots.length){g.fillStyle='#5d7573';g.font='11px ui-monospace';g.textAlign='center';
      g.fillText('No specific organ system — systemic / non-localised evidence.',W/2,H-24);g.textAlign='start';}
    if(!RM){ang+=0.0045; bodyRAF=requestAnimationFrame(draw);}
  };
  bodyRAF=requestAnimationFrame(draw);
  window.addEventListener('resize',()=>{g=fitCanvas(c);},{passive:true});
}
function hexA(hex,a){const h=hex.replace('#','');const n=parseInt(h.length===3?h.replace(/(.)/g,'$1$1'):h,16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;}

/* ---------------- toggles ---------------- */
$('#plainTgl').onclick=()=>{PLAIN=!PLAIN;$('#plainTgl').classList.toggle('on',PLAIN);
  if(CUR){const line=$('#summaryLine'); if(line&&window._lastSnap)applyPlain(window._lastSnap);} };
const _origRender=render; render=function(v){window._lastSnap=v.snapshot;_origRender(v);};
$('#syncBtn').onclick=sync; $('#newBtn').onclick=newReview;
boot();
</script></body></html>"""


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
