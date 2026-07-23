"""The public web surfaces: the landing page and the interactive Verify demo.

Design brief: bold, white, spacious, high-contrast. No mouse-type grey, no dense card
grids. The demo does not show "a box" of text; it runs a visible verification on screen,
then resolves to one big confident verdict. Standard library only, zero external deps,
embeddable offline via ``window.EMBED``.
"""
from __future__ import annotations

# shared design tokens + reset (kept identical across both pages for one visual language)
_CSS = r"""
:root{
  --bg:#04060a; --bg2:#080d13; --card:#0b1220; --line:rgba(255,255,255,.09);
  --ink:#ffffff; --ink2:#aab6b4;
  --green:#38e6a6; --red:#ff5d73; --amber:#ffc24b; --grey:#7c8a90;
  --sans:system-ui,-apple-system,"Segoe UI Variable","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono","Cascadia Code",Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);
  font-size:17px;line-height:1.5;-webkit-font-smoothing:antialiased;letter-spacing:-.01em}
a{color:inherit;text-decoration:none}
.mono{font-family:var(--mono)}
::selection{background:rgba(56,230,166,.3);color:#04140f}
.btn{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:15px;
  padding:14px 22px;border-radius:12px;cursor:pointer;border:0;transition:transform .15s ease,background .15s ease}
.btn:hover{transform:translateY(-2px)}
.btn.p{background:var(--green);color:#03140d}
.btn.g{background:transparent;color:#fff;border:1px solid var(--line)}
.btn.g:hover{background:rgba(255,255,255,.05)}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
"""

LANDING_HTML = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Strata · verification for medical AI</title>
<meta name="description" content="Strata checks whether a medical AI's claims are supported by science. One API call traces any claim to the research, grades the evidence, and flags contradictions."/>
<style>""" + _CSS + r"""
#top{position:absolute;top:0}
nav{position:sticky;top:0;z-index:50;background:rgba(4,6,10,.72);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
nav .wrap{display:flex;align-items:center;height:66px;gap:20px}
.logo{display:flex;align-items:center;gap:11px;font-weight:800;font-size:19px;letter-spacing:-.02em}
.logo .g{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#03140d;font-weight:900;background:var(--green)}
nav .sp{flex:1}
nav .lk{font-weight:600;font-size:15px;color:#fff;opacity:.75}
nav .lk:hover{opacity:1}
@media(max-width:640px){nav .lk.hide{display:none}}

.hero{text-align:center;padding:96px 0 60px}
.tagpill{display:inline-flex;align-items:center;gap:9px;font-family:var(--mono);font-size:12px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--green);border:1px solid rgba(56,230,166,.3);
  background:rgba(56,230,166,.06);padding:7px 14px;border-radius:30px;margin-bottom:30px}
.hero h1{font-size:clamp(2.6rem,7vw,5.2rem);font-weight:800;line-height:1.02;letter-spacing:-.035em;
  max-width:16ch;margin:0 auto}
.hero h1 .go{color:var(--green)}
.hero p{font-size:clamp(1.05rem,2vw,1.4rem);font-weight:500;color:#fff;max-width:30ch;margin:26px auto 0;line-height:1.4}
.hero .cta{display:flex;gap:14px;justify-content:center;margin-top:34px;flex-wrap:wrap}

/* the big verdict card */
.verdict{max-width:560px;margin:64px auto 0;background:linear-gradient(180deg,var(--card),#070c14);
  border:1px solid var(--line);border-radius:22px;padding:30px 32px;text-align:left;
  box-shadow:0 40px 120px -50px rgba(56,230,166,.35),0 30px 80px -40px #000}
.verdict .rh{display:flex;justify-content:space-between;align-items:center;font-family:var(--mono);
  font-size:11px;letter-spacing:.18em;color:#8ea0a0;text-transform:uppercase}
.live{display:inline-flex;align-items:center;gap:7px;color:var(--green)}
.live i{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pp 1.8s infinite}
@keyframes pp{0%{box-shadow:0 0 0 0 rgba(56,230,166,.6)}70%,100%{box-shadow:0 0 0 8px transparent}}
.verdict .claim{font-size:19px;font-weight:600;margin:16px 0 22px;line-height:1.35}
.verdict .big{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.verdict .status{font-size:44px;font-weight:900;letter-spacing:-.03em;line-height:1;color:var(--green);opacity:0;transform:translateY(8px);animation:rise .5s .2s forwards}
@keyframes rise{to{opacity:1;transform:none}}
.verdict .cert{font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.08em;
  border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:6px 10px;color:#fff}
.splitbar{height:12px;border-radius:8px;overflow:hidden;display:flex;background:#101922;margin:24px 0 12px}
.splitbar .s{background:var(--green);width:0;animation:grow .8s .35s forwards cubic-bezier(.2,.8,.2,1)}
.splitbar .c{background:var(--red);width:0;animation:grow2 .8s .45s forwards cubic-bezier(.2,.8,.2,1)}
@keyframes grow{to{width:80%}}@keyframes grow2{to{width:14%}}
.legend{display:flex;gap:20px;font-weight:700;font-size:15px}
.legend .s{color:var(--green)}.legend .c{color:var(--red)}
.verdict .src{margin-top:18px;font-size:15px;font-weight:500;color:#fff;opacity:.85}

/* sections */
section{padding:100px 0;border-top:1px solid var(--line)}
.reveal{opacity:0;transform:translateY(24px);transition:opacity .7s ease,transform .7s ease}
.reveal.in{opacity:1;transform:none}
.big-statement{font-size:clamp(2rem,5vw,3.6rem);font-weight:800;letter-spacing:-.03em;line-height:1.08;max-width:20ch}
.big-statement .dim{color:var(--grey)}
.big-statement .go{color:var(--green)}
.lead{font-size:clamp(1.1rem,2vw,1.35rem);font-weight:500;color:#fff;max-width:40ch;margin-top:22px}

.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:60px}
@media(max-width:800px){.steps{grid-template-columns:1fr;gap:44px}}
.step .n{font-family:var(--mono);font-size:14px;font-weight:700;color:var(--green);margin-bottom:16px}
.step h3{font-size:26px;font-weight:800;letter-spacing:-.02em;margin-bottom:10px}
.step p{font-size:17px;font-weight:500;color:#fff;opacity:.72;max-width:24ch}

.prod{display:flex;flex-direction:column;gap:0;margin-top:50px;border-top:1px solid var(--line)}
.prow{display:grid;grid-template-columns:220px 1fr;gap:30px;padding:34px 4px;border-bottom:1px solid var(--line);align-items:baseline}
@media(max-width:700px){.prow{grid-template-columns:1fr;gap:8px}}
.prow .nm{font-size:30px;font-weight:800;letter-spacing:-.02em}
.prow .nm small{display:block;font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--green);text-transform:uppercase;margin-top:8px}
.prow p{font-size:19px;font-weight:500;color:#fff}

.code{background:#02040733;border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-top:36px}
.code .bar{display:flex;gap:8px;padding:14px 18px;border-bottom:1px solid var(--line)}
.code .bar i{width:11px;height:11px;border-radius:50%;background:#2a3542;display:inline-block}
.code pre{margin:0;padding:22px;overflow-x:auto;font-family:var(--mono);font-size:14.5px;line-height:1.75;color:#dfeae7}
.code .k{color:var(--green)}.code .s{color:#8fd0ff}.code .c{color:#68787f}

.price{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:52px}
@media(max-width:800px){.price{grid-template-columns:1fr}}
.tier{border:1px solid var(--line);border-radius:18px;padding:30px}
.tier.hot{border-color:var(--green);background:rgba(56,230,166,.04)}
.tier .nm{font-family:var(--mono);font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green);margin-bottom:16px}
.tier h3{font-size:26px;font-weight:800;margin-bottom:6px}
.tier .who{font-size:16px;font-weight:500;color:#fff;opacity:.7}

.cta-final{text-align:center;padding:120px 0}
.cta-final h2{font-size:clamp(2.2rem,6vw,4.4rem);font-weight:800;letter-spacing:-.035em;line-height:1.05;max-width:16ch;margin:0 auto 34px}
footer{border-top:1px solid var(--line);padding:40px 0}
footer .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:center}
footer .disc{font-size:14px;font-weight:500;color:#fff;opacity:.55;max-width:60ch;margin-top:18px;line-height:1.6}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.reveal{opacity:1;transform:none}.splitbar .s{width:80%}.splitbar .c{width:14%}.verdict .status{opacity:1;transform:none}}
</style></head><body><span id="top"></span>

<nav><div class="wrap">
  <a class="logo" href="#top"><span class="g">S</span> Strata</a>
  <span class="sp"></span>
  <a class="lk hide" href="#how">How it works</a>
  <a class="lk hide" href="#products">Products</a>
  <a class="lk hide" href="#developers">Developers</a>
  <a class="btn p" href="/app" style="padding:10px 18px;font-size:14px">Try it live</a>
</div></nav>

<header class="hero"><div class="wrap">
  <div class="tagpill"><span style="width:14px;display:inline-flex;flex-direction:column;gap:2px">
    <span style="height:2px;width:55%;background:var(--green);display:block"></span>
    <span style="height:2px;width:80%;background:var(--amber);display:block"></span>
    <span style="height:2px;width:100%;background:var(--red);display:block"></span></span>
    Verification for medical AI</div>
  <h1>Every medical AI makes claims. <span class="go">Strata checks them.</span></h1>
  <p>One API call traces any medical claim to the research, grades the evidence, and flags what contradicts it.</p>
  <div class="cta"><a class="btn p" href="/app">Verify a claim</a><a class="btn g" href="#developers">Read the docs</a></div>

  <div class="verdict">
    <div class="rh"><span class="live"><i></i> Strata Verify</span><span>STR-8F42A1C9</span></div>
    <div class="claim">"Drug X reduces hospitalization in patients with heart failure."</div>
    <div class="big"><span class="status">SUPPORTED</span><span class="cert">MODERATE CERTAINTY</span></div>
    <div class="splitbar"><span class="s"></span><span class="c"></span></div>
    <div class="legend"><span class="s">12 supporting</span><span class="c">3 contradicting</span></div>
    <div class="src">Backed by a meta-analysis of 20 randomized trials. Weaker in patients over 80.</div>
  </div>
</div></header>

<section id="problem"><div class="wrap reveal">
  <div class="big-statement">Thousands of medical AIs.<br>Millions of claims.<br><span class="dim">Nobody checking the evidence.</span></div>
  <div class="lead">Today companies ship AI, then an answer. Medicine needs a third step. An independent check that the answer is backed by science. That layer does not exist yet. Strata is building it.</div>
</div></section>

<section id="how"><div class="wrap">
  <div class="big-statement reveal">Claim in. Verdict out.<br><span class="go">Watched forever.</span></div>
  <div class="steps reveal">
    <div class="step"><div class="n">01 / TRACE</div><h3>Find the studies</h3><p>Strata pulls the research that speaks to the exact claim.</p></div>
    <div class="step"><div class="n">02 / GRADE</div><h3>Weigh the evidence</h3><p>Every study is ranked and marked supporting, contradicting, or neutral.</p></div>
    <div class="step"><div class="n">03 / VERDICT</div><h3>Return a receipt</h3><p>A status, a strength, the key limitation, and a citation for every word.</p></div>
  </div>
</div></section>

<section id="products"><div class="wrap">
  <div class="big-statement reveal">Three products.<br>One evidence engine.</div>
  <div class="prod reveal">
    <div class="prow"><div class="nm">Verify<small>API</small></div><p>Send a claim, get an Evidence Receipt. A software API, priced by usage. The margin engine.</p></div>
    <div class="prow"><div class="nm">Monitor<small>Dashboard</small></div><p>Watch every claim about your products. Strata tells you the moment the evidence changes.</p></div>
    <div class="prow"><div class="nm">Seal<small>Trust mark</small></div><p>An "Evidence Verified" badge you can show. Like SSL, for medical claims.</p></div>
  </div>
</div></section>

<section id="changed"><div class="wrap reveal">
  <div class="big-statement">Evidence changes.<br><span class="go">You find out first.</span></div>
  <div class="lead">A new trial lands and certainty jumps from moderate to high. A new study contradicts consensus. Strata watches the literature across all your claims and pushes the change the moment it matters. That is the difference between a report and infrastructure.</div>
</div></section>

<section id="developers"><div class="wrap">
  <div class="big-statement reveal">One call to verify any claim.</div>
  <div class="code reveal">
    <div class="bar"><i></i><i></i><i></i></div>
    <pre><span class="c"># Wrap your medical AI's output in an independent check</span>
curl -X POST https://api.strata.health/v1/verify \
  -H <span class="s">"Authorization: Bearer $STRATA_KEY"</span> \
  -d <span class="s">'{"claim": "SGLT2 inhibitors reduce heart-failure hospitalization"}'</span>

<span class="c"># {</span>
<span class="c">#   "status": "Supported",  "strength": "high",</span>
<span class="c">#   "supporting": 5,  "contradicting": 0,</span>
<span class="c">#   "citations": [ ... every claim traceable to a paper ]</span>
<span class="c"># }</span></pre>
  </div>
</div></section>

<section id="pricing"><div class="wrap">
  <div class="big-statement reveal">A systematic review costs <span class="go">$200,000</span> and is stale within a year.</div>
  <div class="lead reveal">Strata watches your entire evidence base continuously, for every claim, at software cost.</div>
  <div class="price reveal">
    <div class="tier"><div class="nm">Verify</div><h3>Usage based</h3><div class="who">For AI products, priced per claim.</div></div>
    <div class="tier hot"><div class="nm">Monitor</div><h3>Enterprise</h3><div class="who">For pharma, hospitals, and payers.</div></div>
    <div class="tier"><div class="nm">Platform</div><h3>Custom</h3><div class="who">Org-wide evidence infrastructure.</div></div>
  </div>
</div></section>

<div class="cta-final"><div class="wrap reveal">
  <h2>Stop shipping medical AI you can't defend.</h2>
  <a class="btn p" href="/app" style="font-size:17px;padding:16px 28px">Verify a claim</a>
</div></div>

<footer><div class="wrap">
  <div style="display:flex;justify-content:space-between;width:100%;gap:20px;flex-wrap:wrap">
    <a class="logo" href="#top"><span class="g">S</span> Strata</a>
    <div style="display:flex;gap:22px;font-weight:600"><a href="/app">Demo</a><a href="/console">Console</a><a href="#developers">API</a></div>
  </div>
  <div class="disc">Strata appraises published literature for decision support. It is not a medical device, handles no patient data, and does not diagnose, treat, advise, or determine truth. Every claim links to its sources.</div>
</div></footer>

<script>
const io=new IntersectionObserver((es)=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}}),{threshold:.15});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
</script></body></html>"""


VERIFY_DEMO_HTML = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Strata Verify · check a medical claim</title>
<style>""" + _CSS + r"""
body{font-size:16px}
nav{position:sticky;top:0;z-index:50;background:rgba(4,6,10,.75);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
nav .wrap{display:flex;align-items:center;height:60px;gap:16px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px;letter-spacing:-.02em}
.logo .g{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:#03140d;font-weight:900;background:var(--green)}
.logo .k{font-family:var(--mono);font-size:11px;letter-spacing:.18em;color:#7c8a90;text-transform:uppercase}
nav .sp{flex:1}nav a.lk{font-weight:600;color:#fff;opacity:.7}nav a.lk:hover{opacity:1}
.head{max-width:820px;margin:0 auto;padding:52px 24px 0;text-align:center}
.head h1{font-size:clamp(2rem,5vw,3.2rem);font-weight:800;letter-spacing:-.03em;line-height:1.05}
.head p{font-size:18px;font-weight:500;color:#fff;opacity:.72;margin-top:16px}
.searchbox{max-width:760px;margin:34px auto 0;padding:0 24px}
.search{display:flex;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:8px 8px 8px 20px;
  box-shadow:0 30px 80px -50px rgba(56,230,166,.4)}
.search:focus-within{border-color:rgba(56,230,166,.5)}
.search input{flex:1;background:transparent;border:0;outline:0;color:#fff;font-size:17px;font-weight:500}
.search button{border:0;border-radius:12px;background:var(--green);color:#03140d;font-weight:800;font-size:15px;padding:0 24px;cursor:pointer}
.search button:disabled{opacity:.5}
.chips{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:16px}
.chip{font-size:14px;font-weight:600;color:#fff;background:rgba(255,255,255,.05);border:1px solid var(--line);
  border-radius:30px;padding:8px 15px;cursor:pointer}
.chip:hover{border-color:rgba(56,230,166,.5)}
.wrap2{max-width:820px;margin:0 auto;padding:0 24px 40px}
#stage{margin-top:34px;min-height:60px}

/* scanning animation */
.scan{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px 28px}
.scan .top{display:flex;align-items:center;gap:12px;font-weight:700;font-size:18px}
.scan .sp{width:18px;height:18px;border:2.5px solid var(--green);border-top-color:transparent;border-radius:50%;animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.scan .count{margin-left:auto;font-family:var(--mono);color:var(--green);font-weight:700}
.dots{display:flex;flex-wrap:wrap;gap:7px;margin-top:20px}
.dots i{width:11px;height:11px;border-radius:3px;background:#18222c;opacity:.4;transition:.25s}
.dots i.s{background:var(--green);opacity:1}.dots i.c{background:var(--red);opacity:1}.dots i.n{background:var(--grey);opacity:.7}
.classify{margin-top:18px;display:flex;flex-direction:column;gap:8px}
.crow{display:flex;gap:12px;align-items:center;font-size:15px;opacity:0;transform:translateX(-8px);animation:cin .3s forwards}
@keyframes cin{to{opacity:1;transform:none}}
.crow .tag{font-family:var(--mono);font-weight:800;font-size:15px;width:20px;text-align:center}
.crow .ti{font-weight:600;color:#fff}.crow .mt{color:#8ea0a0;font-size:13px;font-weight:500}

/* the big verdict */
.rcard{background:linear-gradient(180deg,var(--card),#070c14);border:1px solid var(--line);border-radius:22px;
  padding:30px 32px;box-shadow:0 40px 120px -60px rgba(56,230,166,.3)}
.rcard .rh{display:flex;justify-content:space-between;align-items:center;font-family:var(--mono);font-size:11px;
  letter-spacing:.16em;text-transform:uppercase;color:#8ea0a0}
.rcard .claim{font-size:21px;font-weight:700;letter-spacing:-.01em;margin:16px 0 22px;line-height:1.3}
.bigv{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.bigv .status{font-size:46px;font-weight:900;letter-spacing:-.03em;line-height:1}
.bigv .cert{font-family:var(--mono);font-size:13px;font-weight:700;letter-spacing:.06em;border:1px solid rgba(255,255,255,.2);
  border-radius:9px;padding:7px 12px;color:#fff}
.blurb{font-size:17px;font-weight:500;color:#fff;opacity:.82;margin-top:14px}
.split{height:14px;border-radius:9px;overflow:hidden;display:flex;background:#101922;margin:26px 0 12px}
.split .s{background:var(--green)}.split .c{background:var(--red)}.split .n{background:#2b3742}
.slabels{display:flex;gap:22px;font-weight:800;font-size:16px}
.slabels .s{color:var(--green)}.slabels .c{color:var(--red)}.slabels .n{color:#8ea0a0}
.lim{margin-top:18px;background:rgba(255,194,75,.08);border:1px solid rgba(255,194,75,.28);border-radius:12px;
  padding:14px 16px;font-size:16px;font-weight:600;color:#ffce70}
.strong{margin-top:16px;font-size:16px;font-weight:600;color:#fff}
.cites{margin-top:24px;border-top:1px solid var(--line);padding-top:8px}
.cite{display:grid;grid-template-columns:24px 1fr auto;gap:12px;align-items:baseline;padding:12px 0;border-bottom:1px solid var(--line)}
.cite .tg{font-family:var(--mono);font-weight:800;font-size:16px}
.cite .ti{font-size:15px;font-weight:600;color:#fff}
.cite .mt{font-size:13px;font-weight:500;color:#8ea0a0;margin-top:3px}
.cite a{font-family:var(--mono);font-size:12px;color:var(--green);white-space:nowrap;font-weight:700}
.tagpill2{font-family:var(--mono);font-size:11px;font-weight:800;padding:3px 9px;border-radius:6px;color:#03140d}

/* monitor section */
.monsec{border-top:1px solid var(--line);margin-top:70px;padding-top:56px}
.monsec .kh{text-align:center;max-width:640px;margin:0 auto 8px}
.monsec h2{font-size:clamp(1.8rem,4vw,2.6rem);font-weight:800;letter-spacing:-.03em}
.monsec .ks{font-size:17px;font-weight:500;color:#fff;opacity:.72;margin-top:12px}
.board{display:flex;flex-direction:column;gap:12px;margin-top:34px}
.mrow{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;background:var(--card);
  border:1px solid var(--line);border-radius:16px;padding:20px 22px;cursor:pointer;transition:border .15s}
.mrow:hover{border-color:rgba(56,230,166,.4)}
.mrow .c{font-size:18px;font-weight:700;letter-spacing:-.01em;line-height:1.3}
.mrow .sub{display:flex;gap:14px;align-items:center;margin-top:10px;font-weight:700;font-size:14px}
.mrow .alert{font-family:var(--mono);font-size:12px;font-weight:800;letter-spacing:.04em;padding:6px 12px;border-radius:8px;white-space:nowrap}
.statusword{font-weight:800}
.timeline{display:flex;align-items:center;gap:10px;margin:22px 0 6px;flex-wrap:wrap}
.tnode{display:flex;flex-direction:column;gap:5px;align-items:center}
.tnode .dt{font-family:var(--mono);font-size:11px;color:#8ea0a0}
.tnode .pill{font-weight:800;font-size:14px;padding:6px 12px;border-radius:9px;border:1px solid var(--line)}
.tarrow{color:#8ea0a0;font-size:22px;font-weight:800}
.evline{display:flex;gap:10px;align-items:center;font-size:15px;font-weight:600;padding:8px 0}
.evline .b{font-family:var(--mono);font-size:11px;font-weight:800;padding:3px 8px;border-radius:6px;color:#03140d}
.spin{display:inline-block;width:15px;height:15px;border:2.5px solid #03140d;border-top-color:transparent;border-radius:50%;animation:sp .7s linear infinite;vertical-align:-2px}
.err{background:rgba(255,93,115,.08);border:1px solid rgba(255,93,115,.3);color:#ff9aa8;padding:16px 18px;border-radius:14px;font-size:16px;font-weight:600}
.foot{text-align:center;color:#fff;opacity:.5;font-size:14px;margin:56px 0 30px;line-height:1.7}
@media (prefers-reduced-motion:reduce){*{animation-duration:.001s!important}}
</style></head><body>
<nav><div class="wrap"><a class="logo" href="/"><span class="g">S</span> Strata <span class="k">Verify</span></a>
  <span class="sp"></span><a class="lk" href="/console">Console</a><a class="lk" href="/">Home</a></div></nav>

<div class="head"><h1>Is it backed by evidence?</h1>
  <p>Paste a medical claim. Watch Strata trace it to the research, grade it, and surface what contradicts it.</p></div>
<div class="searchbox">
  <div class="search"><input id="q" placeholder="Metformin reduces cardiovascular mortality in type 2 diabetes" autofocus/>
    <button id="go">Verify</button></div>
  <div class="chips" id="chips"></div>
</div>
<div class="wrap2">
  <div id="stage"></div>
  <div class="monsec">
    <div class="kh"><h2>This is why hospitals pay for it</h2>
      <div class="ks">Strata watches thousands of claims and tells you the moment the evidence turns. Click a claim to see how its verdict moved over time.</div></div>
    <div class="board" id="board"></div>
  </div>
  <div class="foot">Strata verifies published literature for decision support. Not a medical device. No patient data. No diagnosis.</div>
</div>

<script>
const $=(s,r=document)=>r.querySelector(s);
const RM=matchMedia('(prefers-reduced-motion:reduce)').matches;
const SC={Supported:'#38e6a6',Mixed:'#ffc24b',Contested:'#ffc24b',Contradicted:'#ff5d73',Insufficient:'#7c8a90',Unsupported:'#7c8a90'};
const STC={high:'#38e6a6',moderate:'#ffc24b',low:'#ff9a4b','very low':'#ff5d73',none:'#7c8a90'};
const GLY={support:['▲','#38e6a6'],contradict:['▼','#ff5d73'],neutral:['●','#7c8a90']};
const BLURB={Supported:'The weight of evidence supports this claim.',Mixed:'The evidence is split. Real support, real conflict.',
  Contradicted:'The weight of evidence runs against this claim.',Insufficient:'Too little good evidence to judge yet.',Unsupported:'No directional evidence was found for this claim.'};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm=s=>s.trim().toLowerCase().replace(/[?.]+$/,'').replace(/\s+/g,' ');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const EX=["Metformin reduces cardiovascular mortality in type 2 diabetes",
  "SGLT2 inhibitors reduce heart-failure hospitalization",
  "Vitamin D supplementation reduces the risk of acute respiratory infections",
  "Intermittent fasting reduces cardiovascular mortality"];
$('#chips').innerHTML=EX.map(e=>`<span class="chip">${esc(e)}</span>`).join('');
$('#chips').onclick=e=>{if(e.target.classList.contains('chip')){$('#q').value=e.target.textContent;run();}};
$('#go').onclick=run;$('#q').addEventListener('keydown',e=>{if(e.key==='Enter')run();});

async function getReceipt(claim){
  if(window.EMBED){const e=(EMBED.examples||[]).find(x=>norm(x.claim)===norm(claim));return e?e.receipt:'nomatch';}
  const r=await(await fetch('/v1/verify?claim='+encodeURIComponent(claim))).json();
  return r.error?null:r;
}
async function run(){
  const claim=$('#q').value.trim();if(!claim)return;
  $('#go').disabled=true;$('#go').innerHTML='<span class="spin"></span>';
  try{
    const r=await getReceipt(claim);
    if(r==='nomatch'){$('#stage').innerHTML='<div class="err">This demo has live receipts for the example claims below. Free-text verification runs against the API. Try an example, or run Strata locally.</div>';return;}
    if(!r){$('#stage').innerHTML='<div class="err">Could not verify. The evidence source may be unreachable.</div>';return;}
    if(!RM) await animate(r);
    renderVerdict(r);
    window.scrollTo({top:0,behavior:'smooth'});
  }catch(e){$('#stage').innerHTML=`<div class="err">${esc(e.message||e)}</div>`;}
  finally{$('#go').disabled=false;$('#go').textContent='Verify';}
}

async function animate(r){
  const total=Math.max(r.total||r.citations.length,r.citations.length);
  $('#stage').innerHTML=`<div class="scan"><div class="top"><span class="sp"></span>
    Searching the medical literature<span class="count" id="cnt">0 studies</span></div>
    <div class="dots" id="dots"></div><div class="classify" id="cl"></div></div>`;
  const dots=$('#dots');for(let i=0;i<total;i++){const d=document.createElement('i');dots.appendChild(d);}
  const cnt=$('#cnt');
  for(let i=1;i<=total;i++){cnt.textContent=i+' studies';await sleep(280/total*total/Math.max(total,6));}
  cnt.textContent=total+' studies found';
  await sleep(180);
  const cl=$('#cl');const ds=[...dots.children];
  let s=0,c=0,n=0;
  for(let i=0;i<r.citations.length;i++){
    const ci=r.citations[i];const g=GLY[ci.stance]||GLY.neutral;
    ds[i]&&(ds[i].className=ci.stance==='support'?'s':ci.stance==='contradict'?'c':'n');
    if(ci.stance==='support')s++;else if(ci.stance==='contradict')c++;else n++;
    const row=document.createElement('div');row.className='crow';
    row.innerHTML=`<span class="tag" style="color:${g[1]}">${g[0]}</span>
      <span><span class="ti">${esc(ci.label)}</span> <span class="mt">${ci.year||''} ${esc(shortTitle(ci.title))}</span></span>`;
    cl.appendChild(row);
    await sleep(RM?0:150);
  }
  await sleep(260);
}
function shortTitle(t){t=t||'';return t.length>52?t.slice(0,52)+'…':t;}

function renderVerdict(r,extra){
  const col=SC[r.status]||'#7c8a90';const t=Math.max(1,r.supporting+r.contradicting+r.neutral);
  const w=n=>Math.round(100*n/t);
  const cites=(r.citations||[]).map(c=>{const g=GLY[c.stance]||GLY.neutral;
    const eff=c.effect&&c.effect.value!=null?`${c.effect.measure} ${c.effect.value.toFixed(2)} (${c.effect.ci_low} to ${c.effect.ci_high})`:'';
    return `<div class="cite"><span class="tg" style="color:${g[1]}">${g[0]}</span>
      <div><div class="ti">${esc(c.title)}</div><div class="mt">
        <span class="tagpill2" style="background:${STC[c.strength]||'#7c8a90'}">${esc(c.label)}</span>
        ${c.year||''} ${eff?'· '+esc(eff):''}</div></div>
      <a href="${esc(c.url)}" target="_blank" rel="noopener">PubMed</a></div>`;}).join('');
  const strong=r.highest_evidence?`<div class="strong">Strongest evidence: ${esc(r.highest_evidence.label)} (${r.highest_evidence.year||'n.d.'}).</div>`:'';
  const lim=r.key_limitation?`<div class="lim">${esc(r.key_limitation)}</div>`:'';
  $('#stage').innerHTML=`<div class="rcard">
    <div class="rh"><span>Strata Evidence Receipt</span><span>${esc(r.receipt_id||'')}</span></div>
    <div class="claim">"${esc(r.claim)}"</div>
    <div class="bigv"><span class="status" style="color:${col}">${esc((r.status||'').toUpperCase())}</span>
      <span class="cert">${esc((r.strength||'').toUpperCase())} CERTAINTY</span></div>
    <div class="blurb">${esc(BLURB[r.status]||'')}</div>
    <div class="split"><span class="s" style="width:${w(r.supporting)}%"></span>
      <span class="c" style="width:${w(r.contradicting)}%"></span><span class="n" style="width:${w(r.neutral)}%"></span></div>
    <div class="slabels"><span class="s">${r.supporting} supporting</span>
      <span class="c">${r.contradicting} contradicting</span><span class="n">${r.neutral} neutral</span></div>
    ${strong}${lim}${extra||''}
    <div class="cites">${cites}</div></div>`;
}

/* ---- monitor board ---- */
async function loadBoard(){
  try{
    const d=window.EMBED?{claims:EMBED.claims}:await(await fetch('/v1/monitor')).json();
    $('#board').innerHTML=(d.claims||[]).map(c=>{
      const col=SC[c.status]||'#7c8a90';
      const alert=c.evidence_changed?`<span class="alert" style="background:${col};color:#03140d">EVIDENCE CHANGED</span>`
        :`<span class="alert" style="border:1px solid var(--line);color:#8ea0a0">stable</span>`;
      return `<div class="mrow" data-id="${esc(c.id)}"><div><div class="c">${esc(c.claim)}</div>
        <div class="sub"><span class="statusword" style="color:${col}">${esc(c.status||'')}</span>
          <span style="color:var(--green)">▲${c.supporting||0}</span>
          <span style="color:var(--red)">▼${c.contradicting||0}</span></div></div>${alert}</div>`;}).join('');
    document.querySelectorAll('.mrow').forEach(b=>b.onclick=()=>openClaim(b.dataset.id));
  }catch(e){$('#board').innerHTML='<div class="err">Monitor board unavailable.</div>';}
}
async function openClaim(id){
  const v=window.EMBED?EMBED.views[id]:await(await fetch('/v1/monitor/get?id='+encodeURIComponent(id))).json();
  if(!v||v.error)return;
  const r=v.receipt;$('#q').value=r.claim;
  const h=v.history||[];
  let tl='';
  if(h.length>1){tl='<div class="timeline">';h.forEach((x,i)=>{const col=SC[x.status]||'#7c8a90';
    tl+=`<div class="tnode"><span class="dt">${esc((x.checked||'').slice(0,10))}</span>
      <span class="pill" style="color:${col};border-color:${col}">${esc(x.status)}</span></div>`;
    if(i<h.length-1)tl+='<span class="tarrow">→</span>';});tl+='</div>';}
  const ch=v.change||{};let feed='';
  (ch.events||[]).forEach(e=>{const bc={green:'#38e6a6',amber:'#ffc24b',red:'#ff5d73'}[e.level]||'#7c8a90';
    feed+=`<div class="evline"><span class="b" style="background:${bc}">${esc((e.type||'').replace('_',' ').toUpperCase())}</span><span>${esc(e.text)}</span></div>`;});
  renderVerdict(r,tl+feed);
  window.scrollTo({top:0,behavior:'smooth'});
}
loadBoard();
</script></body></html>"""
