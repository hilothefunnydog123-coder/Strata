"""The web interface: one HTML document, no build step, no dependencies.

Design notes, since this is the part people judge first.

*Information density over decoration.* A clinician is scanning for the certainty
verdict, the design mix, and whether the papers agree. Those three answers sit
above the fold. Nothing on the page is animated for its own sake.

*Colour carries meaning or it is absent.* The evidence-level ramp is the only
place hue is used semantically — it runs green through red down the pyramid, with
preclinical set apart in indigo because a mouse study is not weak clinical
evidence, it is a different kind of thing. Everything else is ink, paper and one
accent.

*The forest plot is drawn, not faked.* It is real SVG on a log axis with marker
size proportional to precision, plotted from intervals actually stated in the
abstracts. Studies that report no interval are listed but not drawn, because
inventing a width for them would be a lie of exactly the kind this tool exists to
prevent.

*Both themes are first class.* The page follows the system setting and offers a
manual override that persists.
"""
from __future__ import annotations

PAGE = r"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<title>Strata — clinical evidence, graded</title>
<style>
:root{
  --bg:#fbfbfa; --surface:#fff; --surface-2:#f5f5f4; --ink:#16181d;
  --ink-2:#3f434b; --muted:#6b7280; --line:#e5e6e9; --line-2:#d3d5da;
  --accent:#0f766e; --accent-soft:rgba(15,118,110,.09); --on-accent:#fff;
  --l1:#15803d; --l2:#22a04a; --l3:#ca8a04; --l4:#ea580c; --l5:#dc2626;
  --l6:#71717a; --l7:#4f46e5;
  --ok:#15803d; --warn:#b45309; --bad:#b91c1c;
  --radius:10px; --shadow:0 1px 2px rgba(16,18,24,.05),0 1px 8px rgba(16,18,24,.04);
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0d0f12; --surface:#15181d; --surface-2:#1b1f26; --ink:#e9ebef;
    --ink-2:#c2c7d0; --muted:#8d95a1; --line:#252a32; --line-2:#333a44;
    --accent:#2dd4bf; --accent-soft:rgba(45,212,191,.11); --on-accent:#06201d;
    --l1:#4ade80; --l2:#34d399; --l3:#fbbf24; --l4:#fb923c; --l5:#f87171;
    --l6:#9ca3af; --l7:#a5b4fc;
    --ok:#4ade80; --warn:#fbbf24; --bad:#f87171;
    --shadow:0 1px 2px rgba(0,0,0,.4),0 1px 10px rgba(0,0,0,.25);
  }
}
:root[data-theme="light"]{
  --bg:#fbfbfa; --surface:#fff; --surface-2:#f5f5f4; --ink:#16181d;
  --ink-2:#3f434b; --muted:#6b7280; --line:#e5e6e9; --line-2:#d3d5da;
  --accent:#0f766e; --accent-soft:rgba(15,118,110,.09); --on-accent:#fff;
  --l1:#15803d; --l2:#22a04a; --l3:#ca8a04; --l4:#ea580c; --l5:#dc2626;
  --l6:#71717a; --l7:#4f46e5; --ok:#15803d; --warn:#b45309; --bad:#b91c1c;
  --shadow:0 1px 2px rgba(16,18,24,.05),0 1px 8px rgba(16,18,24,.04);
}
:root[data-theme="dark"]{
  --bg:#0d0f12; --surface:#15181d; --surface-2:#1b1f26; --ink:#e9ebef;
  --ink-2:#c2c7d0; --muted:#8d95a1; --line:#252a32; --line-2:#333a44;
  --accent:#2dd4bf; --accent-soft:rgba(45,212,191,.11); --on-accent:#06201d;
  --l1:#4ade80; --l2:#34d399; --l3:#fbbf24; --l4:#fb923c; --l5:#f87171;
  --l6:#9ca3af; --l7:#a5b4fc; --ok:#4ade80; --warn:#fbbf24; --bad:#f87171;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 1px 10px rgba(0,0,0,.25);
}

*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{
  background:var(--bg); color:var(--ink);
  font:15px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",
       Roboto,"Helvetica Neue",Arial,sans-serif;
  font-feature-settings:"kern" 1,"liga" 1; -webkit-font-smoothing:antialiased;
  overflow-x:hidden;
}
.wrap{max-width:1080px;margin:0 auto;padding:32px 24px 96px}
@media(max-width:640px){.wrap{padding:20px 16px 64px}}

/* ---------------------------------------------------------------- header */
header{display:flex;align-items:flex-start;gap:14px;margin-bottom:4px}
.mark{width:34px;height:34px;flex:none;border-radius:9px;background:var(--ink);
  display:grid;place-items:center;margin-top:2px}
.mark svg{display:block}
h1{font-size:21px;font-weight:660;letter-spacing:-.021em;line-height:1.25}
.sub{color:var(--muted);font-size:13.5px;margin-top:1px;max-width:62ch}
.theme{margin-left:auto;background:none;border:1px solid var(--line);
  color:var(--muted);border-radius:8px;width:32px;height:32px;cursor:pointer;
  display:grid;place-items:center;font-size:14px;flex:none}
.theme:hover{border-color:var(--line-2);color:var(--ink)}

/* ---------------------------------------------------------------- search */
form{margin:24px 0 10px;display:flex;gap:8px}
.field{position:relative;flex:1}
.field input{
  width:100%;padding:13px 15px 13px 40px;border:1px solid var(--line-2);
  border-radius:var(--radius);font:inherit;font-size:15.5px;background:var(--surface);
  color:var(--ink);outline:none;transition:border-color .15s,box-shadow .15s}
.field input::placeholder{color:var(--muted)}
.field input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.field .icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);
  color:var(--muted);pointer-events:none;display:grid}
.field kbd{position:absolute;right:11px;top:50%;transform:translateY(-50%);
  font:inherit;font-size:11px;color:var(--muted);border:1px solid var(--line);
  border-radius:5px;padding:1px 6px;background:var(--surface-2)}
.field input:focus ~ kbd{display:none}
button.go{padding:0 20px;border:1px solid transparent;border-radius:var(--radius);
  background:var(--accent);color:var(--on-accent,#fff);font:inherit;font-weight:600;
  font-size:14.5px;cursor:pointer;min-width:100px;transition:opacity .15s}
button.go:hover{opacity:.9} button.go:disabled{opacity:.55;cursor:default}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.chip{font-size:12.5px;color:var(--ink-2);background:var(--surface);
  border:1px solid var(--line);padding:5px 11px;border-radius:999px;cursor:pointer;
  transition:border-color .15s,color .15s}
.chip:hover{border-color:var(--accent);color:var(--accent)}
.legalese{color:var(--muted);font-size:12px;line-height:1.5;max-width:76ch}

/* ------------------------------------------------------------- progress */
.progress{margin:26px 0;border:1px solid var(--line);border-radius:var(--radius);
  background:var(--surface);padding:16px 18px}
.progress ol{list-style:none;display:flex;flex-wrap:wrap;gap:6px 18px;
  font-size:13px;color:var(--muted)}
.progress li{display:flex;align-items:center;gap:7px}
.progress li .dot{width:6px;height:6px;border-radius:50%;background:var(--line-2);flex:none}
.progress li.on .dot{background:var(--accent);animation:pulse 1.1s ease-in-out infinite}
.progress li.done .dot{background:var(--ok)}
.progress li.on{color:var(--ink)} .progress li.done{color:var(--ink-2)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.bar{height:2px;background:var(--line);border-radius:2px;margin-top:14px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--accent);width:0;
  transition:width .4s cubic-bezier(.4,0,.2,1)}

/* -------------------------------------------------------------- verdict */
.verdict{border:1px solid var(--line);border-radius:var(--radius);
  background:var(--surface);box-shadow:var(--shadow);padding:20px 22px;margin:26px 0 20px;
  border-left:3px solid var(--cert,var(--muted))}
.verdict .q{font-size:18.5px;font-weight:640;letter-spacing:-.014em;line-height:1.4;
  margin-bottom:12px}
.badge{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;color:var(--cert,var(--muted));
  border:1px solid currentColor;border-radius:6px;padding:3px 9px;margin-bottom:11px}
.verdict .summary{font-size:15px;color:var(--ink-2);line-height:1.62}
.caveats{margin-top:12px;display:flex;flex-direction:column;gap:6px}
.caveat{display:flex;gap:9px;font-size:13.5px;color:var(--warn);line-height:1.5}
.caveat b{flex:none;font-weight:700}
.meta{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);
  display:flex;gap:7px 16px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
.meta .k{color:var(--ink-2);font-variant-numeric:tabular-nums}
details.qry{margin-top:10px;font-size:12.5px;color:var(--muted)}
details.qry summary{cursor:pointer;color:var(--accent);width:fit-content}
details.qry pre{margin-top:8px;background:var(--surface-2);border:1px solid var(--line);
  border-radius:7px;padding:10px 12px;font:12px/1.6 ui-monospace,SFMono-Regular,
  Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;color:var(--ink-2)}

/* ----------------------------------------------------------------- grid */
.cols{display:grid;grid-template-columns:298px 1fr;gap:20px;align-items:start}
@media(max-width:860px){.cols{grid-template-columns:1fr}}
.panel{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);
  padding:16px 18px;margin-bottom:16px;box-shadow:var(--shadow)}
.panel h3{font-size:11.5px;text-transform:uppercase;letter-spacing:.075em;
  color:var(--muted);font-weight:700;margin-bottom:14px}
.panel h3 span{text-transform:none;letter-spacing:0;font-weight:400;color:var(--line-2)}
.side{position:sticky;top:20px}
@media(max-width:860px){.side{position:static}}

/* -------------------------------------------------------------- pyramid */
.pyr{display:flex;flex-direction:column;gap:3px}
.tier{display:flex;align-items:center;gap:9px;font-size:12px}
.tier .shape{flex:none;height:22px;border-radius:3px;position:relative;overflow:hidden;
  background:var(--surface-2);border:1px solid var(--line)}
.tier .shape i{position:absolute;inset:0;width:var(--fill,0%);background:var(--c);
  transition:width .5s cubic-bezier(.4,0,.2,1)}
.tier .nm{color:var(--ink-2);line-height:1.25;flex:1;min-width:0}
.tier.empty .nm{color:var(--muted)}
.tier .n{font-variant-numeric:tabular-nums;font-weight:650;color:var(--ink);
  min-width:16px;text-align:right}
.tier.empty .n{color:var(--line-2);font-weight:400}

/* ------------------------------------------------------------ consensus */
.cbar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--surface-2);
  margin-bottom:12px;border:1px solid var(--line)}
.cbar span{transition:width .5s cubic-bezier(.4,0,.2,1)}
.clegend{display:flex;flex-direction:column;gap:6px;font-size:12.5px}
.clegend div{display:flex;align-items:center;gap:8px;color:var(--ink-2)}
.clegend i{width:9px;height:9px;border-radius:2px;flex:none}
.clegend b{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--muted);
  font-weight:500}
.cverdict{font-size:13.5px;color:var(--ink-2);line-height:1.55;margin-bottom:13px}
.cverdict strong{color:var(--ink);font-weight:640}

/* ----------------------------------------------------------- stat block */
.stat{display:flex;justify-content:space-between;gap:12px;font-size:13px;
  padding:6px 0;border-bottom:1px solid var(--line)}
.stat:last-child{border-bottom:0}
.stat .lbl{color:var(--muted)}
.stat .val{font-variant-numeric:tabular-nums;color:var(--ink);font-weight:600;
  text-align:right}

/* ---------------------------------------------------------------- forest */
.forest svg{width:100%;height:auto;display:block;overflow:visible}
.forest .note{font-size:12px;color:var(--muted);margin-top:12px;line-height:1.55}

/* --------------------------------------------------------------- sources */
.src{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);
  padding:15px 17px;margin-bottom:11px;box-shadow:var(--shadow);
  border-left:3px solid var(--c,var(--line))}
.src.retracted{border-left-color:var(--bad);background:
  color-mix(in srgb,var(--bad) 4%,var(--surface))}
.src .top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.rk{font-size:11.5px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
.pill{font-size:11px;font-weight:650;padding:2.5px 8px;border-radius:5px;
  border:1px solid currentColor;letter-spacing:.01em}
.pill.solid{color:#fff;border-color:transparent}
.yr{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.flag{font-size:10.5px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;
  padding:2.5px 8px;border-radius:5px;background:var(--bad);color:#fff}
.flag.warn{background:var(--warn)}
.src .ti{font-weight:600;font-size:15px;line-height:1.42;letter-spacing:-.008em;
  margin-bottom:6px}
.src .ti a{color:var(--ink);text-decoration:none}
.src .ti a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.src .fi{color:var(--ink-2);font-size:13.5px;line-height:1.58;margin-bottom:9px}
.facts{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.fact{font-size:11.5px;padding:2.5px 8px;border-radius:5px;background:var(--surface-2);
  border:1px solid var(--line);color:var(--ink-2);font-variant-numeric:tabular-nums}
.fact.eff{font-weight:600;color:var(--ink)}
.safe{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:7px}
.safe span{font-size:11px;padding:2px 7px;border-radius:5px;color:var(--ok);
  border:1px solid currentColor}
.dom{font-size:12.5px;line-height:1.55;display:flex;gap:7px;margin-top:3px}
.dom .ar{flex:none;font-weight:700}
.dom.down{color:var(--bad)} .dom.up{color:var(--ok)}
.dom .why{color:var(--muted)}
.why-nn{margin-top:9px;padding-top:9px;border-top:1px dashed var(--line);
  font-size:12px;color:var(--muted);line-height:1.6}
.why-nn mark{background:var(--accent-soft);color:var(--ink-2);padding:1px 4px;
  border-radius:4px;font-style:normal}
.src a.pm{font-size:12.5px;color:var(--accent);text-decoration:none;font-weight:560}
.src a.pm:hover{text-decoration:underline;text-underline-offset:2px}

/* ---------------------------------------------------------------- misc */
.answer{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);
  padding:18px 20px;margin-bottom:16px;white-space:pre-wrap;font-size:14px;
  line-height:1.68;color:var(--ink-2);box-shadow:var(--shadow);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-x:auto}
.err{border:1px solid var(--bad);border-radius:var(--radius);padding:15px 17px;
  color:var(--bad);background:color-mix(in srgb,var(--bad) 6%,var(--surface));
  font-size:14px;line-height:1.6}
.empty{text-align:center;padding:52px 20px;color:var(--muted);font-size:14px;
  line-height:1.7}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 18px}
.actions a{font-size:12.5px;color:var(--muted);text-decoration:none;
  border:1px solid var(--line);border-radius:7px;padding:5px 11px;background:var(--surface)}
.actions a:hover{border-color:var(--accent);color:var(--accent)}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);
  color:var(--muted);font-size:12px;line-height:1.7;display:flex;
  justify-content:space-between;gap:16px;flex-wrap:wrap}
footer code{background:var(--surface-2);border:1px solid var(--line);border-radius:4px;
  padding:1px 5px;font:11.5px ui-monospace,Menlo,Consolas,monospace}
.spin{display:inline-block;width:13px;height:13px;border:2px solid currentColor;
  border-top-color:transparent;border-radius:50%;animation:sp .65s linear infinite;
  vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head>
<body><div class="wrap">

<header>
  <div class="mark" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 20 20">
    <rect x="7" y="3.5" width="6" height="2.4" rx=".6" fill="#4ade80"/>
    <rect x="5" y="7.3" width="10" height="2.4" rx=".6" fill="#fbbf24"/>
    <rect x="3" y="11.1" width="14" height="2.4" rx=".6" fill="#fb923c"/>
    <rect x="1.5" y="14.9" width="17" height="2.4" rx=".6" fill="#f87171"/>
  </svg></div>
  <div>
    <h1>Strata</h1>
    <p class="sub">Clinical questions answered from real PubMed literature — with every
      source placed on the evidence pyramid and an honest verdict on how strong that
      evidence actually is.</p>
  </div>
  <button class="theme" id="theme" title="Switch theme" aria-label="Switch theme">◐</button>
</header>

<form id="form" autocomplete="off">
  <div class="field">
    <span class="icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 16 16"
      fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.6"/>
      <path d="M10.5 10.5 14 14" stroke-linecap="round"/></svg></span>
    <input id="q" placeholder="Ask a clinical question…" aria-label="Clinical question"/>
    <kbd>/</kbd>
  </div>
  <button class="go" id="go" type="submit">Search</button>
</form>

<div class="chips" id="chips"></div>
<p class="legalese">Reads public PubMed data through the NCBI E-utilities API. Handles no
  patient data and stores nothing. Decision support for professionals — not medical
  advice, and not a substitute for reading the sources.</p>

<div id="out"></div>

<footer>
  <span>Strata · evidence-based, honest by design</span>
  <span id="nnstat"></span>
</footer>
</div>

<script>
"use strict";
const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t);
  if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const esc = s => String(s == null ? "" : s)
  .replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",
    '"':"&quot;","'":"&#39;"}[m]));

const LEVEL_COLOR = {1:"--l1",2:"--l2",3:"--l3",4:"--l4",5:"--l5",6:"--l6",7:"--l7"};
const CERT_COLOR  = {high:"--ok", moderate:"--l3", low:"--l4",
                     "very low":"--bad", none:"--muted"};
const STANCE_COLOR = {supports:"--ok", no_effect:"--l3", against:"--bad",
                      unclear:"--muted", mixed:"--l4", insufficient:"--muted"};
const STANCE_NAME = {supports:"Supports benefit", no_effect:"No effect",
                     against:"Harm / no benefit", unclear:"Inconclusive"};
const SAFE_NAME = {randomised:"randomised", blinded:"blinded",
                   registered:"pre-registered", itt:"intention-to-treat",
                   powered:"powered", confounding_adjusted:"adjusted"};
const cssv = n => getComputedStyle(document.documentElement)
  .getPropertyValue(n).trim() || "#888";

/* ---------------------------------------------------------------- theme */
const root = document.documentElement;
const saved = localStorage.getItem("strata-theme");
if (saved) root.setAttribute("data-theme", saved);
$("#theme").onclick = () => {
  const cur = root.getAttribute("data-theme")
    || (matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("strata-theme", next);
  if (window.__last) render(window.__last);       // redraw SVG with new colours
};

/* -------------------------------------------------------------- examples */
const EXAMPLES = [
  "Does vitamin D prevent respiratory infections?",
  "Does metformin reduce cardiovascular mortality in type 2 diabetes?",
  "Is intermittent fasting effective for weight loss?",
  "Do statins prevent a first heart attack?",
  "Does early mobilisation reduce ICU length of stay?"
];
EXAMPLES.forEach(t => {
  const b = el("button", "chip", t); b.type = "button";
  b.onclick = () => { $("#q").value = t; run(); };
  $("#chips").appendChild(b);
});

addEventListener("keydown", e => {
  if (e.key === "/" && document.activeElement !== $("#q")) {
    e.preventDefault(); $("#q").focus(); $("#q").select();
  }
});

/* --------------------------------------------------------------- health */
fetch("api/health").then(r => r.json()).then(h => {
  const nets = Object.entries(h.networks || {}).filter(([, v]) => v).map(([k]) => k);
  $("#nnstat").textContent = nets.length
    ? `networks loaded: ${nets.join(", ")}`
    : "networks not trained — using rule-based grading";
}).catch(() => {});

/* ----------------------------------------------------------------- run */
const STAGES = [["parse","Reading question"],["search","Searching PubMed"],
  ["dedupe","Removing duplicates"],["grade","Grading papers"],
  ["rank","Ranking"],["assess","Weighing agreement"],["answer","Composing"]];

$("#form").onsubmit = e => { e.preventDefault(); run(); };

let inflight = null;

function run() {
  const q = $("#q").value.trim();
  if (!q) return;
  if (inflight) { inflight.close(); inflight = null; }

  history.replaceState(null, "", "?q=" + encodeURIComponent(q));
  $("#go").disabled = true;
  $("#go").innerHTML = '<span class="spin"></span>';
  showProgress();

  const src = new EventSource("api/stream?q=" + encodeURIComponent(q));
  inflight = src;
  let done = 0;

  src.addEventListener("stage", ev => {
    const d = JSON.parse(ev.data);
    const idx = STAGES.findIndex(s => s[0] === d.stage);
    document.querySelectorAll("#prog li").forEach((li, i) => {
      li.className = i < idx ? "done" : (i === idx ? "on" : "");
      if (i === idx && d.message) li.querySelector(".t").textContent = d.message;
    });
    done = Math.max(done, idx);
    $("#pbar").style.width = ((idx + 1) / STAGES.length * 100) + "%";
  });

  src.addEventListener("result", ev => {
    src.close(); inflight = null; finish();
    const d = JSON.parse(ev.data);
    if (d.error) { showError(d.error); return; }
    window.__last = d; render(d);
  });

  src.addEventListener("failed", ev => {
    src.close(); inflight = null; finish();
    let msg = "Something went wrong.";
    try { msg = JSON.parse(ev.data).error || msg; } catch (_) {}
    showError(msg);
  });

  src.onerror = () => {
    if (!inflight) return;
    src.close(); inflight = null; finish();
    showError("Lost the connection to the Strata server.");
  };
}

function finish() { $("#go").disabled = false; $("#go").textContent = "Search"; }

function showProgress() {
  const p = el("div", "progress");
  const ol = el("ol"); ol.id = "prog";
  STAGES.forEach(([, label]) => {
    const li = el("li");
    li.appendChild(el("span", "dot"));
    li.appendChild(el("span", "t", label));
    ol.appendChild(li);
  });
  p.appendChild(ol);
  const bar = el("div", "bar"); const i = el("i"); i.id = "pbar";
  bar.appendChild(i); p.appendChild(bar);
  $("#out").replaceChildren(p);
}

function showError(msg) {
  const d = el("div", "err"); d.textContent = msg;
  $("#out").replaceChildren(d);
}

/* -------------------------------------------------------------- render */
function render(d) {
  const out = $("#out"); out.replaceChildren();
  if (!d.sources || !d.sources.length) {
    const e = el("div", "empty");
    e.innerHTML = "<strong>No studies were retrieved.</strong><br>" +
      "Try broader terms. Treat this as an absence of retrieved evidence — " +
      "not as evidence of absence.";
    out.appendChild(verdictPanel(d)); out.appendChild(e); return;
  }
  out.appendChild(verdictPanel(d));
  out.appendChild(actions(d));

  const cols = el("div", "cols");
  const side = el("div", "side");
  side.appendChild(pyramidPanel(d));
  if (d.consensus && d.consensus.direction !== "insufficient")
    side.appendChild(consensusPanel(d.consensus));
  if (d.pooled) side.appendChild(pooledPanel(d.pooled));
  cols.appendChild(side);

  const main = el("div");
  const fp = forestPanel(d);
  if (fp) main.appendChild(fp);
  if (!d.grounded) {
    const a = el("div", "answer", d.answer);
    main.appendChild(a);
  }
  main.appendChild(sourcesPanel(d.sources));
  cols.appendChild(main);
  out.appendChild(cols);
}

function verdictPanel(d) {
  const v = el("div", "verdict");
  v.style.setProperty("--cert", `var(${CERT_COLOR[d.body.overall_strength] || "--muted"})`);
  const b = el("span", "badge", `${d.body.overall_strength} certainty`);
  v.appendChild(b);
  v.appendChild(el("div", "q", d.question));
  v.appendChild(el("div", "summary", d.body.summary));

  if (d.body.caveats && d.body.caveats.length) {
    const c = el("div", "caveats");
    d.body.caveats.forEach(t => {
      const row = el("div", "caveat");
      row.appendChild(el("b", null, "!"));
      row.appendChild(el("span", null, t));
      c.appendChild(row);
    });
    v.appendChild(c);
  }

  const m = el("div", "meta");
  const add = (k, val) => { const s = el("span");
    s.appendChild(el("span", "k", val)); s.append(" " + k); m.appendChild(s); };
  if (d.total_hits) add("PubMed hits", d.total_hits.toLocaleString());
  add("appraised", d.retrieved || d.sources.length);
  if (d.duplicates_removed) add("duplicates merged", d.duplicates_removed);
  if (d.broadened) m.appendChild(el("span", null, "search was broadened"));
  add("seconds", (d.elapsed || 0).toFixed(1));
  v.appendChild(m);

  if (d.pico || d.query) {
    const det = el("details", "qry");
    det.appendChild(el("summary", null, "How this search was built"));
    const parts = [];
    if (d.pico) {
      const p = d.pico;
      const line = ["population","intervention","comparator","outcome"]
        .filter(k => p[k]).map(k => `${k[0].toUpperCase()}: ${p[k]}`).join("   ");
      if (line) parts.push(line);
    }
    if (d.query) parts.push(d.query);
    if (d.query_translation) parts.push("PubMed read it as:\n" + d.query_translation);
    det.appendChild(el("pre", null, parts.join("\n\n")));
    v.appendChild(det);
  }
  return v;
}

function actions(d) {
  const a = el("div", "actions");
  const q = encodeURIComponent(d.question);
  [["Markdown","md"],["BibTeX","bib"],["JSON","json"]].forEach(([label, fmt]) => {
    const link = el("a", null, "Export " + label);
    link.href = `api/export?q=${q}&format=${fmt}`;
    link.setAttribute("download", "");
    a.appendChild(link);
  });
  return a;
}

function pyramidPanel(d) {
  const p = el("div", "panel");
  const h = el("h3", null, "Evidence pyramid");
  p.appendChild(h);
  const names = {1:"Systematic review / meta-analysis",2:"Randomised controlled trial",
    3:"Cohort study",4:"Case-control / cross-sectional",5:"Case report / series",
    6:"Narrative review / opinion",7:"Preclinical (animal / in vitro)"};
  const counts = d.body.level_counts || {};
  const peak = Math.max(1, ...Object.values(counts).map(Number));
  const box = el("div", "pyr");
  for (let L = 1; L <= 7; L++) {
    const n = Number(counts[L] || 0);
    const row = el("div", "tier" + (n ? "" : " empty"));
    const shape = el("div", "shape");
    shape.style.width = (30 + (L - 1) * 8) + "px";
    shape.style.setProperty("--c", `var(${LEVEL_COLOR[L]})`);
    shape.style.setProperty("--fill", (n ? Math.max(18, n / peak * 100) : 0) + "%");
    shape.appendChild(el("i"));
    row.appendChild(shape);
    row.appendChild(el("div", "nm", names[L]));
    row.appendChild(el("div", "n", n ? String(n) : "·"));
    box.appendChild(row);
  }
  p.appendChild(box);
  return p;
}

function consensusPanel(c) {
  const p = el("div", "panel");
  p.appendChild(el("h3", null, "Consensus"));
  const v = el("div", "cverdict");
  v.innerHTML = esc(c.summary).replace(/^(\w[\w\s]*?)(\s)/, "<strong>$1</strong>$2");
  p.appendChild(v);

  const order = ["supports","no_effect","unclear","against"];
  const total = order.reduce((s, k) => s + (c.weights[k] || 0), 0) || 1;
  const bar = el("div", "cbar");
  order.forEach(k => {
    const w = (c.weights[k] || 0) / total * 100;
    if (w <= 0) return;
    const s = el("span"); s.style.width = w + "%";
    s.style.background = cssv(STANCE_COLOR[k]);
    s.title = `${STANCE_NAME[k]} — ${w.toFixed(0)}% of weighted evidence`;
    bar.appendChild(s);
  });
  p.appendChild(bar);

  const lg = el("div", "clegend");
  order.forEach(k => {
    if (!c.counts[k]) return;
    const row = el("div");
    const i = el("i"); i.style.background = cssv(STANCE_COLOR[k]);
    row.appendChild(i);
    row.appendChild(el("span", null, STANCE_NAME[k]));
    row.appendChild(el("b", null, `${c.counts[k]} paper${c.counts[k] > 1 ? "s" : ""}`));
    lg.appendChild(row);
  });
  p.appendChild(lg);
  return p;
}

function pooledPanel(p) {
  const box = el("div", "panel");
  const h = el("h3");
  h.append("Indicative pooling ");
  h.appendChild(el("span", null, "· not a systematic review"));
  box.appendChild(h);
  const rows = [
    ["Pooled " + p.measure, p.estimate.toFixed(2)],
    ["95% CI", `${p.ci_low.toFixed(2)} – ${p.ci_high.toFixed(2)}`],
    ["Studies pooled", String(p.n_studies)],
    ["I²", `${p.i_squared.toFixed(0)}% (${p.heterogeneity})`],
    ["Excludes no effect", p.excludes_null ? "yes" : "no"],
  ];
  rows.forEach(([k, v]) => {
    const r = el("div", "stat");
    r.appendChild(el("span", "lbl", k));
    r.appendChild(el("span", "val", v));
    box.appendChild(r);
  });
  return box;
}

/* --------------------------------------------------------- forest plot */
function forestPanel(d) {
  const rows = d.sources.filter(s => s.grade.effect && s.effect_ci);
  if (rows.length < 2) return null;
  const ratio = rows[0].effect_is_ratio;
  const use = rows.filter(s => s.effect_is_ratio === ratio);
  if (use.length < 2) return null;

  const tx = v => ratio ? Math.log(Math.max(v, 1e-6)) : v;
  const nullV = ratio ? 0 : 0;
  let lows = use.map(s => tx(s.effect_ci[0]));
  let highs = use.map(s => tx(s.effect_ci[1]));
  if (d.pooled) { lows.push(tx(d.pooled.ci_low)); highs.push(tx(d.pooled.ci_high)); }
  let lo = Math.min(...lows, nullV), hi = Math.max(...highs, nullV);
  const pad = (hi - lo || 1) * 0.1; lo -= pad; hi += pad;

  const W = 640, L = 250, R = 92, rowH = 26;
  const plotW = W - L - R;
  const nRows = use.length + (d.pooled ? 1 : 0);
  const H = nRows * rowH + 46;
  const x = v => L + (tx(v) - lo) / (hi - lo) * plotW;

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Forest plot of reported effect estimates");

  const mk = (t, attrs, text) => {
    const n = document.createElementNS(NS, t);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  };
  const ink = cssv("--ink"), muted = cssv("--muted"), line = cssv("--line");

  // null line
  const nx = x(ratio ? 1 : 0);
  svg.appendChild(mk("line", {x1:nx, y1:8, x2:nx, y2:nRows*rowH+10,
    stroke:muted, "stroke-width":1, "stroke-dasharray":"3 3"}));

  // axis ticks
  const ticks = ratio ? [0.25,0.5,1,2,4].filter(t => tx(t) >= lo && tx(t) <= hi)
                      : niceTicks(lo, hi);
  ticks.forEach(t => {
    const tX = x(t);
    svg.appendChild(mk("line", {x1:tX, y1:nRows*rowH+10, x2:tX, y2:nRows*rowH+14,
      stroke:line}));
    const lab = mk("text", {x:tX, y:nRows*rowH+26, "text-anchor":"middle",
      "font-size":10.5, fill:muted}, String(t));
    svg.appendChild(lab);
  });

  const widths = use.map(s => tx(s.effect_ci[1]) - tx(s.effect_ci[0]));
  const tightest = Math.min(...widths);

  use.forEach((s, i) => {
    const y = 16 + i * rowH;
    const col = s.grade.retracted ? cssv("--bad")
      : cssv(LEVEL_COLOR[s.grade.level] || "--l6");
    const a = x(s.effect_ci[0]), b = x(s.effect_ci[1]);
    svg.appendChild(mk("line", {x1:a, y1:y, x2:b, y2:y, stroke:col, "stroke-width":1.6}));
    [a, b].forEach(cx => svg.appendChild(mk("line",
      {x1:cx, y1:y-3.5, x2:cx, y2:y+3.5, stroke:col, "stroke-width":1.6})));
    const size = 4 + 4 * (tightest / Math.max(widths[i], 1e-6));
    svg.appendChild(mk("rect", {x:x(s.effect_est)-size/2, y:y-size/2,
      width:size, height:size, fill:col, rx:1}));

    const mark = s.grade.retracted ? "⊘ " : "";
    const room = 40 - mark.length;
    let t = mark + (s.title.length > room ? s.title.slice(0, room - 1) + "…" : s.title);
    const lab = mk("text", {x:L-12, y:y+3.5, "text-anchor":"end", "font-size":11,
      fill: s.grade.retracted ? cssv("--bad") : ink,
      "text-decoration": s.grade.retracted ? "line-through" : "none"}, t);
    const tip = mk("title", {}, s.title);
    lab.appendChild(tip);
    svg.appendChild(lab);
    svg.appendChild(mk("text", {x:W-R+10, y:y+3.5, "font-size":10.5, fill:muted,
      "font-variant-numeric":"tabular-nums"},
      `${s.effect_est.toFixed(2)} [${s.effect_ci[0].toFixed(2)}, ${s.effect_ci[1].toFixed(2)}]`));
  });

  if (d.pooled) {
    const y = 16 + use.length * rowH;
    const a = x(d.pooled.ci_low), b = x(d.pooled.ci_high), c = x(d.pooled.estimate);
    svg.appendChild(mk("polygon",
      {points:`${a},${y} ${c},${y-6} ${b},${y} ${c},${y+6}`, fill:cssv("--accent")}));
    svg.appendChild(mk("text", {x:L-12, y:y+3.5, "text-anchor":"end",
      "font-size":11, "font-weight":650, fill:ink}, "Pooled (indicative)"));
    svg.appendChild(mk("text", {x:W-R+10, y:y+3.5, "font-size":10.5,
      fill:cssv("--accent"), "font-variant-numeric":"tabular-nums"},
      `${d.pooled.estimate.toFixed(2)} [${d.pooled.ci_low.toFixed(2)}, ${d.pooled.ci_high.toFixed(2)}]`));
  }

  const panel = el("div", "panel forest");
  const h = el("h3");
  h.append(`Reported effect estimates `);
  h.appendChild(el("span", null,
    `· ${use[0].grade.effect.split(" ")[0]}, ${ratio ? "log" : "linear"} axis`));
  panel.appendChild(h);
  panel.appendChild(svg);
  const note = el("div", "note");
  note.textContent = "Only studies that reported a confidence interval are drawn; "
    + "marker size reflects precision. Values left of the dashed line are below "
    + "no effect — whether that is good or bad depends on the outcome measured.";
  panel.appendChild(note);
  if (use.some(s => s.grade.retracted)) {
    const r = el("div", "note");
    r.style.color = cssv("--bad");
    r.textContent = "⊘ Retracted — shown for transparency, and excluded "
      + "from the pooled estimate.";
    panel.appendChild(r);
  }
  return panel;
}

function niceTicks(lo, hi) {
  const span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step)
    out.push(Number(v.toFixed(3)));
  return out.slice(0, 7);
}

/* ------------------------------------------------------------- sources */
function sourcesPanel(sources) {
  const wrap = el("div");
  const h = el("h3"); h.style.cssText =
    "font-size:11.5px;text-transform:uppercase;letter-spacing:.075em;" +
    "color:var(--muted);font-weight:700;margin:4px 0 12px";
  h.append("Sources "); h.appendChild(el("span", null, "· strongest first"));
  h.querySelector("span").style.cssText =
    "text-transform:none;letter-spacing:0;font-weight:400;color:var(--line-2)";
  wrap.appendChild(h);

  sources.forEach((s, i) => {
    const g = s.grade;
    const card = el("div", "src" + (g.retracted ? " retracted" : ""));
    card.style.setProperty("--c", `var(${LEVEL_COLOR[g.level] || "--l6"})`);

    const top = el("div", "top");
    top.appendChild(el("span", "rk", `[${i + 1}]`));
    const dp = el("span", "pill solid", g.label);
    dp.style.background = cssv(LEVEL_COLOR[g.level] || "--l6");
    if (g.level >= 6) dp.style.color = "#fff";
    top.appendChild(dp);
    const cp = el("span", "pill", g.strength);
    cp.style.color = cssv(CERT_COLOR[g.strength] || "--muted");
    top.appendChild(cp);
    top.appendChild(el("span", "yr", s.year || "n.d."));
    if (g.is_guideline) {
      const gp = el("span", "pill", "guideline");
      gp.style.color = cssv("--accent"); top.appendChild(gp);
    }
    if (g.retracted) top.appendChild(el("span", "flag", "retracted"));
    else if (g.concern) top.appendChild(el("span", "flag warn", "concern"));
    card.appendChild(top);

    const ti = el("div", "ti");
    const a = el("a", null, s.title);
    a.href = s.url; a.target = "_blank"; a.rel = "noopener noreferrer";
    ti.appendChild(a); card.appendChild(ti);

    if (s.finding) card.appendChild(el("div", "fi", s.finding));

    const facts = el("div", "facts");
    if (g.effect) { const f = el("span", "fact eff", g.effect); facts.appendChild(f); }
    if (g.sample_size) facts.appendChild(el("span", "fact",
      "n = " + g.sample_size.toLocaleString()));
    if (g.stance) {
      const f = el("span", "fact", STANCE_NAME[g.stance] || g.stance);
      f.style.color = cssv(STANCE_COLOR[g.stance] || "--muted");
      facts.appendChild(f);
    }
    if (s.journal) facts.appendChild(el("span", "fact", s.journal));
    if (facts.children.length) card.appendChild(facts);

    if (g.safeguards && g.safeguards.length) {
      const sf = el("div", "safe");
      g.safeguards.forEach(k => sf.appendChild(
        el("span", null, "✓ " + (SAFE_NAME[k] || k))));
      card.appendChild(sf);
    }

    (g.domains || []).forEach(dm => {
      if (!dm.delta) return;
      const row = el("div", "dom " + (dm.delta < 0 ? "down" : "up"));
      row.appendChild(el("span", "ar", dm.delta < 0 ? "↓" : "↑"));
      const t = el("span");
      t.append(dm.name.toLowerCase() + " — ");
      t.appendChild(el("span", "why", dm.reason));
      row.appendChild(t);
      card.appendChild(row);
    });

    if (g.spans && g.spans.length) {
      const w = el("div", "why-nn");
      w.append(`Classified by ${g.classified_by} · the network attended to `);
      g.spans.slice(0, 4).forEach((sp, j) => {
        if (j) w.append(", ");
        const m = document.createElement("mark"); m.textContent = sp.text;
        w.appendChild(m);
      });
      card.appendChild(w);
    }

    const pm = el("a", "pm", "View on PubMed →");
    pm.href = s.url; pm.target = "_blank"; pm.rel = "noopener noreferrer";
    card.appendChild(pm);
    wrap.appendChild(card);
  });
  return wrap;
}

/* ------------------------------------------------------------- deep link */
const initial = new URLSearchParams(location.search).get("q");
if (initial) { $("#q").value = initial; run(); } else { $("#q").focus(); }
</script>
</body></html>"""
