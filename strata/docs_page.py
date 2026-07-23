"""The Strata developer platform — API documentation.

A single, self-contained reference a developer can integrate from in fifteen minutes: a
sticky sidebar, a language switcher (curl / Python / JavaScript), and accurate documentation
of the *real* endpoints this server exposes — verify, compare, claims, changes, evidence,
alerts, webhooks, keys — plus authentication, rate limits, errors, and the Evidence Receipt
schema. Every example runs against a live Strata server. Standard library only.
"""
from __future__ import annotations

DOCS_HTML = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Strata API · developer docs</title>
<meta name="description" content="Strata API reference: verify medical claims, monitor evidence change, receive signed webhooks. Quickstart, auth, endpoints, and Python/JS/curl examples."/>
<style>
:root{--bg:#04060a;--bg2:#080d13;--card:#0b1220;--code:#02060c;--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.15);
 --ink:#fff;--dim:#9aa7b3;--faint:#6b7885;--green:#38e6a6;--red:#ff5d73;--amber:#ffc24b;--blue:#8fd0ff;--purple:#c9a8ff;
 --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15.5px;line-height:1.6;-webkit-font-smoothing:antialiased;letter-spacing:-.01em}
a{color:var(--green);text-decoration:none}.mono{font-family:var(--mono)}
.top{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:16px;height:60px;padding:0 22px;
 background:rgba(4,6,10,.82);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px;color:#fff}
.logo .g{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:#03140d;font-weight:900;background:var(--green)}
.logo .k{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--faint);text-transform:uppercase;border-left:1px solid var(--line2);padding-left:10px}
.top .sp{flex:1}.top a.lk{font-size:14px;color:#fff;opacity:.72}.top a.lk:hover{opacity:1}
.layout{display:grid;grid-template-columns:236px 1fr;max-width:1200px;margin:0 auto;gap:0}
@media(max-width:900px){.layout{grid-template-columns:1fr}.side{display:none}}
.side{position:sticky;top:60px;height:calc(100vh - 60px);overflow-y:auto;padding:26px 16px 40px;border-right:1px solid var(--line)}
.side h5{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:20px 10px 8px}
.side a{display:block;font-size:14px;color:var(--dim);padding:6px 10px;border-radius:8px}
.side a:hover{color:#fff;background:rgba(255,255,255,.04)}.side a.on{color:var(--green);background:rgba(56,230,166,.08)}
.main{padding:34px 34px 100px;min-width:0}
@media(max-width:900px){.main{padding:24px}}
.main h1{font-size:34px;font-weight:800;letter-spacing:-.03em}
.main .tag{color:var(--dim);font-size:17px;margin-top:8px;max-width:64ch}
.sec{padding-top:40px;margin-top:12px;border-top:1px solid var(--line)}
.sec:first-of-type{border-top:0}
.main h2{font-size:24px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px;scroll-margin-top:76px}
.main h3{font-size:17px;font-weight:800;margin:26px 0 8px}
.main p{color:var(--ink);opacity:.82;margin:10px 0;max-width:70ch}
.main ul{margin:10px 0 10px 22px}.main li{margin:6px 0;opacity:.82}
.ep{display:flex;align-items:center;gap:10px;margin:22px 0 8px;flex-wrap:wrap}
.m{font-family:var(--mono);font-size:11px;font-weight:800;padding:4px 9px;border-radius:6px;letter-spacing:.03em}
.m.get{background:rgba(143,208,255,.16);color:var(--blue)}.m.post{background:rgba(56,230,166,.16);color:var(--green)}
.path{font-family:var(--mono);font-size:15px;font-weight:700;color:#fff}
.badge{font-family:var(--mono);font-size:10px;color:var(--faint);border:1px solid var(--line);border-radius:20px;padding:2px 9px}
.code{background:var(--code);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:12px 0}
.code .bar{display:flex;align-items:center;gap:6px;padding:9px 12px;border-bottom:1px solid var(--line)}
.code .bar .fn{font-family:var(--mono);font-size:11px;color:var(--faint);margin-left:6px}
.tabs{display:flex;gap:4px;margin-left:auto}
.tab{font-family:var(--mono);font-size:11px;font-weight:700;color:var(--faint);border:1px solid transparent;border-radius:7px;padding:4px 10px;cursor:pointer}
.tab.on{color:var(--green);border-color:var(--line2);background:rgba(56,230,166,.06)}
pre{margin:0;padding:16px 18px;overflow-x:auto;font-family:var(--mono);font-size:13.5px;line-height:1.7;color:#d7e2e0}
pre .k{color:var(--green)}pre .s{color:var(--blue)}pre .c{color:var(--faint)}pre .n{color:var(--purple)}
.cblock{display:none}.cblock.on{display:block}
table.ref{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px}
table.ref th,table.ref td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
table.ref th{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
table.ref td.f{font-family:var(--mono);color:var(--green);white-space:nowrap}
table.ref td.t{font-family:var(--mono);color:var(--dim);font-size:12.5px}
.note{background:rgba(56,230,166,.06);border:1px solid rgba(56,230,166,.24);border-radius:12px;padding:14px 16px;margin:16px 0;font-size:14.5px}
.note.warn{background:rgba(255,194,75,.07);border-color:rgba(255,194,75,.28)}
.note b{color:var(--green)}.note.warn b{color:var(--amber)}
.pill{font-family:var(--mono);font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;background:rgba(255,255,255,.06);color:var(--dim)}
.foot{margin-top:50px;padding-top:24px;border-top:1px solid var(--line);color:var(--faint);font-size:13px;line-height:1.7}
</style></head><body>
<div class="top"><a class="logo" href="/"><span class="g">S</span> Strata <span class="k">Docs</span></a>
 <span class="sp"></span><a class="lk" href="/app">Verify</a><a class="lk" href="/console">Console</a><a class="lk" href="/pricing">Pricing</a><a class="lk" href="/">Home</a></div>
<div class="layout">
<aside class="side" id="side">
  <h5>Start</h5><a href="#intro">Introduction</a><a href="#quickstart">Quickstart</a><a href="#auth">Authentication</a><a href="#keys">API keys</a>
  <h5>Verify</h5><a href="#verify">Verify a claim</a><a href="#stream">Streaming</a><a href="#batch">Batch</a><a href="#compare">Compare</a><a href="#receipt">Receipt schema</a>
  <h5>Monitor</h5><a href="#claims">Claims</a><a href="#changes">Changes</a><a href="#evidence">Evidence</a><a href="#alerts">Alerts</a><a href="#webhooks">Webhooks</a><a href="#console">Console summary</a>
  <h5>Platform</h5><a href="#ratelimits">Rate limits</a><a href="#errors">Errors</a><a href="#sdks">SDKs</a><a href="#selfhost">Self-host</a>
</aside>
<main class="main">
  <h1>Strata API</h1>
  <div class="tag">Wrap any medical claim in an independent evidence check, and monitor when the evidence behind it changes. One base URL, real API keys, structured responses, signed webhooks.</div>
  <div style="margin-top:16px" class="ep"><span class="pill">Base URL</span><span class="path" id="baseUrl">http://127.0.0.1:8600</span>
    <span class="pill">Content-Type</span><span class="mono" style="font-size:13px;color:var(--dim)">application/json</span></div>

  <section class="sec" id="intro"><h2>Introduction</h2>
    <p>Strata is continuous evidence intelligence. Send a claim; Strata retrieves the relevant literature across PubMed, Europe PMC, ClinicalTrials.gov, OpenAlex, and Crossref, grades every study on the evidence pyramid, marks it supporting or contradicting, explains any disagreement, and returns a structured <b>Evidence Receipt</b>. Register the claim and Strata re-verifies it on a schedule, versioning it and alerting you when the evidence materially changes.</p>
    <p>Everything is JSON in, JSON out. The same server hosts the <a href="/app">Verify</a> demo, the <a href="/console">Console</a>, and this API.</p>
    <div class="note"><b>Honest by design.</b> Strata appraises published literature for decision support. It is not a medical device and does not determine truth. Effect estimates are heuristic extractions, labeled as such — always read the cited source.</div>
  </section>

  <section class="sec" id="quickstart"><h2>Quickstart</h2>
    <p>Generate a key, then verify a claim. Under 15 minutes, start to finish.</p>
    <div class="code"><div class="bar"><span class="fn">1 · generate a key</span><div class="tabs" data-tabs><span class="tab on" data-l="curl">curl</span><span class="tab" data-l="py">Python</span><span class="tab" data-l="js">JS</span></div></div>
      <div class="cblock on" data-l="curl"><pre><span class="c"># returns {"key":"sk_live_...", ...} — shown once</span>
curl -X POST <span class="s">$BASE/v1/keys</span> -d <span class="s">'{"label":"my app"}'</span></pre></div>
      <div class="cblock" data-l="py"><pre><span class="k">import</span> urllib.request, json
base=<span class="s">"http://127.0.0.1:8600"</span>
key=json.load(urllib.request.urlopen(urllib.request.Request(
  base+<span class="s">"/v1/keys"</span>, data=<span class="s">b'{"label":"my app"}'</span>)))[<span class="s">"key"</span>]</pre></div>
      <div class="cblock" data-l="js"><pre><span class="k">const</span> base=<span class="s">"http://127.0.0.1:8600"</span>;
<span class="k">const</span> {key}=<span class="k">await</span>(<span class="k">await</span> fetch(base+<span class="s">"/v1/keys"</span>,{method:<span class="s">"POST"</span>,
  body:JSON.stringify({label:<span class="s">"my app"</span>})})).json();</pre></div>
    </div>
    <div class="code"><div class="bar"><span class="fn">2 · verify a claim</span><div class="tabs" data-tabs><span class="tab on" data-l="curl">curl</span><span class="tab" data-l="py">Python</span><span class="tab" data-l="js">JS</span></div></div>
      <div class="cblock on" data-l="curl"><pre>curl -X POST <span class="s">$BASE/v1/verify</span> \
  -H <span class="s">"Authorization: Bearer $STRATA_KEY"</span> \
  -d <span class="s">'{"claim":"SGLT2 inhibitors reduce heart-failure hospitalization"}'</span></pre></div>
      <div class="cblock" data-l="py"><pre>req=urllib.request.Request(base+<span class="s">"/v1/verify"</span>,
  data=json.dumps({<span class="s">"claim"</span>:<span class="s">"SGLT2 inhibitors reduce heart-failure hospitalization"</span>}).encode(),
  headers={<span class="s">"Authorization"</span>:<span class="s">"Bearer "</span>+key})
receipt=json.load(urllib.request.urlopen(req))
<span class="k">print</span>(receipt[<span class="s">"claim_status"</span>], receipt[<span class="s">"evidence_strength"</span> <span class="k">if False else</span> <span class="s">"strength"</span>])</pre></div>
      <div class="cblock" data-l="js"><pre><span class="k">const</span> r=<span class="k">await</span>(<span class="k">await</span> fetch(base+<span class="s">"/v1/verify"</span>,{method:<span class="s">"POST"</span>,
  headers:{<span class="s">"Authorization"</span>:<span class="s">"Bearer "</span>+key,<span class="s">"Content-Type"</span>:<span class="s">"application/json"</span>},
  body:JSON.stringify({claim:<span class="s">"SGLT2 inhibitors reduce heart-failure hospitalization"</span>})})).json();
console.log(r.claim_status, r.strength, r.supporting, r.contradicting);</pre></div>
    </div>
  </section>

  <section class="sec" id="auth"><h2>Authentication</h2>
    <p>Pass your key three ways, in order of preference:</p>
    <ul><li><span class="mono">Authorization: Bearer sk_live_…</span></li><li><span class="mono">X-API-Key: sk_live_…</span></li><li><span class="mono">?key=sk_live_…</span> query parameter</li></ul>
    <p>A generated key always authorizes. Keys are stored only as SHA-256 hashes — the raw secret is shown once at creation. On a self-hosted server with <span class="mono">STRATA_API_KEYS</span> unset, the API runs open on your private network; set it to require keys.</p>
    <div class="note warn"><b>Never ship a key in frontend code.</b> All authorization is validated server-side. Treat <span class="mono">sk_live_…</span> like a password.</div>
  </section>

  <section class="sec" id="keys"><h2>API keys</h2>
    <div class="ep"><span class="m post">POST</span><span class="path">/v1/keys</span><span class="badge">create</span></div>
    <p>Create a key. Body: <span class="mono">{"label": "..."}</span>. Returns the raw key once plus its metadata (id, prefix, scopes, rate_limit).</p>
    <table class="ref"><tr><th>Endpoint</th><th>Method</th><th>Purpose</th></tr>
      <tr><td class="f">/v1/keys</td><td class="t">GET</td><td>List keys (redacted — no secrets)</td></tr>
      <tr><td class="f">/v1/keys/revoke?id=</td><td class="t">GET</td><td>Revoke a key immediately</td></tr>
      <tr><td class="f">/v1/keys/rotate?id=</td><td class="t">GET</td><td>Issue a new secret; old one stops working</td></tr>
      <tr><td class="f">/v1/keys/logs?id=</td><td class="t">GET</td><td>Recent request log for a key</td></tr></table>
  </section>

  <section class="sec" id="verify"><h2>Verify a claim</h2>
    <div class="ep"><span class="m post">POST</span><span class="path">/v1/verify</span></div>
    <p>The core endpoint. Send a claim (optionally with PICO fields and a local cohort id); get an Evidence Receipt.</p>
    <table class="ref"><tr><th>Field</th><th>Type</th><th>Notes</th></tr>
      <tr><td class="f">claim</td><td class="t">string</td><td><b>Required.</b> The medical assertion in plain language.</td></tr>
      <tr><td class="f">population</td><td class="t">string</td><td>Optional PICO override — e.g. "adults over 65".</td></tr>
      <tr><td class="f">intervention / comparator / outcome</td><td class="t">string</td><td>Optional PICO overrides.</td></tr>
      <tr><td class="f">cohort</td><td class="t">string</td><td>Optional local cohort id for a generalizability note (self-host).</td></tr></table>
    <div class="code"><div class="bar"><span class="fn">request &amp; response</span><div class="tabs" data-tabs><span class="tab on" data-l="curl">curl</span><span class="tab" data-l="py">Python</span><span class="tab" data-l="js">JS</span></div></div>
      <div class="cblock on" data-l="curl"><pre>curl -X POST <span class="s">$BASE/v1/verify</span> -H <span class="s">"Authorization: Bearer $STRATA_KEY"</span> \
  -d <span class="s">'{"claim":"Metformin reduces cardiovascular mortality in type 2 diabetes",
       "population":"adults over 65"}'</span>

<span class="c"># {
#   "claim_status": "SUPPORTED",        "strength": "moderate",
#   "confidence": 0.74,                 "supporting": 4, "contradicting": 1,
#   "pico": {...}, "strength_rationale": {...}, "contradiction": {...},
#   "citations": [ ... ], "audit_trail": [ ... ], "sources": {...}
# }</span></pre></div>
      <div class="cblock" data-l="py"><pre>from strata_client import Strata   <span class="c"># clients/python — zero deps</span>
s=Strata(api_key=<span class="s">"sk_live_..."</span>, base_url=base)
r=s.verify(<span class="s">"Metformin reduces cardiovascular mortality in type 2 diabetes"</span>)
<span class="k">if</span> r[<span class="s">"status"</span>] <span class="k">in</span> (<span class="s">"Mixed"</span>,<span class="s">"Contradicted"</span>): gate_answer(r)</pre></div>
      <div class="cblock" data-l="js"><pre><span class="k">import</span> {Strata} <span class="k">from</span> <span class="s">"./strata.js"</span>;   <span class="c">// clients/js — zero deps</span>
<span class="k">const</span> s=<span class="k">new</span> Strata({apiKey:<span class="s">"sk_live_..."</span>, baseUrl:base});
<span class="k">const</span> r=<span class="k">await</span> s.verify(<span class="s">"Metformin reduces cardiovascular mortality in type 2 diabetes"</span>);
<span class="k">if</span>([<span class="s">"Mixed"</span>,<span class="s">"Contradicted"</span>].includes(r.status)) gateAnswer(r);</pre></div>
    </div>
  </section>

  <section class="sec" id="stream"><h2>Streaming</h2>
    <div class="ep"><span class="m post">POST</span><span class="path">/v1/verify/stream</span><span class="badge">newline-delimited JSON</span></div>
    <p>Same input as <span class="mono">/v1/verify</span>, but streams the pipeline stage-by-stage for a progressive UI. Each line is a JSON object <span class="mono">{"type":"stage",...}</span>; the final line is <span class="mono">{"type":"done","receipt":{...}}</span>. Stages: understand → expand → retrieve → dedup → rank → classify → extract → contradiction → grade → synthesize → audit.</p>
  </section>

  <section class="sec" id="batch"><h2>Batch verification</h2>
    <div class="ep"><span class="m post">POST</span><span class="path">/v1/verify/batch</span></div>
    <p>Verify up to 25 claims in one call. Body: <span class="mono">{"claims": ["...", "..."]}</span> → <span class="mono">{"results": [receipt, ...]}</span>.</p>
  </section>

  <section class="sec" id="compare"><h2>Compare two claims</h2>
    <div class="ep"><span class="m post">POST</span><span class="path">/v1/compare</span></div>
    <p>Weigh two claims against each other. Body: <span class="mono">{"claim_a":"...","claim_b":"..."}</span>. Returns both receipts plus a <span class="mono">winner</span> and a <span class="mono">rationale</span>.</p>
  </section>

  <section class="sec" id="receipt"><h2>Evidence Receipt schema</h2>
    <p>Every verification returns the same structured object. Key fields:</p>
    <table class="ref"><tr><th>Field</th><th>Type</th><th>Meaning</th></tr>
      <tr><td class="f">receipt_id</td><td class="t">string</td><td>Deterministic id (STR-…) for the claim.</td></tr>
      <tr><td class="f">claim_status</td><td class="t">enum</td><td>SUPPORTED · PARTIALLY_SUPPORTED · CONTRADICTED · INSUFFICIENT · UNSUPPORTED</td></tr>
      <tr><td class="f">strength</td><td class="t">enum</td><td>high · moderate · low · very low · none</td></tr>
      <tr><td class="f">confidence</td><td class="t">float</td><td>0–1, calibrated from quantity, quality, agreement, recency.</td></tr>
      <tr><td class="f">supporting / contradicting / neutral</td><td class="t">int</td><td>Study counts by stance.</td></tr>
      <tr><td class="f">pico</td><td class="t">object</td><td>Structured population / intervention / comparator / outcome.</td></tr>
      <tr><td class="f">strength_rationale</td><td class="t">object</td><td>Inspectable GRADE: per-domain ratings + <span class="mono">factors</span> / <span class="mono">limitations</span>.</td></tr>
      <tr><td class="f">contradiction</td><td class="t">object</td><td>Why supporting and contradicting studies disagree, with examples.</td></tr>
      <tr><td class="f">effect_estimates</td><td class="t">array</td><td>Heuristically extracted measures with CIs (labeled heuristic).</td></tr>
      <tr><td class="f">citations</td><td class="t">array</td><td>Each study: title, year, level, label, stance, source, url, effect, snippet.</td></tr>
      <tr><td class="f">key_limitation</td><td class="t">string</td><td>The single most important caveat.</td></tr>
      <tr><td class="f">audit_trail</td><td class="t">array</td><td>Per-stage record (stage, detail, ms) — every conclusion is traceable.</td></tr>
      <tr><td class="f">models_used</td><td class="t">array</td><td>Which AI tasks ran, if any (empty on the pure-heuristic path).</td></tr></table>
  </section>

  <section class="sec" id="claims"><h2>Claims</h2>
    <p>A claim is a first-class, versioned, monitored object living in a workspace and therapeutic area.</p>
    <table class="ref"><tr><th>Endpoint</th><th>Method</th><th>Purpose</th></tr>
      <tr><td class="f">/v1/claims</td><td class="t">POST</td><td>Create a monitored claim (workspace_id, area_id, pico, alert_rules) and run a baseline verification.</td></tr>
      <tr><td class="f">/v1/claims</td><td class="t">GET</td><td>List claims (filter by <span class="mono">?workspace=</span> / <span class="mono">?area=</span>).</td></tr>
      <tr><td class="f">/v1/claims/:id</td><td class="t">GET</td><td>Full dossier: protocol, version timeline, latest receipt, alerts.</td></tr>
      <tr><td class="f">/v1/claims/:id/recheck</td><td class="t">POST</td><td>Re-verify now; version and raise alerts if the evidence moved.</td></tr>
      <tr><td class="f">/v1/claims/:id/history</td><td class="t">GET</td><td>The evidence-change timeline (versions over time).</td></tr></table>
    <div class="code"><div class="bar"><span class="fn">create a monitored claim</span></div>
      <pre>curl -X POST <span class="s">$BASE/v1/claims</span> -H <span class="s">"Authorization: Bearer $STRATA_KEY"</span> \
  -d <span class="s">'{"claim":"Drug X reduces hospitalization in heart failure",
       "area_id":"area-cardiology",
       "alert_rules":{"new_rct":true,"safety_signal":true,"effect_change":true}}'</span></pre></div>
    <h3>Alert rules</h3>
    <p>Each claim watches for: <span class="mono">new_meta_analysis</span>, <span class="mono">new_rct</span>, <span class="mono">new_contradiction</span>, <span class="mono">strength_change</span>, <span class="mono">status_change</span>, <span class="mono">safety_signal</span>, <span class="mono">effect_change</span>. All on by default; disable any by setting it <span class="mono">false</span>.</p>
  </section>

  <section class="sec" id="changes"><h2>Changes</h2>
    <div class="ep"><span class="m get">GET</span><span class="path">/v1/changes</span></div>
    <p>A newest-first feed of evidence-change alerts across your whole evidence base. Filter with <span class="mono">?workspace=</span> and <span class="mono">?limit=</span>. Each alert carries a <span class="mono">type</span>, <span class="mono">severity</span> (green/amber/red), <span class="mono">headline</span>, <span class="mono">detail</span>, the <span class="mono">evidence</span> that triggered it, and the claim <span class="mono">version</span>.</p>
  </section>

  <section class="sec" id="evidence"><h2>Evidence</h2>
    <div class="ep"><span class="m get">GET</span><span class="path">/v1/evidence/:id</span></div>
    <p>Resolve one study (by PMID or DOI) across the monitored set: the study record plus which claims cite it and whether each cites it as supporting or contradicting.</p>
  </section>

  <section class="sec" id="alerts"><h2>Alerts</h2>
    <table class="ref"><tr><th>Endpoint</th><th>Method</th><th>Purpose</th></tr>
      <tr><td class="f">/v1/alerts</td><td class="t">GET</td><td>List alerts (<span class="mono">?workspace=</span>, <span class="mono">?unacknowledged=1</span>).</td></tr>
      <tr><td class="f">/v1/alerts/:id/ack</td><td class="t">POST</td><td>Acknowledge an alert.</td></tr></table>
  </section>

  <section class="sec" id="webhooks"><h2>Webhooks</h2>
    <div class="ep"><span class="m post">POST</span><span class="path">/v1/webhooks</span></div>
    <p>Register an endpoint to receive an <span class="mono">evidence.changed</span> event whenever a monitored claim raises alerts. Body: <span class="mono">{"url":"https://…"}</span> → returns an id and a signing <span class="mono">secret</span>.</p>
    <p>Every delivery is a POST with header <span class="mono">X-Strata-Signature: sha256=&lt;hmac&gt;</span> — the HMAC-SHA256 of the raw body using your secret. Verify it before acting:</p>
    <div class="code"><div class="bar"><span class="fn">verify a webhook signature</span><div class="tabs" data-tabs><span class="tab on" data-l="py">Python</span><span class="tab" data-l="js">JS</span></div></div>
      <div class="cblock on" data-l="py"><pre><span class="k">import</span> hmac, hashlib
<span class="k">def</span> <span class="n">valid</span>(body_bytes, header_sig, secret):
    mac=hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
    <span class="k">return</span> hmac.compare_digest(<span class="s">"sha256="</span>+mac, header_sig)</pre></div>
      <div class="cblock" data-l="js"><pre><span class="k">import</span> crypto <span class="k">from</span> <span class="s">"crypto"</span>;
<span class="k">function</span> <span class="n">valid</span>(bodyStr, headerSig, secret){
  <span class="k">const</span> mac=crypto.createHmac(<span class="s">"sha256"</span>,secret).update(bodyStr).digest(<span class="s">"hex"</span>);
  <span class="k">return</span> <span class="s">"sha256="</span>+mac===headerSig; }</pre></div>
    </div>
  </section>

  <section class="sec" id="console"><h2>Console summary</h2>
    <div class="ep"><span class="m get">GET</span><span class="path">/v1/console/summary</span></div>
    <p>The Evidence-Health rollup that powers the Console: <span class="mono">claims_monitored</span>, <span class="mono">strengthened</span>, <span class="mono">weakened</span>, <span class="mono">newly_contradicted</span>, <span class="mono">new_studies</span>, <span class="mono">open_alerts</span>, plus per-area activity, the status mix, and an attention queue.</p>
  </section>

  <section class="sec" id="ratelimits"><h2>Rate limits</h2>
    <p>Each key carries a sliding-window per-minute limit (default 60). Over the limit, Strata returns <span class="mono">429</span> with a <span class="mono">retry_after</span> (seconds). Usage and a bounded request log are tracked per key.</p>
  </section>

  <section class="sec" id="errors"><h2>Errors</h2>
    <p>Standard HTTP status codes; the body is always <span class="mono">{"error":"..."}</span> on failure.</p>
    <table class="ref"><tr><th>Code</th><th>Meaning</th></tr>
      <tr><td class="f">400</td><td>Malformed request — a required field (e.g. <span class="mono">claim</span>) is missing.</td></tr>
      <tr><td class="f">401</td><td>Missing or invalid API key (when the server requires one).</td></tr>
      <tr><td class="f">404</td><td>Unknown claim, receipt, or evidence id.</td></tr>
      <tr><td class="f">429</td><td>Rate limited — back off for <span class="mono">retry_after</span> seconds.</td></tr>
      <tr><td class="f">500</td><td>Server error. Strata fails soft per evidence source and never fabricates on missing data.</td></tr></table>
  </section>

  <section class="sec" id="sdks"><h2>SDKs</h2>
    <p>Zero-dependency clients ship in the repo:</p>
    <ul><li><span class="mono">clients/python/strata_client.py</span> — <span class="mono">Strata(api_key).verify(claim)</span>, <span class="mono">.compare()</span>, <span class="mono">.monitor()</span>, <span class="mono">.check()</span></li>
      <li><span class="mono">clients/js/strata.js</span> — <span class="mono">new Strata({apiKey}).verify(claim)</span></li></ul>
    <p>Or call the JSON API directly with anything that speaks HTTP.</p>
  </section>

  <section class="sec" id="selfhost"><h2>Self-host</h2>
    <p>Run the whole platform — API, Console, engine — inside your own network:</p>
    <div class="code"><div class="bar"><span class="fn">deploy</span></div>
      <pre><span class="c"># Docker</span>
STRATA_API_KEYS=sk_live_your_key <span class="k">docker compose up --build</span>
<span class="c"># or pip</span>
pip install strata-evidence &amp;&amp; STRATA_API_KEYS=sk_live_key <span class="k">strata serve --host 0.0.0.0</span></pre></div>
    <p>Strata reads only public literature, so no patient data ever leaves your network. See <a href="/security">Security</a> and <a href="/trust">Trust</a>.</p>
  </section>

  <div class="foot">Strata appraises published literature for decision support. Not a medical device, no patient data, no diagnosis, no determination of truth. Every claim links to its primary sources for independent review.</div>
</main>
</div>
<script>
// base URL reflects the server actually serving this page
try{document.getElementById('baseUrl').textContent=location.origin;}catch(e){}
// language tabs (scoped per code block group)
document.querySelectorAll('[data-tabs]').forEach(function(g){
  g.querySelectorAll('.tab').forEach(function(t){t.onclick=function(){
    const code=g.closest('.code'),lang=t.getAttribute('data-l');
    g.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===t));
    code.querySelectorAll('.cblock').forEach(b=>b.classList.toggle('on',b.getAttribute('data-l')===lang));
  };});
});
// scroll-spy sidebar
const links=[...document.querySelectorAll('.side a')];
const map={};links.forEach(a=>{const id=a.getAttribute('href').slice(1);const el=document.getElementById(id);if(el)map[id]=a;});
const obs=new IntersectionObserver((es)=>{es.forEach(e=>{if(e.isIntersecting){
  links.forEach(l=>l.classList.remove('on'));if(map[e.target.id])map[e.target.id].classList.add('on');}});},{rootMargin:'-60px 0px -70% 0px'});
Object.keys(map).forEach(id=>{const el=document.getElementById(id);if(el)obs.observe(el);});
</script></body></html>"""
