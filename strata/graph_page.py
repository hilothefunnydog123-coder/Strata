"""The Evidence Graph explorer — the moat, made visible.

A live, data-driven view of the accumulated evidence graph: a node-link map where claims ring
the canvas and studies are placed at the centroid of the claims they connect, so a study that
underpins several claims literally sits *between* them — the shared-evidence structure you
can see. Around it: the intelligence only the graph produces — hub studies, contested studies,
unstable claims, and evidence gaps — each drawn live from ``/v1/graph/*``. Selecting any study
opens its dossier: reliability and every claim that leans on it, and how. Standard library
only; deterministic layout (no randomness), so the same evidence base always renders the same.
"""
from __future__ import annotations

GRAPH_HTML = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Strata Evidence Graph</title>
<meta name="description" content="The Strata Evidence Graph: cross-claim intelligence — hub studies, contested evidence, unstable claims, and evidence gaps — computed from the accumulated evidence base."/>
<style>
:root{--bg:#05080d;--bg2:#080d15;--panel:#0b1220;--panel2:#0f1828;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.15);
 --ink:#eaf2f0;--dim:#9fb0ae;--faint:#6b7d7a;--green:#38e6a6;--amber:#ffc24b;--red:#ff5d73;--blue:#5cc8ff;--violet:#c9a8ff;
 --l1:#16a34a;--l2:#22a06b;--l3:#d97706;--l4:#ea580c;--l5:#dc2626;--l6:#64748b;
 --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(120% 90% at 84% -20%,rgba(56,230,166,.06),transparent 55%),var(--bg);color:var(--ink);
 font-family:var(--sans);font-size:15px;-webkit-font-smoothing:antialiased;letter-spacing:-.01em}
a{color:inherit;text-decoration:none}.mono{font-family:var(--mono)}
.top{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:14px;padding:12px 24px;
 background:rgba(5,8,13,.86);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:10px;font-weight:800}
.logo .g{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#04140f;font-weight:900;background:linear-gradient(150deg,#68f0c0,var(--green))}
.logo .k{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--faint);text-transform:uppercase;border-left:1px solid var(--line2);padding-left:10px}
.top .sp{flex:1}.top a.lk{font-family:var(--mono);font-size:12px;color:var(--dim)}.top a.lk:hover{color:var(--ink)}
.wrap{max-width:1240px;margin:0 auto;padding:26px 24px 90px}
.head h1{font-size:30px;font-weight:800;letter-spacing:-.03em}
.head .sub{color:var(--dim);font-size:15px;margin-top:6px;max-width:70ch}
.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:22px 0}
@media(max-width:1000px){.metrics{grid-template-columns:repeat(3,1fr)}}@media(max-width:560px){.metrics{grid-template-columns:repeat(2,1fr)}}
.metric{background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid var(--line);border-radius:14px;padding:15px 16px}
.metric .v{font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1}
.metric .l{font-size:11.5px;font-weight:600;color:var(--dim);margin-top:7px}
.panel{background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid var(--line);border-radius:16px;overflow:hidden}
.ph{display:flex;align-items:center;justify-content:space-between;padding:15px 18px 0}
.ph h2{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.ph .hint{font-family:var(--mono);font-size:10px;color:var(--faint)}
.pb{padding:12px 18px 18px}
.viz{margin-bottom:16px}
#svg{width:100%;height:auto;display:block;background:radial-gradient(60% 60% at 50% 45%,rgba(56,230,166,.04),transparent)}
.legend{display:flex;gap:18px;flex-wrap:wrap;padding:0 18px 16px;font-size:12px;color:var(--dim)}
.legend span{display:inline-flex;align-items:center;gap:7px}
.legend i{width:11px;height:11px;border-radius:50%;display:inline-block}
.legend i.sq{border-radius:3px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
@media(max-width:900px){.grid2{grid-template-columns:1fr}}
.row{display:grid;grid-template-columns:auto 1fr auto;gap:11px;align-items:center;padding:11px 18px;border-top:1px solid var(--line);cursor:pointer}
.row:first-child{border-top:0}.row:hover{background:rgba(255,255,255,.03)}
.row .ti{font-size:13.5px;font-weight:600;line-height:1.3}
.row .mt{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}
.pillL{font-family:var(--mono);font-size:9px;font-weight:700;padding:2px 6px;border-radius:5px;color:#fff}
.rel{font-family:var(--mono);font-size:12px;font-weight:800;padding:4px 8px;border-radius:7px;white-space:nowrap}
.tag{font-family:var(--mono);font-size:10px;font-weight:800;padding:3px 7px;border-radius:6px;white-space:nowrap}
.bar{width:52px;height:6px;border-radius:4px;background:var(--panel2);overflow:hidden;display:inline-block;vertical-align:middle}
.bar span{display:block;height:100%}
.empty{padding:24px 18px;text-align:center;color:var(--faint);font-family:var(--mono);font-size:12px}
.scrim{position:fixed;inset:0;background:rgba(2,4,8,.72);opacity:0;pointer-events:none;transition:.2s;z-index:60}
.scrim.on{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100%;width:min(640px,96vw);background:var(--bg2);border-left:1px solid var(--line2);
 transform:translateX(100%);transition:transform .24s cubic-bezier(.3,.9,.3,1);z-index:70;overflow-y:auto}
.drawer.on{transform:none}
.dh{position:sticky;top:0;background:rgba(8,13,21,.94);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:18px 22px;display:flex;justify-content:space-between;gap:14px}
.dh .t{font-size:16px;font-weight:800;line-height:1.35}.dh .q{font-family:var(--mono);font-size:11px;color:var(--faint)}
.dh .x{background:transparent;border:1px solid var(--line2);color:var(--ink);border-radius:9px;width:34px;height:34px;cursor:pointer;font-size:18px;flex:none}
.db{padding:20px 22px 50px}
.kv{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px}
.kv .b{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:12px 14px;min-width:100px}
.kv .b .n{font-family:var(--mono);font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:.06em}
.kv .b .v{font-size:20px;font-weight:800;margin-top:4px}
.cl{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:baseline;padding:11px 0;border-top:1px solid var(--line)}
.cl .g{font-family:var(--mono);font-weight:800}
.foot{text-align:center;color:var(--faint);font-family:var(--mono);font-size:11px;margin-top:34px;line-height:1.8}
.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--green);border-top-color:transparent;border-radius:50%;animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.err{background:rgba(255,93,115,.08);border:1px solid rgba(255,93,115,.3);color:#ff9aa8;padding:14px 16px;border-radius:12px;font-size:14px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style></head><body>
<div class="top"><a class="logo" href="/"><span class="g">S</span> Strata <span class="k">Evidence Graph</span></a>
 <span class="sp"></span><a class="lk" href="/console">Console</a><a class="lk" href="/app">Verify</a><a class="lk" href="/docs">API</a><a class="lk" href="/">Home</a></div>
<div class="wrap">
  <div class="head"><h1>Evidence Graph</h1>
    <div class="sub">The compounding asset. Every monitored claim, linked to the graded studies behind it — and the intelligence that only exists once you hold the whole graph. This gets richer with every claim monitored and every re-check.</div></div>
  <div id="app"><div style="padding:50px;text-align:center"><span class="spin"></span></div></div>
  <div class="foot">Computed from graded bibliographic metadata across the monitored evidence base. Heuristic and honest — no patient data. Reliability and instability are transparent signals, not verdicts.</div>
</div>
<div class="scrim" id="scrim" onclick="closeDrawer()"></div>
<div class="drawer" id="drawer"><div id="drawerBody"></div></div>
<script>
const $=(s,r=document)=>r.querySelector(s);
const LC={1:'#16a34a',2:'#22a06b',3:'#d97706',4:'#ea580c',5:'#dc2626',6:'#64748b'};
const LN={1:'Meta-analysis',2:'Randomized trial',3:'Cohort',4:'Observational',5:'Case report',6:'Review'};
const SC={Supported:'#38e6a6',Mixed:'#ffc24b',Contradicted:'#ff5d73',Insufficient:'#7c8a90',Unsupported:'#7c8a90',null:'#7c8a90'};
const STANCE={support:'#38e6a6',contradict:'#ff5d73',neutral:'#6b7d7a'};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const relCol=v=>v>=0.75?'#38e6a6':v>=0.5?'#ffc24b':'#ff5d73';
let AUTH=false,KEY=null,VIEW=null;
async function api(p){const h={};if(KEY)h['Authorization']='Bearer '+KEY;const r=await fetch(p,{headers:h});if(r.status===401)throw new Error('This server requires an API key.');return r.json();}
async function ensureKey(){if(!AUTH||KEY)return;try{KEY=(await(await fetch('/v1/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"label":"graph"}'})).json()).key;}catch(e){}}
(async function(){
  try{const h=await(await fetch('/v1/health')).json();AUTH=!!h.auth;}catch(e){}
  await ensureKey();
  try{
    VIEW=await api('/v1/graph/view?top=48');
    const [hubs,contested,unstable,gaps]=await Promise.all(
      ['/v1/graph/hubs?limit=8','/v1/graph/contested?limit=6','/v1/graph/unstable?limit=6','/v1/graph/gaps?limit=6'].map(api));
    render(VIEW,hubs.hub_studies,contested.contested_studies,unstable.unstable_claims,gaps.evidence_gaps);
  }catch(e){$('#app').innerHTML='<div class="err">'+esc(e.message||e)+' Generate a key at <a href="/app">/app</a> or run in open mode.</div>';}
})();

function metric(v,l,c){return `<div class="metric"><div class="v" style="color:${c||'var(--ink)'}">${v}</div><div class="l">${l}</div></div>`;}
function render(view,hubs,contested,unstable,gaps){
  const s=view.summary;
  $('#app').innerHTML=`
    <div class="metrics">
      ${metric(s.claims,'Claims')}${metric(s.studies,'Studies')}${metric(s.edges,'Claim→study links')}
      ${metric(s.hub_studies,'Hub studies','var(--blue)')}${metric(s.contested_studies,'Contested','var(--red)')}
      ${metric(s.avg_reliability,'Avg reliability','var(--green)')}
    </div>
    <div class="panel viz"><div class="ph"><h2>The graph</h2><span class="hint">${view.claims.length} claims · ${view.studies.length} studies shown · shared studies sit between the claims they connect</span></div>
      <div id="svgwrap"></div>
      <div class="legend">
        <span><i class="sq" style="background:#5cc8ff"></i> claim</span>
        <span><i style="background:#38e6a6"></i> supporting link</span>
        <span><i style="background:#ff5d73"></i> contradicting link</span>
        <span><i style="background:#c9a8ff;box-shadow:0 0 0 2px rgba(201,168,255,.35)"></i> contested study</span>
        <span><i style="background:#9fb0ae"></i> study (size = claims it underpins)</span>
      </div></div>
    <div class="grid2">
      <div class="panel"><div class="ph"><h2>Hub studies</h2><span class="hint">underpin the most claims</span></div>
        <div id="hubs"></div></div>
      <div class="panel"><div class="ph"><h2>Contested studies</h2><span class="hint">cited both ways</span></div>
        <div id="contested"></div></div>
    </div>
    <div class="grid2">
      <div class="panel"><div class="ph"><h2>Unstable claims</h2><span class="hint">evidence churn</span></div>
        <div id="unstable"></div></div>
      <div class="panel"><div class="ph"><h2>Evidence gaps</h2><span class="hint">where the evidence is thin</span></div>
        <div id="gaps"></div></div>
    </div>`;
  drawGraph(view);
  $('#hubs').innerHTML=hubs.length?hubs.map(studyRow).join(''):'<div class="empty">No hub studies yet</div>';
  $('#contested').innerHTML=contested.length?contested.map(studyRow).join(''):'<div class="empty">No contested studies — the base agrees with itself</div>';
  $('#unstable').innerHTML=unstable.length?unstable.map(claimRow).join(''):'<div class="empty">Every claim is stable</div>';
  $('#gaps').innerHTML=gaps.length?gaps.map(gapRow).join(''):'<div class="empty">No thin-evidence claims</div>';
}
function studyRow(s){return `<div class="row" onclick="openStudy('${esc(s.key)}')">
  <span class="pillL" style="background:${LC[s.level]||'#64748b'}">${esc(LN[s.level]||'—')}</span>
  <div><div class="ti">${esc((s.title||'').slice(0,72))}</div>
    <div class="mt">${s.claim_count} claim${s.claim_count>1?'s':''} · ▲${s.support} ▼${s.contradict}${s.contested?' · <span style="color:var(--violet)">contested</span>':''}${s.cited_by!=null?' · '+Number(s.cited_by).toLocaleString()+' cites':''}</div></div>
  <span class="rel" style="color:${relCol(s.reliability)};border:1px solid ${relCol(s.reliability)}33">${s.reliability}</span></div>`;}
function claimRow(c){return `<div class="row" onclick="location.href='/console'">
  <span class="tag" style="background:${SC[c.status]||'#7c8a90'};color:#04140f">${esc(c.status||'—')}</span>
  <div><div class="ti">${esc(c.claim)}</div><div class="mt">${esc(c.area||'')} · v${c.version} · ${c.strength||''}</div></div>
  <span><span class="bar"><span style="width:${Math.round(c.instability*100)}%;background:${c.instability>=.5?'#ff5d73':'#ffc24b'}"></span></span></span></div>`;}
function gapRow(c){return `<div class="row" onclick="location.href='/console'">
  <span class="tag" style="background:${SC[c.status]||'#7c8a90'};color:#04140f">${esc(c.status||'—')}</span>
  <div><div class="ti">${esc(c.claim)}</div><div class="mt">${esc(c.area||'')} · ${c.n_studies} studies · ${c.strength||''} strength</div></div>
  <span class="mono" style="color:var(--faint);font-size:11px">thin</span></div>`;}

function drawGraph(view){
  const W=1000,H=620,cx=W/2,cy=H/2-6,R=Math.min(W,H)*0.36;
  const claims=view.claims,studies=view.studies,links=view.links;
  const cpos={};
  claims.forEach((c,i)=>{const a=-Math.PI/2+2*Math.PI*i/Math.max(1,claims.length);
    cpos[c.id]={x:cx+R*Math.cos(a),y:cy+R*Math.sin(a),a};});
  // study positions: centroid of connected claims, single-claim studies fan out past their claim
  const byStudy={};links.forEach(l=>{(byStudy[l.target]=byStudy[l.target]||[]).push(l.source);});
  const spos={};
  studies.forEach((s,i)=>{const cs=(byStudy[s.id]||[]).filter(id=>cpos[id]);
    if(!cs.length){spos[s.id]={x:cx,y:cy};return;}
    if(cs.length===1){const p=cpos[cs[0]],off=18*((i%5)-2);
      spos[s.id]={x:cx+(p.x-cx)*1.24+Math.cos(p.a+1.57)*off,y:cy+(p.y-cy)*1.24+Math.sin(p.a+1.57)*off};}
    else{let x=0,y=0;cs.forEach(id=>{x+=cpos[id].x;y+=cpos[id].y;});
      spos[s.id]={x:cx+((x/cs.length)-cx)*0.72,y:cy+((y/cs.length)-cy)*0.72};}});
  let g=`<svg id="svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Evidence graph">`;
  // links
  links.forEach(l=>{const a=cpos[l.source],b=spos[l.target];if(!a||!b)return;
    g+=`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${STANCE[l.stance]||'#6b7d7a'}" stroke-opacity="0.32" stroke-width="1.1"/>`;});
  // study nodes
  studies.forEach(s=>{const p=spos[s.id];if(!p)return;const r=4+Math.min(7,(s.claim_count-1)*3.2);
    const fill=s.contested?'#c9a8ff':(LC[s.level]||'#9fb0ae');
    g+=`<circle class="snode" data-id="${esc(s.id)}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" fill-opacity="0.9" stroke="${s.contested?'#c9a8ff':'#05080d'}" stroke-width="${s.contested?2:1}" style="cursor:pointer"><title>${esc(s.label)} — ${s.claim_count} claim(s), reliability ${s.reliability}</title></circle>`;});
  // claim nodes on top
  claims.forEach(c=>{const p=cpos[c.id];const col=SC[c.status]||'#5cc8ff';
    g+=`<g><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="#5cc8ff" stroke="${col}" stroke-width="2.5"/><title>${esc(c.label)} — ${esc(c.status||'')}</title></circle>`;
    const lx=p.x+(p.x>cx?14:-14),anchor=p.x>cx?'start':'end';
    g+=`<text x="${lx.toFixed(1)}" y="${(p.y+3).toFixed(1)}" text-anchor="${anchor}" font-family="var(--mono)" font-size="10" fill="#9fb0ae">${esc((c.label||'').slice(0,26))}</text></g>`;});
  g+='</svg>';
  $('#svgwrap').innerHTML=g;
  document.querySelectorAll('.snode').forEach(n=>n.onclick=()=>openStudy(n.getAttribute('data-id')));
}

async function openStudy(id){
  $('#scrim').classList.add('on');$('#drawer').classList.add('on');
  $('#drawerBody').innerHTML='<div style="padding:60px;text-align:center"><span class="spin"></span></div>';
  let d;try{d=await api('/v1/graph/study/'+encodeURIComponent(id));}catch(e){d={error:e.message};}
  if(!d||d.error){$('#drawerBody').innerHTML='<div class="db"><div class="err">'+esc((d&&d.error)||'not found')+'</div></div>';return;}
  const link=d.url?`<a href="${esc(d.url)}" target="_blank" rel="noopener" style="color:var(--green);font-family:var(--mono);font-size:12px">open source ↗</a>`:'';
  $('#drawerBody').innerHTML=`<div class="dh"><div><div class="q">${esc(LN[d.level]||'study')}${d.year?' · '+d.year:''}${d.contested?' · CONTESTED':''}</div>
      <div class="t">${esc(d.title||'(untitled)')}</div>${link}</div><button class="x" onclick="closeDrawer()">×</button></div>
    <div class="db">
      <div class="kv"><div class="b"><div class="n">Reliability</div><div class="v" style="color:${relCol(d.reliability)}">${d.reliability}</div></div>
        <div class="b"><div class="n">Claims</div><div class="v">${d.claim_count}</div></div>
        <div class="b"><div class="n">▲ / ▼</div><div class="v">${d.support} / ${d.contradict}</div></div>
        ${d.cited_by!=null?`<div class="b"><div class="n">Citations</div><div class="v">${Number(d.cited_by).toLocaleString()}</div></div>`:''}</div>
      <div style="font-family:var(--mono);font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Claims that lean on this study</div>
      ${(d.claims||[]).map(c=>`<div class="cl"><span class="g" style="color:${STANCE[c.stance]||'#6b7d7a'}">${c.stance==='support'?'▲':c.stance==='contradict'?'▼':'●'}</span>
        <div><div style="font-size:13.5px;font-weight:600">${esc(c.claim)}</div>
          <div class="mono" style="font-size:11px;color:var(--faint);margin-top:2px">${esc(c.status||'')} · ${esc(c.strength||'')} · cites as ${esc(c.stance)}</div></div></div>`).join('')}
    </div>`;
}
function closeDrawer(){$('#scrim').classList.remove('on');$('#drawer').classList.remove('on');}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
</script></body></html>"""
