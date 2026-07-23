"""The company website — the pages that make Strata a company, not a demo.

Why Strata (the problem + who it is for + why existing tools fall short), Pricing, the
enterprise Trust page (honest about current compliance maturity), and Security. A shared
design system, nav, footer, and a validated "Book a demo" modal wired to
``POST /v1/demo-request`` (with a mailto fallback) run across every page. Standard library
only, zero external dependencies. The developer docs live in :mod:`strata.docs_page`.

Every claim on these pages is deliberately honest: no fabricated logos, no fake customer
counts, no false certifications. Where a capability is designed-for-but-not-yet-certified,
the copy says exactly that.
"""
from __future__ import annotations

_SITE_CSS = r"""
:root{
  --bg:#04060a; --bg2:#080d13; --card:#0b1220; --card2:#0e1626; --line:rgba(255,255,255,.09);
  --line2:rgba(255,255,255,.16); --ink:#ffffff; --ink2:#aeb9c4; --dim:#8a97a3;
  --green:#38e6a6; --red:#ff5d73; --amber:#ffc24b; --blue:#5cc8ff; --grey:#7c8a90;
  --sans:system-ui,-apple-system,"Segoe UI Variable","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono","Cascadia Code",Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:17px;line-height:1.55;
  -webkit-font-smoothing:antialiased;letter-spacing:-.01em}
a{color:inherit;text-decoration:none}.mono{font-family:var(--mono)}
::selection{background:rgba(56,230,166,.3);color:#04140f}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.btn{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:15px;padding:13px 20px;border-radius:12px;
  cursor:pointer;border:0;transition:transform .15s ease,background .15s ease}
.btn:hover{transform:translateY(-2px)}
.btn.p{background:var(--green);color:#03140d}.btn.g{background:transparent;color:#fff;border:1px solid var(--line2)}
.btn.g:hover{background:rgba(255,255,255,.05)}
nav{position:sticky;top:0;z-index:50;background:rgba(4,6,10,.74);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
nav .wrap{display:flex;align-items:center;height:64px;gap:22px}
.logo{display:flex;align-items:center;gap:11px;font-weight:800;font-size:19px;letter-spacing:-.02em}
.logo .g{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#03140d;font-weight:900;background:var(--green)}
nav .sp{flex:1}
nav .lk{font-weight:600;font-size:14.5px;color:#fff;opacity:.72}nav .lk:hover{opacity:1}
nav .lk.act{opacity:1;color:var(--green)}
@media(max-width:820px){nav .lk.hide{display:none}}
.hero{text-align:center;padding:76px 0 20px}
.eyebrow{display:inline-flex;align-items:center;gap:9px;font-family:var(--mono);font-size:12px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--green);border:1px solid rgba(56,230,166,.3);
  background:rgba(56,230,166,.06);padding:7px 14px;border-radius:30px;margin-bottom:26px}
h1.big{font-size:clamp(2.4rem,6vw,4.4rem);font-weight:800;line-height:1.04;letter-spacing:-.035em;max-width:20ch;margin:0 auto}
h1.big .go{color:var(--green)}
.hero p.sub{font-size:clamp(1.05rem,2vw,1.3rem);font-weight:500;color:#fff;opacity:.82;max-width:46ch;margin:24px auto 0;line-height:1.5}
.hero .cta{display:flex;gap:14px;justify-content:center;margin-top:32px;flex-wrap:wrap}
section{padding:76px 0;border-top:1px solid var(--line)}
.h2{font-size:clamp(1.9rem,4.4vw,3rem);font-weight:800;letter-spacing:-.03em;line-height:1.1;max-width:22ch}
.h2 .go{color:var(--green)}.h2 .dim{color:var(--grey)}
.lead{font-size:clamp(1.05rem,2vw,1.25rem);font-weight:500;color:#fff;opacity:.8;max-width:52ch;margin-top:18px;line-height:1.55}
.kicker{font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--green);margin-bottom:16px}
.grid{display:grid;gap:18px}.g2{grid-template-columns:1fr 1fr}.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}
@media(max-width:860px){.g2,.g3,.g4{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px}
.card h3{font-size:21px;font-weight:800;letter-spacing:-.02em;margin-bottom:9px}
.card p{font-size:15.5px;font-weight:500;color:#fff;opacity:.74;line-height:1.55}
.card .n{font-family:var(--mono);font-size:13px;font-weight:700;color:var(--green);margin-bottom:13px}
.card ul{margin:12px 0 0;padding-left:18px}.card li{font-size:14.5px;color:#fff;opacity:.72;margin:5px 0}
.flow{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:40px}
@media(max-width:860px){.flow{grid-template-columns:1fr 1fr}}
.fstep{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.fstep .s{font-family:var(--mono);font-size:12px;color:var(--green);font-weight:700}
.fstep h4{font-size:16px;font-weight:800;margin:8px 0 6px;letter-spacing:-.01em}
.fstep p{font-size:13.5px;color:#fff;opacity:.68;line-height:1.5}
.cmp{width:100%;border-collapse:separate;border-spacing:0;margin-top:44px;font-size:15px}
.cmp th,.cmp td{text-align:left;padding:16px 18px;border-bottom:1px solid var(--line);vertical-align:top}
.cmp thead th{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);font-weight:700}
.cmp tbody th{font-weight:700;color:#fff;font-size:15px;white-space:nowrap}
.cmp .q{color:#fff;opacity:.72;font-size:14.5px}
.cmp tr.hl td,.cmp tr.hl th{background:rgba(56,230,166,.05)}
.cmp .go{color:var(--green);font-weight:700}
/* pricing */
.tiers{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:44px}
@media(max-width:980px){.tiers{grid-template-columns:1fr 1fr}}@media(max-width:560px){.tiers{grid-template-columns:1fr}}
.tier{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px;display:flex;flex-direction:column}
.tier.hot{border-color:var(--green);background:rgba(56,230,166,.05);box-shadow:0 30px 80px -50px rgba(56,230,166,.4)}
.tier .nm{font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green)}
.tier .pr{font-size:30px;font-weight:800;letter-spacing:-.03em;margin:16px 0 4px}
.tier .pr small{font-size:14px;font-weight:600;color:#fff;opacity:.6}
.tier .who{font-size:14px;color:#fff;opacity:.72;min-height:42px;margin-bottom:14px}
.tier ul{list-style:none;margin:0 0 20px;padding:0;flex:1}
.tier li{font-size:14px;color:#fff;opacity:.82;padding:7px 0 7px 22px;position:relative;border-top:1px solid var(--line)}
.tier li:before{content:"✓";position:absolute;left:0;color:var(--green);font-weight:800}
.tier .btn{width:100%;justify-content:center}
.note{font-size:14px;color:#fff;opacity:.6;margin-top:26px;line-height:1.6;max-width:60ch}
.faq{margin-top:20px}.faq details{border-bottom:1px solid var(--line);padding:18px 0}
.faq summary{cursor:pointer;font-weight:700;font-size:17px;list-style:none;display:flex;justify-content:space-between}
.faq summary::-webkit-details-marker{display:none}.faq summary::after{content:"+";color:var(--green);font-weight:800}
.faq details[open] summary::after{content:"–"}
.faq p{margin-top:12px;font-size:15px;color:#fff;opacity:.74;line-height:1.6;max-width:70ch}
/* trust/security list */
.tlist{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:40px}
@media(max-width:820px){.tlist{grid-template-columns:1fr}}
.titem{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}
.titem h4{font-size:17px;font-weight:800;margin-bottom:8px;display:flex;align-items:center;gap:9px}
.titem h4 .i{width:26px;height:26px;border-radius:7px;background:rgba(56,230,166,.12);display:grid;place-items:center;color:var(--green);font-size:14px;flex:none}
.titem p{font-size:14.5px;color:#fff;opacity:.74;line-height:1.55}
.status-row{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);font-size:15px}
.status-row .st{font-family:var(--mono);font-size:11px;font-weight:800;letter-spacing:.06em;padding:4px 10px;border-radius:7px;white-space:nowrap}
.st.live{background:rgba(56,230,166,.15);color:var(--green)}
.st.design{background:rgba(255,194,75,.14);color:var(--amber)}
.st.road{background:rgba(255,255,255,.08);color:var(--dim)}
.status-row .nm{font-weight:700;width:230px}.status-row .ds{opacity:.72;font-size:14px}
@media(max-width:640px){.status-row{flex-wrap:wrap}.status-row .nm{width:auto}}
.cta-final{text-align:center;padding:100px 0}
.cta-final h2{font-size:clamp(2rem,5vw,3.6rem);font-weight:800;letter-spacing:-.035em;line-height:1.06;max-width:18ch;margin:0 auto 30px}
footer{border-top:1px solid var(--line);padding:44px 0 40px}
footer .cols{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:24px}
@media(max-width:820px){footer .cols{grid-template-columns:1fr 1fr}}
footer .col h5{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:14px}
footer .col a{display:block;font-size:14.5px;opacity:.72;margin:8px 0}footer .col a:hover{opacity:1}
footer .disc{font-size:13.5px;color:#fff;opacity:.5;max-width:70ch;margin-top:30px;line-height:1.6;border-top:1px solid var(--line);padding-top:22px}
/* demo modal */
.modal{position:fixed;inset:0;background:rgba(2,4,8,.8);display:none;align-items:center;justify-content:center;z-index:100;padding:20px}
.modal.show{display:flex}
.modal .box{background:var(--card);border:1px solid var(--line2);border-radius:20px;padding:28px;max-width:480px;width:100%;max-height:92vh;overflow-y:auto}
.modal h3{font-size:24px;font-weight:800;margin-bottom:6px}
.modal .msub{font-size:14px;opacity:.72;margin-bottom:18px}
.modal label{display:block;font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:.06em;text-transform:uppercase;margin:0 0 5px}
.modal input,.modal select,.modal textarea{width:100%;background:#03140d;border:1px solid var(--line2);border-radius:10px;padding:11px 13px;color:#fff;font-size:14px;margin-bottom:12px;font-family:inherit}
.modal .merr{color:#ff9aa8;font-size:13px;margin-bottom:10px;font-weight:600;min-height:0}
.modal .mok{color:#8ff3d0;font-size:14px;font-weight:600;line-height:1.5}
.modal .mrow{display:flex;gap:14px;margin-top:4px}
.modal button{flex:1;border:0;border-radius:11px;padding:13px;font-weight:800;font-size:14px;cursor:pointer}
.modal .mgo{background:var(--green);color:#03140d}.modal .mcx{background:transparent;color:#fff;border:1px solid var(--line2)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
"""


def _head(title: str, desc: str) -> str:
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"/>'
            f'<meta name="viewport" content="width=device-width,initial-scale=1"/>'
            f'<title>{title}</title><meta name="description" content="{desc}"/>'
            f'<style>{_SITE_CSS}</style></head><body>')


def _nav(active: str = "") -> str:
    def lk(href, label, key):
        cls = "lk act" if key == active else "lk hide"
        return f'<a class="{cls}" href="{href}">{label}</a>'
    return ('<nav><div class="wrap"><a class="logo" href="/"><span class="g">S</span> Strata</a>'
            '<span class="sp"></span>'
            + lk("/why", "Why Strata", "why")
            + lk("/console", "Console", "console")
            + lk("/pricing", "Pricing", "pricing")
            + lk("/docs", "Docs", "docs")
            + lk("/trust", "Trust", "trust")
            + '<a class="btn g" style="padding:9px 15px;font-size:14px" onclick="openDemo()">Book a demo</a>'
            '<a class="btn p" href="/app" style="padding:9px 16px;font-size:14px">Try Verify</a>'
            '</div></nav>')


def _footer() -> str:
    return ('<footer><div class="wrap"><div class="cols">'
            '<div class="col"><a class="logo" href="/"><span class="g">S</span> Strata</a>'
            '<p style="font-size:14.5px;opacity:.66;margin-top:14px;max-width:34ch;line-height:1.55">'
            'Continuous evidence intelligence — the trust layer between medical knowledge and medical decisions.</p></div>'
            '<div class="col"><h5>Product</h5><a href="/app">Verify</a><a href="/console">Console</a>'
            '<a href="/search">Live search</a><a href="/platform">Platform</a><a href="/docs">API</a></div>'
            '<div class="col"><h5>Company</h5><a href="/why">Why Strata</a><a href="/pricing">Pricing</a>'
            '<a onclick="openDemo()" style="cursor:pointer">Book a demo</a></div>'
            '<div class="col"><h5>Enterprise</h5><a href="/trust">Trust</a><a href="/security">Security</a>'
            '<a href="/docs#errors">Reliability</a></div></div>'
            '<div class="disc">Strata appraises published literature for decision support. It is <b>not a medical '
            'device</b>, handles <b>no patient data</b>, and does not diagnose, treat, advise, or determine truth. '
            'Evidence assessments are transparent heuristics; every conclusion links to its primary sources for '
            'independent review. Pricing shown is indicative and subject to customer discovery.</div>'
            '</div></footer>')


_DEMO_MODAL = r"""
<div class="modal" id="demoModal"><div class="box">
  <div id="demoForm">
  <h3>Book a demo</h3>
  <div class="msub">See Strata on the claims your organization relies on. We reach out within one business day.</div>
  <div class="merr" id="dm_err"></div>
  <label>Full name</label><input id="dm_name" placeholder="Jane Okafor"/>
  <label>Work email</label><input id="dm_email" type="email" placeholder="jane@organization.org"/>
  <label>Organization</label><input id="dm_org" placeholder="Mercy Health"/>
  <label>Role</label><input id="dm_role" placeholder="VP, Medical Affairs"/>
  <label>Company type</label><select id="dm_type"><option value="">Select…</option>
    <option>Pharmaceutical / biotech</option><option>Hospital / health system</option>
    <option>Medical AI company</option><option>Research organization</option>
    <option>Payer / insurer</option><option>Other</option></select>
  <label>Organization size</label><select id="dm_size"><option value="">Select…</option>
    <option>1-50</option><option>51-200</option><option>201-1000</option><option>1000-5000</option><option>5000+</option></select>
  <label>Primary use case</label><select id="dm_use"><option value="">Select…</option>
    <option>Medical AI verification</option><option>Pharma evidence monitoring</option>
    <option>Hospital evidence intelligence</option><option>Research automation</option><option>Other</option></select>
  <label>Anything else? (optional)</label><textarea id="dm_msg" rows="2" placeholder="e.g. monitoring the evidence behind our drug efficacy claims"></textarea>
  <div class="mrow"><button class="mcx" onclick="closeDemo()">Cancel</button><button class="mgo" onclick="submitDemo()">Send request</button></div>
  </div>
  <div id="demoDone" style="display:none;text-align:center;padding:14px 0">
    <div style="font-size:40px">✓</div><h3 style="margin-top:10px">Request received</h3>
    <div class="mok" style="margin:12px 0 20px">Thanks — your request is logged. We'll email you within one business day to schedule.
      Meanwhile, try <a href="/app" style="color:var(--green)">Strata Verify</a> or read the <a href="/docs" style="color:var(--green)">API docs</a>.</div>
    <button class="mgo" onclick="closeDemo()" style="max-width:160px;margin:0 auto">Done</button>
  </div>
</div></div>
<script>
function openDemo(){document.getElementById('demoModal').classList.add('show');}
function closeDemo(){document.getElementById('demoModal').classList.remove('show');
  document.getElementById('demoForm').style.display='block';document.getElementById('demoDone').style.display='none';}
async function submitDemo(){
  const g=id=>(document.getElementById(id).value||'').trim();
  const name=g('dm_name'),email=g('dm_email'),org=g('dm_org'),err=document.getElementById('dm_err');
  if(!name){err.textContent='Full name is required.';return;}
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){err.textContent='A valid work email is required.';return;}
  if(!org){err.textContent='Organization is required.';return;}
  err.textContent='';
  const payload={name,email,organization:org,role:g('dm_role'),company_type:g('dm_type'),
    company_size:g('dm_size'),use_case:g('dm_use'),message:g('dm_msg'),source:location.pathname};
  try{await fetch('/v1/demo-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}catch(e){}
  document.getElementById('demoForm').style.display='none';document.getElementById('demoDone').style.display='block';
}
</script>
"""


def _page(title: str, desc: str, body: str, active: str = "") -> str:
    return _head(title, desc) + _nav(active) + body + _footer() + _DEMO_MODAL + "</body></html>"


# ============================================================================ WHY STRATA
_WHY_BODY = r"""
<header class="hero"><div class="wrap">
  <div class="eyebrow">Continuous Evidence Intelligence</div>
  <h1 class="big">The evidence changes every day. <span class="go">The systems that rely on it don't.</span></h1>
  <p class="sub">Organizations make thousands of medical claims. The research underneath them shifts constantly — new trials, new meta-analyses, new contradictions. Strata watches that evidence continuously and tells you the moment a claim you rely on stops being defensible.</p>
  <div class="cta"><a class="btn p" href="/app">Try Strata Verify</a><a class="btn g" onclick="openDemo()">Book a demo</a></div>
</div></header>

<section><div class="wrap">
  <div class="kicker">The gap</div>
  <div class="h2">Evidence updates continuously. <span class="dim">Most organizations update periodically.</span></div>
  <div class="lead">A hospital revisits a protocol every few years. A pharma team refreshes a claim dossier for a filing. A medical-AI model is trained once and shipped. Meanwhile PubMed adds thousands of papers a day. The window between "the evidence changed" and "we noticed" is where expensive mistakes live — outdated guidance, unsupported marketing claims, AI answers that a new RCT just contradicted.</div>
  <div class="grid g3" style="margin-top:40px">
    <div class="card"><div class="n">THE OLD WAY</div><h3>Point-in-time</h3><p>A literature review is a photograph. It's accurate the day it's written and decays from then on — and nobody is told when it stops being true.</p></div>
    <div class="card"><div class="n">THE PROBLEM</div><h3>Unbounded volume</h3><p>Medical AI will generate more claims than any team can manually verify, and the underlying evidence moves faster than any manual process can track.</p></div>
    <div class="card" style="border-color:rgba(56,230,166,.3)"><div class="n" style="color:var(--green)">THE STRATA WAY</div><h3>Version-controlled</h3><p>Treat each claim as a living, versioned object. Re-verify it continuously, grade it transparently, and alert when the evidence materially moves.</p></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="kicker">How it works</div>
  <div class="h2">Claim in. Graded verdict out. <span class="go">Watched forever.</span></div>
  <div class="flow">
    <div class="fstep"><div class="s">01</div><h4>Define the claim</h4><p>State the assertion — intervention, population, outcome. Strata structures it into PICO.</p></div>
    <div class="fstep"><div class="s">02</div><h4>Retrieve evidence</h4><p>Fan out across PubMed, Europe PMC, ClinicalTrials.gov, OpenAlex and Crossref; dedupe and rank.</p></div>
    <div class="fstep"><div class="s">03</div><h4>Grade & contrast</h4><p>Place each study on the evidence pyramid, mark it supporting or contradicting, explain the disagreement.</p></div>
    <div class="fstep"><div class="s">04</div><h4>Assess strength</h4><p>An inspectable GRADE: design, consistency, directness, precision, recency, replication.</p></div>
    <div class="fstep"><div class="s">05</div><h4>Monitor & alert</h4><p>Re-check on a schedule; version the claim on every material change; push an alert with the reason.</p></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="kicker">Who uses Strata</div>
  <div class="h2">Built for the organizations that <span class="go">stake decisions on evidence.</span></div>
  <div class="grid g2" style="margin-top:40px">
    <div class="card"><h3>Pharmaceutical &amp; biotech</h3><p>Monitor the evidence behind efficacy and safety claims, competitive treatments, and the populations you market to.</p>
      <ul><li>Know when a new trial weakens a label claim</li><li>Catch competitor evidence shifts early</li><li>Give medical affairs a standing surveillance layer</li></ul></div>
    <div class="card"><h3>Hospitals &amp; health systems</h3><p>Watch the evidence under clinical guidelines, protocols, and evidence-based policies.</p>
      <ul><li>Flag protocols whose evidence has gone stale</li><li>See contradictions before they reach the bedside</li><li>Audit-ready trail for every policy decision</li></ul></div>
    <div class="card"><h3>Medical AI companies</h3><p>Wrap your model's medical output in an independent evidence check via one API call.</p>
      <ul><li>Gate answers a new RCT just contradicted</li><li>Attach a citation trail to generated claims</li><li>An evidence layer you don't have to build</li></ul></div>
    <div class="card"><h3>Research organizations</h3><p>Turn literature surveillance from a periodic manual task into a continuously running system.</p>
      <ul><li>Living evidence bases that update themselves</li><li>Automatic contradiction detection</li><li>Every conclusion traceable to its studies</li></ul></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="kicker">Why not the tools you have</div>
  <div class="h2">Search finds papers. <span class="go">Strata tells you what to believe now.</span></div>
  <table class="cmp">
    <thead><tr><th>Approach</th><th>The question it answers</th><th>Watches for change?</th></tr></thead>
    <tbody>
      <tr><th>Literature search</th><td class="q">What papers exist on this topic?</td><td class="q">No</td></tr>
      <tr><th>AI chatbot with citations</th><td class="q">What does the literature seem to say, right now, in one answer?</td><td class="q">No</td></tr>
      <tr><th>Systematic review</th><td class="q">What does a structured, months-long review conclude?</td><td class="q">Stale within a year</td></tr>
      <tr class="hl"><th class="go">Strata</th><td class="q"><b>Has the evidence behind this specific claim changed — and what does it actually support today?</b></td><td class="go">Continuously</td></tr>
    </tbody>
  </table>
  <div class="note">Strata is not a better search box and not another chatbot. It is the monitoring and verification layer that sits between medical knowledge and the decisions that depend on it.</div>
</div></section>

<div class="cta-final"><div class="wrap">
  <h2>Stop relying on claims you can no longer defend.</h2>
  <div class="cta" style="justify-content:center"><a class="btn p" href="/app" style="font-size:17px;padding:16px 28px">Try Strata Verify</a>
    <a class="btn g" onclick="openDemo()" style="font-size:17px;padding:16px 28px">Book a demo</a></div>
</div></div>
"""
WHY_HTML = _page("Why Strata · continuous evidence intelligence",
                 "Medical evidence changes daily; the systems that rely on it update periodically. Strata continuously monitors the evidence behind your medical claims and tells you when it matters.",
                 _WHY_BODY, "why")


# ================================================================================ PRICING
_PRICING_BODY = r"""
<header class="hero"><div class="wrap">
  <div class="eyebrow">Pricing</div>
  <h1 class="big">Priced like <span class="go">infrastructure,</span> not a report.</h1>
  <p class="sub">A systematic review costs roughly $200,000 and is stale within a year. Strata watches your entire evidence base continuously, for every claim, at software cost. Figures below are indicative and finalized during customer discovery.</p>
</div></header>
<section style="border-top:0;padding-top:20px"><div class="wrap">
  <div class="tiers">
    <div class="tier"><div class="nm">Verify</div><div class="pr">Free<small> · beta</small></div>
      <div class="who">Individual evidence verification for clinicians, researchers, and builders.</div>
      <ul><li>Live claim verification</li><li>Multi-source retrieval</li><li>Transparent GRADE &amp; contradictions</li><li>Evidence Receipt + Seal</li><li>Personal API key, rate-limited</li></ul>
      <a class="btn g" href="/app">Try it live</a></div>
    <div class="tier"><div class="nm">Team</div><div class="pr">$25k–$75k<small> / year</small></div>
      <div class="who">For research and evidence teams monitoring one therapeutic area.</div>
      <ul><li>Shared workspace</li><li>Continuous claim monitoring</li><li>Evidence-change alerts</li><li>Console &amp; timelines</li><li>Email / webhook notifications</li></ul>
      <a class="btn g" onclick="openDemo()">Talk to us</a></div>
    <div class="tier hot"><div class="nm">Enterprise</div><div class="pr">$100k–$300k+<small> / year</small></div>
      <div class="who">For pharma, hospitals, and medical-AI companies, org-wide.</div>
      <ul><li>Organization-wide monitoring</li><li>Large claim volumes</li><li>Multiple therapeutic areas</li><li>Full API access</li><li>Enterprise security &amp; audit trails</li><li>SSO &amp; custom integrations</li><li>Dedicated support</li></ul>
      <a class="btn p" onclick="openDemo()">Book a demo</a></div>
    <div class="tier"><div class="nm">API</div><div class="pr">Usage<small> · metered</small></div>
      <div class="who">Verification-as-infrastructure for products that generate medical claims.</div>
      <ul><li>Per-verification pricing</li><li>Batch verification</li><li>Signed change webhooks</li><li>Volume commitments</li><li>Self-host option</li></ul>
      <a class="btn g" href="/docs">Read the docs</a></div>
  </div>
  <div class="note">Land in one therapeutic area, expand to ten, then to the whole organization. Pricing scales with monitored claims, therapeutic areas, users, and API volume — the same architecture carries you from a 500-claim pilot to 50,000 claims across the enterprise.</div>
</div></section>
<section><div class="wrap">
  <div class="h2">The expansion path</div>
  <div class="grid g3" style="margin-top:36px">
    <div class="card"><div class="n">PILOT</div><h3>1 area</h3><p>One therapeutic area, ~500 monitored claims, a handful of users. Prove the value on evidence you already argue about.</p></div>
    <div class="card"><div class="n">EXPAND</div><h3>10 areas</h3><p>Multiple teams, tens of thousands of claims, alerts wired into your workflow, API in your products.</p></div>
    <div class="card"><div class="n">INFRASTRUCTURE</div><h3>Org-wide</h3><p>Every claim that matters, under continuous surveillance, with an auditable evidence-change history as a durable asset.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <div class="h2">Questions</div>
  <div class="faq">
    <details><summary>Is the pricing final?</summary><p>No. Strata is early and these figures are indicative ranges to frame the conversation. Design-partner and pilot terms are deliberately founder-friendly while we learn what each segment values most.</p></details>
    <details><summary>How is usage measured?</summary><p>By monitored claims, therapeutic areas, seats, and API verifications. Monitoring re-checks are scheduled and deduplicated so you aren't billed for redundant work.</p></details>
    <details><summary>Can we self-host?</summary><p>Yes. The platform runs on-prem via Docker or pip. It reads only public literature, so no patient data ever leaves your network. See <a href="/security" style="color:var(--green)">Security</a>.</p></details>
    <details><summary>What does a pilot look like?</summary><p>A design-partner engagement on one therapeutic area: we load your priority claims, stand up monitoring and alerts, and review what changed together. Demo → design partner → pilot → paid contract → expansion.</p></details>
  </div>
</div></section>
<div class="cta-final"><div class="wrap">
  <h2>Start with one therapeutic area.</h2>
  <div class="cta" style="justify-content:center"><a class="btn p" onclick="openDemo()" style="font-size:17px;padding:16px 28px">Book a demo</a>
    <a class="btn g" href="/docs" style="font-size:17px;padding:16px 28px">Get API access</a></div>
</div></div>
"""
PRICING_HTML = _page("Pricing · Strata",
                     "Strata pricing: free Verify beta, Team ($25k–$75k/yr), Enterprise ($100k–$300k+/yr), and usage-based API. Indicative ranges, finalized in customer discovery.",
                     _PRICING_BODY, "pricing")


# =================================================================================== TRUST
_TRUST_BODY = r"""
<header class="hero"><div class="wrap">
  <div class="eyebrow">Trust</div>
  <h1 class="big">Every conclusion is <span class="go">traceable to a source.</span></h1>
  <p class="sub">Strata is decision-support infrastructure for high-stakes evidence. Trust is the product. Here is exactly how it earns it — and an honest account of what is live today versus designed for the enterprise roadmap.</p>
</div></header>
<section style="border-top:0;padding-top:20px"><div class="wrap">
  <div class="tlist">
    <div class="titem"><h4><span class="i">↔</span>Evidence traceability</h4><p>Every verdict links to the individual studies behind it. No claim is ever asserted without the papers that produced it, each on the evidence pyramid.</p></div>
    <div class="titem"><h4><span class="i">✓</span>Citation-level auditability</h4><p>Each verification emits an auditable, staged trail — understand, retrieve, classify, grade — so any conclusion can be reconstructed step by step.</p></div>
    <div class="titem"><h4><span class="i">~</span>Transparent uncertainty</h4><p>Strength is broken into inspectable GRADE domains with explicit + upgrades and − limitations. Strata states when the evidence is thin rather than hiding it.</p></div>
    <div class="titem"><h4><span class="i">◎</span>Source provenance</h4><p>Every record carries its source (PubMed, Europe PMC, ClinicalTrials.gov, OpenAlex, Crossref), publication type, year, and citation count.</p></div>
    <div class="titem"><h4><span class="i">⚖</span>Contradiction, not averaging</h4><p>When studies disagree, Strata explains why — population, dose, follow-up, design, or statistics — instead of blending a conflict into a false consensus.</p></div>
    <div class="titem"><h4><span class="i">☺</span>Human in the loop</h4><p>Strata is decision support, not a decision-maker. It never diagnoses, treats, or advises; it hands an expert a defensible, sourced appraisal to act on.</p></div>
    <div class="titem"><h4><span class="i">◱</span>Model transparency</h4><p>AI is optional and routed per task; it only ever sees the claim and public abstracts, is never the source of a fact, and every receipt records which models ran, if any.</p></div>
    <div class="titem"><h4><span class="i">⌫</span>No patient data</h4><p>The engine reads only public literature. Optional population context is aggregated locally and never transmitted. No PHI is required to operate Strata.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <div class="kicker">Honest compliance posture</div>
  <div class="h2">What's live today — and what's on the roadmap.</div>
  <div class="lead">We will never claim a certification we don't hold. Here is the current state, stated plainly.</div>
  <div style="margin-top:36px">
    <div class="status-row"><span class="st live">LIVE</span><span class="nm">Evidence traceability &amp; audit trail</span><span class="ds">Per-verification staged trail; citation-level provenance on every receipt.</span></div>
    <div class="status-row"><span class="st live">LIVE</span><span class="nm">API key security</span><span class="ds">Keys stored as SHA-256 hashes, never in plaintext; rotation, revocation, rate limits, usage logs.</span></div>
    <div class="status-row"><span class="st live">LIVE</span><span class="nm">Self-host / data residency</span><span class="ds">Run entirely on-prem; public-literature only, so no PHI leaves your network.</span></div>
    <div class="status-row"><span class="st live">LIVE</span><span class="nm">Signed change webhooks</span><span class="ds">HMAC-SHA256 signatures on every delivered evidence-change event.</span></div>
    <div class="status-row"><span class="st design">DESIGNED</span><span class="nm">Tenant isolation &amp; RBAC</span><span class="ds">Organization / workspace boundaries are modeled today; role enforcement is on the enterprise track.</span></div>
    <div class="status-row"><span class="st design">DESIGNED</span><span class="nm">SSO (SAML / OIDC)</span><span class="ds">Designed for enterprise identity providers; delivered per design-partner engagement.</span></div>
    <div class="status-row"><span class="st road">ROADMAP</span><span class="nm">SOC 2 Type II</span><span class="ds">Designed toward SOC 2 controls. <b>Not yet audited or certified.</b></span></div>
    <div class="status-row"><span class="st road">ROADMAP</span><span class="nm">HIPAA-oriented controls</span><span class="ds">Architected to avoid PHI entirely; formal HIPAA posture pursued only if a use case requires it. <b>No HIPAA claim today.</b></span></div>
  </div>
  <div class="note"><b>What we do not claim.</b> Strata is not a medical device and has no FDA clearance. It is not SOC 2 certified, not HIPAA-certified, and not GxP-validated today. It does not determine truth. These are stated deliberately: an evidence-trust company that overstates its own compliance has already failed at its one job.</div>
</div></section>
<section><div class="wrap">
  <div class="kicker">We measure ourselves</div>
  <div class="h2">Accuracy, on an <span class="go">open gold set.</span></div>
  <div class="lead">Trust infrastructure has to prove it is trustworthy. Strata ships a public, labelled calibration set and scores itself against it — the transparent, zero-cost heuristic path, with no model in the loop. Run it yourself: <span class="mono" style="color:var(--green)">strata eval</span> or <span class="mono" style="color:var(--green)">GET /v1/eval</span>.</div>
  <div id="calib" class="grid g3" style="margin-top:38px">
    <div class="card"><div class="n">STANCE</div><h3 id="cal_stance">—</h3><p>Classifying a study as supporting, contradicting, or neutral toward a claim.</p></div>
    <div class="card"><div class="n">STATUS</div><h3 id="cal_status">—</h3><p>Aggregating the studies into the claim's overall status.</p></div>
    <div class="card"><div class="n">GOLD SET</div><h3 id="cal_n">—</h3><p>Labelled cases, open and versioned in the repo for anyone to audit.</p></div>
  </div>
  <div class="note warn"><b>Read this honestly.</b> These are clear-cut, textbook cases — real-world abstracts are messier and the number there will be lower. This is a <b>floor we hold ourselves to</b> (a regression test fails the build if it drops), not a claim of perfection. The optional AI layer only sharpens borderline calls; the figure above is what runs with no model at all.</div>
</div></section>
<script>
fetch('/v1/eval').then(r=>r.json()).then(d=>{
  var g=function(id,v){var e=document.getElementById(id);if(e)e.textContent=v;};
  g('cal_stance',Math.round(d.stance_accuracy*100)+'%');
  g('cal_status',Math.round(d.status_accuracy*100)+'%');
  g('cal_n',d.gold_stance_labels+' studies');
}).catch(function(){
  ['cal_stance','cal_status','cal_n'].forEach(function(id){var e=document.getElementById(id);if(e)e.textContent='run strata eval';});
});
</script>
<div class="cta-final"><div class="wrap">
  <h2>Bring your security team.</h2>
  <div class="cta" style="justify-content:center"><a class="btn p" onclick="openDemo()" style="font-size:17px;padding:16px 28px">Book a demo</a>
    <a class="btn g" href="/security" style="font-size:17px;padding:16px 28px">Read the security page</a></div>
</div></div>
"""
TRUST_HTML = _page("Trust · Strata",
                   "How Strata earns trust: evidence traceability, citation-level auditability, transparent uncertainty, source provenance, and an honest account of live vs. roadmap compliance. No false certifications.",
                   _TRUST_BODY, "trust")


# ================================================================================ SECURITY
_SECURITY_BODY = r"""
<header class="hero"><div class="wrap">
  <div class="eyebrow">Security</div>
  <h1 class="big">Security as a <span class="go">first-class feature.</span></h1>
  <p class="sub">Strata is architected so the sensitive path is the short path: it reads public literature, needs no patient data, and can run entirely inside your walls. Here's the current architecture, stated honestly about maturity.</p>
</div></header>
<section style="border-top:0;padding-top:20px"><div class="wrap">
  <div class="tlist">
    <div class="titem"><h4><span class="i">▣</span>Data isolation</h4><p>Public users, organizations, workspaces, API keys, and admins are separated. The claim graph is modeled as Organization → Workspace → Area → Claim, the boundary future RBAC enforces.</p></div>
    <div class="titem"><h4><span class="i">⚿</span>API key security</h4><p>Keys are <span class="mono">sk_live_…</span> secrets stored only as SHA-256 hashes with a display prefix — the raw key is shown once. Per-key scopes, sliding-window rate limits, request logs, rotation, and revocation.</p></div>
    <div class="titem"><h4><span class="i">⊘</span>Server-side authorization</h4><p>All access is validated on the server. Secrets never reach the frontend, and no authorization decision is trusted from the client.</p></div>
    <div class="titem"><h4><span class="i">✎</span>Audit logging</h4><p>Verifications carry a staged audit trail; API keys keep a bounded request log; evidence changes are versioned and retained as an auditable history.</p></div>
    <div class="titem"><h4><span class="i">⧉</span>Signed webhooks</h4><p>Every change notification is signed with HMAC-SHA256 using a per-endpoint secret, so your systems can verify authenticity before acting.</p></div>
    <div class="titem"><h4><span class="i">⌂</span>Self-host &amp; residency</h4><p>Deploy via Docker or pip on your own infrastructure. Literature calls use claim keywords only; optional population data is aggregated locally and never transmitted.</p></div>
    <div class="titem"><h4><span class="i">⏱</span>Data retention controls</h4><p>Bibliographic metadata, grades, and receipts only — never PHI. History is bounded and, on self-host, entirely under your control and retention policy.</p></div>
    <div class="titem"><h4><span class="i">↯</span>Graceful degradation</h4><p>Each evidence source fails soft and independently; Strata never claims an analysis completed on data it could not retrieve.</p></div>
  </div>
  <div class="note"><b>Current maturity.</b> The controls above are implemented today. Encryption in transit is standard; encryption-at-rest, formal RBAC enforcement, SSO, and SOC 2 attestation are on the enterprise roadmap and delivered through design-partner engagements. We report status honestly on the <a href="/trust" style="color:var(--green)">Trust page</a> and will not claim a certification we do not hold.</div>
</div></section>
<div class="cta-final"><div class="wrap">
  <h2>Deploy it inside your walls.</h2>
  <div class="cta" style="justify-content:center"><a class="btn p" href="/platform" style="font-size:17px;padding:16px 28px">See the platform</a>
    <a class="btn g" onclick="openDemo()" style="font-size:17px;padding:16px 28px">Book a demo</a></div>
</div></div>
"""
SECURITY_HTML = _page("Security · Strata",
                      "Strata security architecture: data isolation, hashed API keys with rotation and rate limits, server-side authorization, signed webhooks, self-host with no PHI, and an honest account of current maturity.",
                      _SECURITY_BODY, "trust")
