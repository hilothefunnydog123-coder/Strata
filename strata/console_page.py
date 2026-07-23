"""Strata Console — a live streaming evidence search.

Type a clinical question or claim; the page calls ``/v1/verify/stream`` and renders the
pipeline as it runs: a live latency counter, the stage strip lighting up, the sources
appearing first, then the verdict and data-driven charts (evidence pyramid, forest plot,
source breakdown, confidence gauge) built from the *actual* retrieved evidence.

It provisions its own API key from ``/v1/keys`` when auth is enabled, and replays embedded
example receipts when served as a static artifact (``window.EMBED``). Standard library only.
"""
from __future__ import annotations

CONSOLE_HTML = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Strata Console - live evidence search</title>
<style>
:root{--bg:#060c0e;--bg2:#0a1315;--panel:#0c181a;--panel2:#0f2023;--line:#193034;--line2:#22454a;
 --ink:#e8f2f0;--dim:#8ba39f;--faint:#5d7573;--accent:#2dd4bf;--accent2:#38bdf8;--ink0:#03110f;
 --green:#22c55e;--amber:#f59e0b;--red:#f2564a;--grey:#64748b;
 --l1:#16a34a;--l2:#1f9e6b;--l3:#d97706;--l4:#ea580c;--l5:#dc2626;--l6:#64748b;
 --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
 --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(120% 80% at 84% -10%,rgba(45,212,191,.07),transparent 55%),var(--bg);
 color:var(--ink);font-family:var(--sans);font-size:15px;-webkit-font-smoothing:antialiased}
.mono{font-family:var(--mono)}
a{color:var(--accent);text-decoration:none}
.top{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:14px;padding:12px 22px;
 background:rgba(6,12,14,.82);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:10px;font-weight:700}
.logo .g{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:var(--ink0);
 font-weight:800;background:linear-gradient(150deg,var(--accent2),var(--accent))}
.logo .k{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--faint);text-transform:uppercase;
 border-left:1px solid var(--line2);padding-left:10px}
.top .sp{flex:1}.top .tn{font-family:var(--mono);font-size:11px;color:var(--dim)}
.top a.lk{font-family:var(--mono);font-size:12px;color:var(--dim)}
.wrap{max-width:1120px;margin:0 auto;padding:26px 22px 60px}
.h1{font-size:26px;font-weight:800;letter-spacing:-.02em;text-align:center;margin-bottom:6px}
.sub{text-align:center;color:var(--dim);font-size:14px;margin-bottom:22px}
.search{display:flex;gap:12px;max-width:820px;margin:0 auto;background:var(--panel);border:1px solid var(--line2);
 border-radius:15px;padding:8px 8px 8px 18px;box-shadow:0 24px 70px -46px rgba(45,212,191,.5)}
.search:focus-within{border-color:var(--accent)}
.search input{flex:1;background:transparent;border:0;outline:0;color:var(--ink);font-size:16px}
.search button{border:0;border-radius:11px;background:linear-gradient(180deg,var(--accent),#12b5a3);color:var(--ink0);
 font-weight:800;font-family:var(--mono);font-size:14px;padding:0 22px;cursor:pointer}
.search button:disabled{opacity:.5}
.chips{display:flex;gap:9px;flex-wrap:wrap;justify-content:center;margin:14px auto 0;max-width:900px}
.chip{font-family:var(--mono);font-size:12px;color:var(--accent);background:rgba(45,212,191,.07);
 border:1px solid var(--line2);border-radius:20px;padding:7px 13px;cursor:pointer}
.note{text-align:center;color:var(--faint);font-family:var(--mono);font-size:11px;margin-top:12px}

/* pipeline strip */
#run{margin-top:26px;display:none}
#run.on{display:block}
.pl{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:16px 18px}
.pl .hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.pl .hd .t{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.pl .lat{font-family:var(--mono);font-weight:800;font-size:20px;color:var(--accent)}
.stages{display:flex;flex-wrap:wrap;gap:6px}
.pill{font-family:var(--mono);font-size:10.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--faint);
 border:1px solid var(--line);border-radius:20px;padding:5px 10px;opacity:.5;transition:.2s;display:flex;gap:6px;align-items:center}
.pill.on{opacity:1;border-color:var(--accent);color:var(--accent)}
.pill.done{opacity:1;color:var(--green);border-color:rgba(34,197,94,.4)}
.pill .ms{color:var(--faint);font-size:9.5px}
.statusline{margin-top:10px;font-size:13px;color:var(--dim);min-height:18px}
.statusline b{color:var(--ink)}

/* results */
#out{margin-top:16px;display:grid;gap:16px}
.panel{background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid var(--line);border-radius:16px}
.ph{display:flex;align-items:center;justify-content:space-between;padding:13px 16px 0}
.ph h2{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.ph .hint{font-family:var(--mono);font-size:10px;color:var(--faint)}
.pb{padding:14px 16px 16px}
.verdict{display:grid;grid-template-columns:150px 1fr;gap:20px;align-items:center}
@media(max-width:640px){.verdict{grid-template-columns:1fr}}
#gauge{width:150px;height:96px}
.vq{font-family:var(--mono);font-size:12px;color:var(--faint);margin-bottom:4px}
.vt{font-size:19px;font-weight:700;line-height:1.25;margin-bottom:10px}
.vrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.stbadge{font-weight:800;font-size:15px;padding:5px 12px;border-radius:9px;color:var(--ink0)}
.cstat{font-family:var(--mono);font-size:11px;font-weight:800;padding:4px 9px;border-radius:7px;color:var(--ink0)}
.cert{font-family:var(--mono);font-size:12px;font-weight:700;color:var(--dim)}
.split{height:12px;border-radius:7px;overflow:hidden;display:flex;background:var(--panel2);margin:10px 0 6px}
.split .s{background:var(--green)}.split .c{background:var(--red)}.split .n{background:#2b3742}
.slab{display:flex;gap:16px;font-family:var(--mono);font-size:12px;font-weight:700}
.slab .s{color:var(--green)}.slab .c{color:var(--red)}.slab .n{color:var(--dim)}
.pico{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.pico .p{font-size:12px;border:1px solid var(--line);border-radius:20px;padding:5px 11px;color:var(--ink)}
.pico .p b{color:var(--accent);font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;margin-right:6px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
@media(max-width:960px){.grid3{grid-template-columns:1fr}}
.tier{height:28px;border-radius:6px;margin:0 0 5px auto;display:flex;align-items:center;justify-content:space-between;
 gap:8px;padding:0 10px;color:#fff;font-family:var(--mono);font-size:11px;opacity:.3}
.tier.on{opacity:1}.tier .c{background:rgba(255,255,255,.25);border-radius:5px;padding:0 7px;font-weight:700}
.srow{display:flex;align-items:center;gap:10px;margin-bottom:9px}
.srow .nm{font-family:var(--mono);font-size:11px;color:var(--dim);width:104px}
.srow .bar{flex:1;height:9px;border-radius:6px;background:var(--panel2);overflow:hidden}
.srow .fill{height:100%;background:linear-gradient(90deg,var(--accent2),var(--accent))}
.srow .v{font-family:var(--mono);font-size:11px;color:var(--accent);font-weight:700;width:26px;text-align:right}
.forest .lab{font-family:var(--mono);font-size:5px;fill:var(--dim)}
.axis{font-family:var(--mono);font-size:5px;fill:var(--faint)}
.cites{display:flex;flex-direction:column}
.cite{display:grid;grid-template-columns:auto 1fr auto;gap:11px;align-items:baseline;padding:11px 16px;border-top:1px solid var(--line)}
.cite:first-child{border-top:0}
.cite .tg{font-family:var(--mono);font-weight:800;font-size:13px}
.cite .ti{font-size:13px;font-weight:600}
.cite .mt{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pillL{font-family:var(--mono);font-size:9px;font-weight:700;padding:2px 7px;border-radius:5px;color:#fff}
.cite a{font-family:var(--mono);font-size:11px;white-space:nowrap;font-weight:700}
details.audit{padding:14px 16px}
details.audit summary{cursor:pointer;font-family:var(--mono);font-size:11px;color:var(--dim);list-style:none}
details.audit summary::-webkit-details-marker{display:none}
details.audit summary::before{content:"> ";color:var(--accent)}
details.audit[open] summary::before{content:"v "}
.aud{display:grid;grid-template-columns:104px 1fr auto;gap:12px;font-size:12px;padding:7px 0;border-bottom:1px solid var(--line)}
.aud .s{font-family:var(--mono);color:var(--accent);font-weight:700;text-transform:uppercase;font-size:9.5px}
.aud .d{color:var(--dim)}.aud .ms{font-family:var(--mono);color:var(--faint)}
.lim{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);border-radius:11px;padding:12px 14px;color:#ffce70;font-size:13px;font-weight:600;margin-top:12px}
.err{background:rgba(242,86,74,.08);border:1px solid rgba(242,86,74,.3);color:#f2a99f;padding:14px 16px;border-radius:12px;font-size:14px}
.foot{text-align:center;color:var(--faint);font-family:var(--mono);font-size:11px;margin-top:30px;line-height:1.7}
.spin{display:inline-block;width:13px;height:13px;border:2px solid var(--ink0);border-top-color:transparent;border-radius:50%;animation:sp .7s linear infinite;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.001s!important}}
</style></head><body>
<div class="top"><a class="logo" href="/"><span class="g">S</span> Strata <span class="k">Console</span></a>
 <span class="sp"></span><span class="tn" id="tn"></span><a class="lk" href="/app">Verify</a><a class="lk" href="/">Home</a></div>
<div class="wrap">
  <div class="h1">Live evidence search</div>
  <div class="sub">Ask a clinical question or enter a claim. Strata searches the literature and grades it in real time.</div>
  <div class="search"><input id="q" placeholder="Do SGLT2 inhibitors reduce heart-failure hospitalization?" autofocus/><button id="go">Analyze</button></div>
  <div class="chips" id="chips"></div>
  <div class="note" id="note">Streams the evidence pipeline live. Not medical advice.</div>

  <div id="run">
    <div class="pl"><div class="hd"><span class="t">Evidence pipeline</span><span class="lat" id="lat">0 ms</span></div>
      <div class="stages" id="stages"></div><div class="statusline" id="sl"></div></div>
    <div id="out"></div>
  </div>
  <div class="foot">Strata grades published literature for decision support. Not a medical device. No patient data. No diagnosis.</div>
</div>
<script>
const $=(s,r=document)=>r.querySelector(s);
const STAGES=['understand','expand','retrieve','dedup','rank','classify','extract','contradiction','grade','synthesize','audit'];
const SC={Supported:'#22c55e',Mixed:'#f59e0b',Contradicted:'#f2564a',Insufficient:'#64748b',Unsupported:'#64748b'};
const STC={high:'#22c55e',moderate:'#f59e0b',low:'#fb7139','very low':'#f2564a',none:'#64748b'};
const LC={1:'#16a34a',2:'#1f9e6b',3:'#d97706',4:'#ea580c',5:'#dc2626',6:'#64748b'};
const LN={1:'Meta-analysis',2:'Randomized trial',3:'Cohort',4:'Observational',5:'Case report',6:'Review'};
const GLY={support:['▲','#22c55e'],contradict:['▼','#f2564a'],neutral:['●','#8ba39f']};
const SRC={pubmed:'PubMed',europepmc:'Europe PMC',openalex:'OpenAlex',crossref:'Crossref',clinicaltrials:'ClinicalTrials.gov'};
const BL={Supported:'The weight of evidence supports this.',Mixed:'The evidence is split.',Contradicted:'The evidence runs against this.',Insufficient:'Too little good evidence to judge.',Unsupported:'No directional evidence found.'};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm=s=>s.trim().toLowerCase().replace(/[?.]+$/,'').replace(/\s+/g,' ');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const EX=["Do SGLT2 inhibitors reduce heart-failure hospitalization?","Does metformin reduce cardiovascular mortality in type 2 diabetes?",
 "Does vitamin D supplementation reduce acute respiratory infections?","Does intermittent fasting reduce cardiovascular mortality?"];
$('#chips').innerHTML=EX.map(e=>`<span class="chip">${esc(e)}</span>`).join('');
$('#chips').onclick=e=>{if(e.target.classList.contains('chip')){$('#q').value=e.target.textContent;go();}};
$('#go').onclick=go;$('#q').addEventListener('keydown',e=>{if(e.key==='Enter')go();});

let KEY=null, AUTH=false, t0=0, raf=0;
(async()=>{try{const h=await(await fetch('/v1/health')).json();AUTH=h.auth;$('#tn').textContent='sources: '+(h.sources||[]).join(' · ');}catch(e){}
  if(window.EMBED)$('#tn').textContent='demo · '+(EMBED.tenant||'');})();

function startTimer(){t0=performance.now();const tick=()=>{$('#lat').textContent=Math.round(performance.now()-t0)+' ms';raf=requestAnimationFrame(tick);};tick();}
function stopTimer(ms){cancelAnimationFrame(raf);if(ms!=null)$('#lat').textContent=ms+' ms';}
function resetStages(){$('#stages').innerHTML=STAGES.map(s=>`<span class="pill" data-s="${s}">${s}<span class="ms"></span></span>`).join('');}
function onStage(ev){
  const prev=[...document.querySelectorAll('.pill.on')];prev.forEach(p=>p.classList.replace('on','done'));
  const el=document.querySelector('.pill[data-s="'+ev.stage+'"]');
  if(el){el.classList.add('on');el.querySelector('.ms').textContent=(ev.ms||0)+'ms';}
  $('#sl').innerHTML='<b>'+ev.stage+'</b> · '+esc(ev.detail||'');
  if(ev.stage==='retrieve'&&ev.sources)$('#out').innerHTML=srcPanel(ev.sources,ev.count)+$('#out').innerHTML;
}

async function go(){
  const q=$('#q').value.trim();if(!q)return;
  $('#go').disabled=true;$('#go').innerHTML='<span class="spin"></span>';
  $('#run').classList.add('on');$('#out').innerHTML='';resetStages();$('#sl').textContent='';startTimer();
  try{
    if(window.EMBED){await replay(q);}
    else{await streamLive(q);}
  }catch(e){$('#out').innerHTML=`<div class="err">${esc(e.message||e)}</div>`;stopTimer();}
  finally{$('#go').disabled=false;$('#go').textContent='Analyze';}
}
async function ensureKey(){if(!AUTH||KEY||window.EMBED)return;
  try{KEY=(await(await fetch('/v1/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'console'})})).json()).key;}catch(e){}}
async function streamLive(q){
  await ensureKey();
  const headers={'Content-Type':'application/json'};if(KEY)headers['Authorization']='Bearer '+KEY;
  const res=await fetch('/v1/verify/stream',{method:'POST',headers,body:JSON.stringify({claim:q})});
  if(res.status===401){$('#out').innerHTML='<div class="err">This server requires an API key. Generate one at /app, or run in open mode.</div>';stopTimer();return;}
  if(!res.body||!res.body.getReader){const r=await(await fetch('/v1/verify?claim='+encodeURIComponent(q),{headers})).json();stopTimer(r.elapsed_ms);render(r);return;}
  const rd=res.body.getReader(),dec=new TextDecoder();let buf='',receipt=null;
  while(true){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;
    while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;
      let ev;try{ev=JSON.parse(line);}catch(e){continue;}
      if(ev.type==='stage')onStage(ev);else if(ev.type==='done')receipt=ev.receipt;
      else if(ev.type==='error'){$('#out').innerHTML=`<div class="err">${esc(ev.error)}</div>`;stopTimer();return;}}}
  if(receipt){stopTimer(receipt.elapsed_ms);render(receipt);}else{stopTimer();$('#out').innerHTML='<div class="err">No result.</div>';}
}
async function replay(q){
  const ex=(EMBED.examples||[]).find(x=>norm(x.claim)===norm(q));
  if(!ex){stopTimer();$('#out').innerHTML='<div class="err">This demo streams the example searches above. Pick one, or run Strata locally for free-text search.</div>';return;}
  const r=ex.receipt;
  for(const s of (r.audit_trail||[])){onStage(s);await sleep(150);}
  stopTimer(r.elapsed_ms);render(r);
}

function render(r){
  $('#sl').innerHTML='<b>done</b> · analyzed '+(r.total||0)+' studies';
  const col=SC[r.status]||'#64748b',t=Math.max(1,r.supporting+r.contradicting+r.neutral),w=n=>Math.round(100*n/t);
  const pico=r.pico||{};
  const picoH=[['Population',pico.population],['Intervention',pico.intervention],['Comparator',pico.comparator],['Outcome',pico.outcome]]
    .filter(x=>x[1]).map(x=>`<span class="p"><b>${x[0]}</b>${esc(x[1])}</span>`).join('');
  const lim=r.key_limitation?`<div class="lim">${esc(r.key_limitation)}</div>`:'';
  $('#out').innerHTML=`
    <div class="panel"><div class="pb"><div class="verdict">
      <canvas id="gauge" width="300" height="192"></canvas>
      <div><div class="vq">${esc(r.query||'')}</div><div class="vt">${esc(r.claim)}</div>
        <div class="vrow"><span class="stbadge" style="background:${col}">${esc((r.status||'').toUpperCase())}</span>
          ${r.claim_status?`<span class="cstat" style="background:${col}">${esc(r.claim_status)}</span>`:''}
          <span class="cert">${esc((r.strength||'').toUpperCase())} CERTAINTY · ${Math.round((r.confidence||0)*100)}% CONFIDENCE</span></div>
        <div class="split"><span class="s" style="width:${w(r.supporting)}%"></span><span class="c" style="width:${w(r.contradicting)}%"></span><span class="n" style="width:${w(r.neutral)}%"></span></div>
        <div class="slab"><span class="s">${r.supporting} supporting</span><span class="c">${r.contradicting} contradicting</span><span class="n">${r.neutral} neutral</span></div>
        ${picoH?`<div class="pico">${picoH}</div>`:''}${lim}</div>
    </div></div></div>
    <div class="grid3">
      ${panel('Evidence pyramid',pyramid(r.citations||[]))}
      ${panel('Forest plot',forest(r.effect_estimates||[]),'effect vs no-effect')}
      ${panel('Sources',srcBars(r.sources||{}),Object.values(r.sources||{}).reduce((a,b)=>a+b,0)+' records')}
    </div>
    <div class="panel"><div class="ph"><h2>Graded sources</h2><span class="hint">${(r.citations||[]).length} shown</span></div>
      <div class="cites">${(r.citations||[]).map(citeRow).join('')}</div></div>
    ${auditPanel(r)}`;
  drawGauge(r.strength,r.confidence);
}
function panel(title,body,hint){return `<div class="panel"><div class="ph"><h2>${title}</h2>${hint?`<span class="hint">${hint}</span>`:''}</div><div class="pb">${body}</div></div>`;}
function srcPanel(sources,count){return `<div class="panel"><div class="ph"><h2>Retrieving</h2><span class="hint">${count} records</span></div><div class="pb">${srcBars(sources)}</div></div>`;}
function pyramid(cites){const lv={1:0,2:0,3:0,4:0,5:0,6:0};cites.forEach(c=>lv[c.level]=(lv[c.level]||0)+1);const wd=[52,63,72,82,91,100];
  return [1,2,3,4,5,6].map(L=>`<div class="tier ${lv[L]?'on':''}" style="width:${wd[L-1]}%;background:${LC[L]}"><span>${LN[L]}</span><span class="c">${lv[L]}</span></div>`).join('');}
function srcBars(s){const ents=Object.entries(s).sort((a,b)=>b[1]-a[1]);const mx=Math.max(1,...ents.map(e=>e[1]));
  return ents.length?ents.map(([k,v])=>`<div class="srow"><span class="nm">${esc(SRC[k]||k)}</span><span class="bar"><span class="fill" style="width:${Math.round(100*v/mx)}%"></span></span><span class="v">${v}</span></div>`).join(''):'<div class="mono" style="color:#5d7573">No sources.</div>';}
function forest(eff){if(!eff.length)return '<div class="mono" style="color:#5d7573;font-size:12px">No numeric effect sizes extracted.</div>';
  const rows=eff.slice(0,7),lo=0.3,hi=3,L=Math.log(lo),R=Math.log(hi),X=v=>8+(92)*((Math.log(Math.max(lo,Math.min(hi,v)))-L)/(R-L));
  const H=10+rows.length*14+10;let g=`<svg viewBox="0 0 100 ${H}" width="100%" height="${H*2}" preserveAspectRatio="none" style="overflow:visible">`;
  [0.5,1,2].forEach(tk=>{const x=X(tk);g+=`<line x1="${x}" x2="${x}" y1="8" y2="${8+rows.length*14}" stroke="${tk===1?'#5d7573':'rgba(255,255,255,.08)'}" stroke-width="${tk===1?0.4:0.25}"/><text class="axis" x="${x}" y="${H-3}" text-anchor="middle">${tk}</text>`;});
  rows.forEach((e,i)=>{const y=8+i*14+7,c=e.significant?(STC[e.strength]||'#22c55e'):'#64748b',xl=X(e.ci_low),xh=X(e.ci_high),xv=X(e.value);
    g+=`<line x1="${xl}" x2="${xh}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="0.7"/><rect x="${xv-1.4}" y="${y-1.4}" width="2.8" height="2.8" transform="rotate(45 ${xv} ${y})" fill="${c}"/>`;
    g+=`<text class="lab" x="8" y="${y-3}">${esc((e.measure||'')+' '+e.value.toFixed(2))}</text>`;});
  g+='</svg>';return g;}
function citeRow(c){const g=GLY[c.stance]||GLY.neutral,eff=c.effect&&c.effect.value!=null?`${c.effect.measure} ${c.effect.value.toFixed(2)}`:'';
  const cb=c.cited_by!=null?' · '+Number(c.cited_by).toLocaleString()+' cites':'';
  return `<div class="cite"><span class="tg" style="color:${g[1]}">${g[0]}</span>
    <div><div class="ti">${esc(c.title)}</div><div class="mt"><span class="pillL" style="background:${LC[c.level]}">${esc(c.label)}</span>
      <span>${c.year||''} ${eff?'· '+esc(eff):''}${cb} · ${esc(SRC[c.source]||c.source||'')}</span></div></div>
    <a href="${esc(c.url)}" target="_blank" rel="noopener">${c.source==='clinicaltrials'?'Trial':'Source'} ↗</a></div>`;}
function auditPanel(r){const a=r.audit_trail||[];if(!a.length)return '';
  const ai=(r.models_used&&r.models_used.length)?('AI on '+r.models_used.length+' tasks'):'heuristics only';
  return `<div class="panel"><details class="audit"><summary>Audit trail · ${a.length} stages · ${r.elapsed_ms||0} ms · ${ai}</summary>`+
    a.map(s=>`<div class="aud"><span class="s">${esc(s.stage)}</span><span class="d">${esc(s.detail)}</span><span class="ms">${s.ms}ms</span></div>`).join('')+`</details></div>`;}
function drawGauge(strength,conf){const c=$('#gauge');if(!c)return;const x=c.getContext('2d'),W=c.width,H=c.height,cx=W/2,cy=H-16,r=W/2-20;
  const segs=['very low','low','moderate','high'],a0=Math.PI,a1=2*Math.PI;
  for(let i=0;i<4;i++){x.beginPath();x.lineWidth=20;x.strokeStyle=STC[segs[i]];x.arc(cx,cy,r,a0+(a1-a0)*i/4+.02,a0+(a1-a0)*(i+1)/4-.02);x.stroke();}
  const frac=Math.max(0,Math.min(1,conf||0)),ang=a0+(a1-a0)*frac;
  x.strokeStyle='#e8f2f0';x.lineWidth=3.5;x.beginPath();x.moveTo(cx,cy);x.lineTo(cx+Math.cos(ang)*(r-3),cy+Math.sin(ang)*(r-3));x.stroke();
  x.fillStyle='#e8f2f0';x.beginPath();x.arc(cx,cy,5,0,7);x.fill();
  x.fillStyle=STC[strength]||'#64748b';x.font='700 22px ui-monospace';x.textAlign='center';x.fillText(Math.round(frac*100)+'%',cx,cy-8);}
</script></body></html>"""
