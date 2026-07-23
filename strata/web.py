"""HTML surfaces for the Strata web app — accessible, data-bound, self-contained.

Pages are static shells; all data arrives from the ``/app/*`` JSON endpoints, so
every chart is derived from real pipeline output rather than decoration. The UI
targets WCAG 2.2 AA: semantic landmarks, a skip link, labelled search, an
``aria-live`` results region, keyboard-operable controls, colour that is never
the only signal (every badge and tier carries text), a visually-hidden data
table behind each chart, reduced-motion support, and light/dark themes.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from .db import Database

# --------------------------------------------------------------------------
# Data functions (consumed by the built-in Console; all values are real rows)
# --------------------------------------------------------------------------

def console_overview(db: Database, ws: int) -> Dict[str, Any]:
    stats = db.dashboard_stats(ws)
    wrow = db.one("SELECT name FROM workspaces WHERE id=?", (ws,))
    return {
        "workspace": (wrow or {}).get("name", "Workspace"),
        "stats": stats,
        "changes": db.list_changes(ws, limit=12),
        "alerts": db.list_alerts(ws, status="new", limit=10),
        "areas": db.therapeutic_area_activity(ws, since=stats["since"]),
    }


def _latest_counts(db: Database, claim_id: int) -> Dict[str, int]:
    lv = db.latest_version(claim_id)
    if not lv:
        return {"supporting": 0, "contradicting": 0}
    return {"supporting": lv["supporting_count"], "contradicting": lv["contradicting_count"]}


def console_claims(db: Database, ws: int, qs: Dict[str, List[str]]) -> Dict[str, Any]:
    status = (qs.get("status") or [None])[0]
    strength = (qs.get("strength") or [None])[0]
    area = (qs.get("area") or [None])[0]
    text = ((qs.get("q") or [""])[0] or "").lower()
    rows = db.list_claims(ws, status=status or None)
    out = []
    for c in rows:
        if strength and c["evidence_strength"] != strength:
            continue
        if text and text not in c["text"].lower():
            continue
        area_row = (db.one("SELECT name FROM therapeutic_areas WHERE id=?",
                           (c["therapeutic_area_id"],)) if c["therapeutic_area_id"] else None)
        area_name = (area_row or {}).get("name", "—")
        if area and area_name != area:
            continue
        counts = _latest_counts(db, c["id"])
        out.append({
            "id": c["id"], "text": c["text"], "status": c["status"],
            "evidence_strength": c["evidence_strength"], "trend": c["trend"],
            "version": c["current_version"], "area": area_name,
            "supporting": counts["supporting"], "contradicting": counts["contradicting"],
            "last_verified_at": c["last_verified_at"],
        })
    areas = [r["name"] for r in db.query(
        "SELECT name FROM therapeutic_areas WHERE workspace_id=? ORDER BY name", (ws,))]
    return {"claims": out, "areas": areas}


def console_claim_detail(db: Database, claim_id: int) -> Optional[Dict[str, Any]]:
    claim = db.get_claim(claim_id)
    if claim is None:
        return None
    version = claim["current_version"] or 1
    items = db.evidence_for_version(claim_id, version)
    pyramid = {i: 0 for i in range(1, 7)}
    supporting, contradicting, neutral, forest = [], [], [], []
    for it in items:
        pyramid[it["grade_level"]] = pyramid.get(it["grade_level"], 0) + 1
        rec = {
            "title": it["title"], "year": it["year"], "url": it["url"],
            "journal": it["journal"], "study_type": it["grade_label"],
            "level": it["grade_level"], "strength": it["strength"],
            "stance": it["stance"], "stance_reason": it["stance_reason"],
            "disagreement_type": it["disagreement_type"],
            "population_match": (it.get("population_match") or {}).get("match", "unknown"),
            "effect": it.get("effect"),
        }
        {"supporting": supporting, "contradicting": contradicting}.get(
            it["stance"], neutral).append(rec)
        eff = it.get("effect")
        if eff and eff.get("ci_low") is not None and eff.get("ci_high") is not None:
            forest.append({"title": it["title"], "metric": eff["metric"], "value": eff["value"],
                           "ci_low": eff["ci_low"], "ci_high": eff["ci_high"],
                           "kind": eff["kind"], "stance": it["stance"]})
    timeline = [{"version": t["version"], "status": t["status"],
                 "evidence_strength": t["evidence_strength"],
                 "supporting": t["supporting_count"], "contradicting": t["contradicting_count"],
                 "created_at": t["created_at"], "summary": t["summary"]}
                for t in db.claim_timeline(claim_id)]
    latest = db.latest_version(claim_id) or {}
    changes = db.query(
        "SELECT change_type, impact, summary, created_at FROM change_events "
        "WHERE claim_id=? ORDER BY created_at DESC LIMIT 20", (claim_id,))
    return {
        "id": claim_id, "text": claim["text"], "status": claim["status"],
        "evidence_strength": claim["evidence_strength"], "trend": claim["trend"],
        "version": version, "population": claim.get("population"),
        "intervention": claim.get("intervention"), "outcome": claim.get("outcome"),
        "last_verified_at": claim.get("last_verified_at"),
        "assessment": latest.get("assessment"),
        "supporting": supporting, "contradicting": contradicting, "neutral": neutral,
        "pyramid": pyramid, "forest": forest, "timeline": timeline, "changes": changes,
    }


# --------------------------------------------------------------------------
# Shared shell (CSS + nav) and page templates
# --------------------------------------------------------------------------

def _shell(title: str, body: str, script: str = "", active: str = "") -> str:
    def nav(href, label, key):
        cur = ' aria-current="page"' if key == active else ""
        return f'<a href="{href}"{cur}>{label}</a>'
    return f"""<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{title}</title>
<meta name="description" content="Strata — continuous evidence intelligence. Know whether the medical claims you rely on are still supported by the evidence, and get alerted when that changes."/>
<style>{_CSS}</style></head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar"><div class="wrap bar">
  <a class="brand" href="/"><span class="mark" aria-hidden="true">≣</span><span>Strata</span></a>
  <nav aria-label="Primary">{nav('/verify','Verify','verify')}{nav('/console','Console','console')}{nav('/docs','API','docs')}</nav>
  <button id="theme" class="ghost" type="button" aria-label="Toggle colour theme">◐</button>
</div></header>
<main id="main">{body}</main>
<footer class="foot"><div class="wrap">
  <p><strong>Strata</strong> · Continuous Evidence Intelligence. Decision support from public
  literature — not medical advice, and not a substitute for reading the primary sources.</p>
</div></footer>
<script>{_BASE_JS}
{script}</script>
</body></html>"""


def homepage() -> str:
    body = """
<section class="hero"><div class="wrap">
  <p class="kicker">Continuous Evidence Intelligence</p>
  <h1>Medical evidence changes every day.<br/><span class="grad">Strata tells you when it matters.</span></h1>
  <p class="lede">You rely on thousands of medical claims. Strata verifies each one against the
  real literature — what supports it, what contradicts it, how strong the evidence is — and then
  <strong>watches for change</strong>, alerting you the moment a new trial weakens what you believed.</p>
  <div class="cta"><a class="btn" href="#try">Try Strata Verify</a>
    <a class="btn ghost-btn" href="/console">See the Console</a></div>
</div></section>

<section id="try" class="wrap band" aria-labelledby="try-h">
  <h2 id="try-h">Verify a claim against the evidence</h2>
  <p class="muted">Enter a clinical claim or question. Strata structures it, searches biomedical
  literature, grades each study, and separates the evidence that supports it from the evidence that
  weakens it — with an inspectable strength verdict. Nothing is stored.</p>
  <form id="vform" role="search" class="search">
    <label class="sr-only" for="vq">Clinical claim or question</label>
    <input id="vq" name="q" type="text" autocomplete="off"
      placeholder="Does Treatment X reduce hospitalization in elderly heart failure?"/>
    <button class="btn" id="vgo" type="submit">Verify</button>
  </form>
  <div class="chips" id="examples" aria-label="Example questions"></div>
  <div id="vout" class="result" aria-live="polite" aria-busy="false"></div>
</section>

<section class="wrap band alt" aria-labelledby="loop-h">
  <h2 id="loop-h">Version control for medical knowledge</h2>
  <ol class="loop">
    <li><strong>Define</strong> the claims that matter to your organization.</li>
    <li><strong>Verify</strong> each against supporting and contradicting studies.</li>
    <li><strong>Grade</strong> the strength transparently — you can open every judgement.</li>
    <li><strong>Monitor</strong> the literature continuously as new studies publish.</li>
    <li><strong>Detect</strong> the moment the evidence strengthens, weakens, or is contradicted.</li>
    <li><strong>Alert</strong> your team — with the exact study and a recommended action.</li>
  </ol>
</section>

<section class="wrap band" aria-labelledby="who-h">
  <h2 id="who-h">Built for the organizations that live or die by evidence</h2>
  <div class="grid">
    <div class="card"><h3>Pharma & medical affairs</h3><p>Monitor every claim about your molecule and
      therapeutic area. Know before your competitors — and your regulators — do.</p></div>
    <div class="card"><h3>Hospitals & guidelines</h3><p>Keep protocols anchored to current evidence.
      Get told when a practice-changing trial lands.</p></div>
    <div class="card"><h3>Medical AI companies</h3><p>Verify generated medical claims through one API
      call: supported or not, by what, and how strong.</p></div>
  </div>
</section>

<section class="wrap band demo" aria-labelledby="demo-h">
  <h2 id="demo-h">Request a demo</h2>
  <p class="muted">Tell us the therapeutic area you'd protect first.</p>
  <form id="dform" class="demoform" novalidate>
    <div class="row"><label for="d-name">Name</label><input id="d-name" name="name" autocomplete="name"/></div>
    <div class="row"><label for="d-email">Work email <span aria-hidden="true">*</span></label>
      <input id="d-email" name="email" type="email" required autocomplete="email" aria-required="true"/></div>
    <div class="row"><label for="d-org">Organization</label><input id="d-org" name="organization" autocomplete="organization"/></div>
    <div class="row"><label for="d-role">Role</label><input id="d-role" name="role" autocomplete="organization-title"/></div>
    <div class="row"><label for="d-company">Company type</label><input id="d-company" name="company"/></div>
    <div class="row wide"><label for="d-use">Use case</label><textarea id="d-use" name="use_case" rows="3"></textarea></div>
    <div class="row wide"><button class="btn" id="dgo" type="submit">Request demo</button>
      <span id="dmsg" role="status" class="muted"></span></div>
  </form>
</section>
"""
    return _shell("Strata — Continuous Evidence Intelligence", body, _HOME_JS, active="")


def verify_page() -> str:
    body = """
<section class="wrap band">
  <h1>Strata Verify</h1>
  <p class="muted">The evidence engine, full trail. Every step is shown: how your question was
  structured, what was searched, how each study was graded, which studies support the claim and
  which contradict it — and why the strength is what it is.</p>
  <form id="vform" role="search" class="search">
    <label class="sr-only" for="vq">Clinical claim or question</label>
    <input id="vq" name="q" type="text" autocomplete="off"
      placeholder="Does Treatment X reduce hospitalization in elderly heart failure?"/>
    <button class="btn" id="vgo" type="submit">Verify</button>
  </form>
  <div class="chips" id="examples" aria-label="Example questions"></div>
  <div id="vout" class="result" aria-live="polite" aria-busy="false"></div>
</section>
"""
    return _shell("Strata Verify", body, _HOME_JS + _VERIFY_FULL_JS, active="verify")


def console_page() -> str:
    body = """
<section class="wrap band">
  <div class="chead">
    <div><h1>Console</h1><p class="muted" id="ws-name">Evidence health across your monitored claims.</p></div>
    <span class="synthetic" title="This demo workspace uses synthetic studies; the analysis is real.">Synthetic demo data</span>
  </div>
  <div id="tiles" class="tiles" aria-label="Evidence health"></div>
  <div class="two">
    <section aria-labelledby="chg-h"><h2 id="chg-h">What changed</h2><ul id="changes" class="feed"></ul></section>
    <section aria-labelledby="alr-h"><h2 id="alr-h">Open alerts</h2><ul id="alerts" class="feed"></ul></section>
  </div>
  <section aria-labelledby="cl-h">
    <div class="chead"><h2 id="cl-h">Claims</h2></div>
    <form class="filters" id="filters" role="search" aria-label="Filter claims">
      <label class="sr-only" for="f-q">Search claims</label>
      <input id="f-q" placeholder="Search claims…"/>
      <label class="sr-only" for="f-status">Status</label>
      <select id="f-status"><option value="">All statuses</option></select>
      <label class="sr-only" for="f-strength">Strength</label>
      <select id="f-strength"><option value="">All strengths</option></select>
      <label class="sr-only" for="f-area">Area</label>
      <select id="f-area"><option value="">All areas</option></select>
    </form>
    <div id="claims" class="claims"></div>
  </section>
</section>
<div id="detail" class="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title" hidden>
  <div class="drawer-inner"><button id="d-close" class="ghost" aria-label="Close">✕</button>
    <div id="d-body"></div></div>
</div>
"""
    return _shell("Strata Console", body, _CONSOLE_JS, active="console")


def docs_page() -> str:
    body = _DOCS_HTML
    return _shell("Strata API — Reference", body, "", active="docs")


# --------------------------------------------------------------------------
# Static assets: CSS + JavaScript (accessible, theme-aware, data-bound)
# --------------------------------------------------------------------------

_CSS = r"""
:root{
  --bg:#f6f8fc; --surface:#ffffff; --surface2:#f1f5fb; --ink:#0f172a; --muted:#5a6474;
  --line:#e3e9f2; --brand:#0d9488; --brand-ink:#0b7d72; --focus:#0d9488;
  --high:#15803d; --moderate:#b45309; --low:#c2410c; --vlow:#b91c1c; --none:#64748b;
  --supported:#15803d; --partial:#b45309; --contested:#6d28d9; --unsupported:#b91c1c;
  --up:#15803d; --down:#b91c1c; --radius:12px; --shadow:0 1px 2px rgba(15,23,42,.06);
}
@media (prefers-color-scheme: dark){:root{
  --bg:#0a0f1c; --surface:#111a2e; --surface2:#0e1626; --ink:#e7eef8; --muted:#93a1b7;
  --line:#1e293b; --brand:#2dd4bf; --brand-ink:#5eead4; --focus:#2dd4bf;
  --high:#4ade80; --moderate:#fbbf24; --low:#fb923c; --vlow:#f87171; --none:#94a3b8;
  --supported:#4ade80; --partial:#fbbf24; --contested:#a78bfa; --unsupported:#f87171;
  --up:#4ade80; --down:#f87171; --shadow:0 1px 2px rgba(0,0,0,.4);
}}
:root[data-theme="dark"]{
  --bg:#0a0f1c; --surface:#111a2e; --surface2:#0e1626; --ink:#e7eef8; --muted:#93a1b7;
  --line:#1e293b; --brand:#2dd4bf; --brand-ink:#5eead4; --focus:#2dd4bf;
  --high:#4ade80; --moderate:#fbbf24; --low:#fb923c; --vlow:#f87171; --none:#94a3b8;
  --supported:#4ade80; --partial:#fbbf24; --contested:#a78bfa; --unsupported:#f87171;
  --up:#4ade80; --down:#f87171; --shadow:0 1px 2px rgba(0,0,0,.4);
}
:root[data-theme="light"]{
  --bg:#f6f8fc; --surface:#ffffff; --surface2:#f1f5fb; --ink:#0f172a; --muted:#5a6474;
  --line:#e3e9f2; --brand:#0d9488; --brand-ink:#0b7d72; --focus:#0d9488;
  --high:#15803d; --moderate:#b45309; --low:#c2410c; --vlow:#b91c1c; --none:#64748b;
  --supported:#15803d; --partial:#b45309; --contested:#6d28d9; --unsupported:#b91c1c;
  --up:#15803d; --down:#b91c1c;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}*{animation-duration:.001ms!important;transition:none!important}}
body{background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:0 22px}
a{color:var(--brand-ink);text-underline-offset:2px}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:4px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
.skip{position:absolute;left:-999px;top:0;background:var(--brand);color:#fff;padding:10px 16px;z-index:100;border-radius:0 0 8px 0}
.skip:focus{left:0}
.muted{color:var(--muted)}
h1{font-size:clamp(26px,4vw,40px);line-height:1.1;letter-spacing:-.02em}
h2{font-size:22px;letter-spacing:-.01em;margin-bottom:8px}
h3{font-size:16px}
/* top bar */
.topbar{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.bar{display:flex;align-items:center;gap:18px;height:58px}
.brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:18px;text-decoration:none;color:var(--ink);letter-spacing:-.02em}
.brand .mark{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--brand),#0891b2);color:#fff;font-size:18px}
.topbar nav{display:flex;gap:6px;margin-left:auto}
.topbar nav a{padding:7px 12px;border-radius:8px;text-decoration:none;color:var(--muted);font-weight:600;font-size:14px}
.topbar nav a:hover{color:var(--ink);background:var(--surface2)}
.topbar nav a[aria-current]{color:var(--brand-ink);background:color-mix(in srgb,var(--brand) 12%,transparent)}
.ghost{background:transparent;border:1px solid var(--line);color:var(--ink);border-radius:8px;width:36px;height:34px;cursor:pointer;font-size:16px}
.ghost:hover{background:var(--surface2)}
/* hero */
.hero{padding:64px 0 34px;background:radial-gradient(1200px 400px at 70% -10%,color-mix(in srgb,var(--brand) 12%,transparent),transparent)}
.kicker{text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:700;color:var(--brand-ink);margin-bottom:14px}
.grad{background:linear-gradient(100deg,var(--brand),#0891b2 60%,#6d28d9);-webkit-background-clip:text;background-clip:text;color:transparent}
.lede{font-size:18px;max-width:62ch;margin:18px 0 26px;color:var(--muted)}
.lede strong{color:var(--ink)}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--brand);color:#fff;border:0;border-radius:10px;padding:12px 20px;font-weight:700;font-size:15px;cursor:pointer;text-decoration:none}
.btn:hover{filter:brightness(1.05)}
.btn:disabled{opacity:.55;cursor:default}
.btn.ghost-btn,.ghost-btn{background:transparent;color:var(--ink);border:1px solid var(--line)}
.band{padding:40px 0;border-top:1px solid var(--line)}
.band.alt{background:var(--surface2)}
.band>h2,.band>p{max-width:70ch}
/* search */
.search{display:flex;gap:10px;margin:18px 0 12px}
.search input{flex:1;min-width:0;padding:14px 16px;border:1px solid var(--line);border-radius:11px;font-size:16px;background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.chip{font-size:13px;color:var(--brand-ink);background:color-mix(in srgb,var(--brand) 9%,transparent);border:1px solid color-mix(in srgb,var(--brand) 26%,transparent);padding:6px 12px;border-radius:999px;cursor:pointer;font-weight:600}
.result{margin-top:22px}
/* cards / grid */
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:18px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:18px;box-shadow:var(--shadow)}
.card h3{margin-bottom:6px}
.loop{max-width:70ch;margin-top:14px;padding-left:22px;display:grid;gap:8px}
.loop strong{color:var(--brand-ink)}
/* badges */
.badge{display:inline-flex;align-items:center;gap:6px;font-weight:800;font-size:11px;letter-spacing:.03em;padding:4px 10px;border-radius:7px;color:#fff;text-transform:uppercase}
.b-high,.b-supported{background:var(--high)} .b-moderate,.b-partial{background:var(--moderate)}
.b-low{background:var(--low)} .b-vlow,.b-unsupported,.b-very.low{background:var(--vlow)}
.b-none{background:var(--none)} .b-contested{background:var(--contested)}
.pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;border:1px solid var(--line);color:var(--muted);background:var(--surface2)}
.trend{font-weight:700;font-size:12px}
.trend.up{color:var(--up)} .trend.down{color:var(--down)} .trend.stable{color:var(--none)} .trend.new{color:var(--brand-ink)}
/* verify result */
.verdict{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.q{font-size:19px;font-weight:700;margin:6px 0 4px}
.summary{color:var(--muted);margin-bottom:18px}
.cols{display:grid;grid-template-columns:280px 1fr;gap:24px}
@media (max-width:760px){.cols{grid-template-columns:1fr}.two{grid-template-columns:1fr!important}}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin-bottom:14px;box-shadow:var(--shadow)}
.panel h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:12px}
.stance-col h3 .n{color:var(--muted);font-weight:600}
/* pyramid */
.pyr .tier{margin:0 0 5px auto;min-height:40px;border-radius:7px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 11px;color:#fff;font-size:11px;font-weight:700;line-height:1.15;opacity:.3}
.pyr .tier.has{opacity:1;box-shadow:var(--shadow)}
.pyr .cnt{background:rgba(255,255,255,.28);border-radius:6px;padding:1px 8px;font-weight:800}
.t1{background:#15803d}.t2{background:#059669}.t3{background:#b45309}.t4{background:#c2410c}.t5{background:#b91c1c}.t6{background:#64748b}
/* study cards */
.study{border:1px solid var(--line);border-left:4px solid var(--none);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:var(--surface)}
.study.supporting{border-left-color:var(--high)} .study.contradicting{border-left-color:var(--vlow)}
.study .top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.study .ti{font-weight:650;margin-bottom:4px}
.study .rz{font-size:13px;color:var(--muted)}
.study a{font-size:13px;font-weight:600}
.disagree{font-size:11px;font-weight:700;color:var(--contested);border:1px solid color-mix(in srgb,var(--contested) 40%,transparent);padding:2px 7px;border-radius:6px}
.reasons{list-style:none;display:grid;gap:5px}
.reasons li{font-size:13.5px} .reasons .plus{color:var(--up);font-weight:800} .reasons .minus{color:var(--down);font-weight:800}
.trail{list-style:none;counter-reset:s;display:grid;gap:6px}
.trail li{font-size:13px;color:var(--muted);padding-left:26px;position:relative}
.trail li::before{counter-increment:s;content:counter(s);position:absolute;left:0;top:0;width:18px;height:18px;border-radius:50%;background:var(--surface2);border:1px solid var(--line);color:var(--ink);font-size:11px;font-weight:700;display:grid;place-items:center}
.forest text{fill:var(--muted)} .forest .null{stroke:var(--line)}
.err{background:color-mix(in srgb,var(--vlow) 12%,transparent);border:1px solid color-mix(in srgb,var(--vlow) 40%,transparent);color:var(--vlow);padding:14px 16px;border-radius:12px}
.spin{display:inline-block;width:15px;height:15px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:sp .7s linear infinite;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
/* console */
.chead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.synthetic{font-size:12px;font-weight:700;color:var(--moderate);border:1px solid color-mix(in srgb,var(--moderate) 40%,transparent);padding:4px 10px;border-radius:999px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0 26px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;box-shadow:var(--shadow)}
.tile .k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700}
.tile .v{font-size:28px;font-weight:800;letter-spacing:-.02em;margin-top:4px}
.tile .v small{font-size:14px;font-weight:700}
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:26px}
.feed{list-style:none;display:grid;gap:8px}
.feed li{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:11px 13px;font-size:14px}
.feed .meta{font-size:12px;color:var(--muted);margin-top:3px}
.filters{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 16px}
.filters input,.filters select{padding:9px 12px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink);font-size:14px}
.filters input{flex:1;min-width:180px}
.claims{display:grid;gap:10px}
.claimrow{display:flex;align-items:center;gap:14px;justify-content:space-between;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:13px 15px;cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit}
.claimrow:hover{border-color:var(--brand)}
.claimrow .ct{font-weight:600;flex:1;min-width:0}
.claimrow .cmeta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.evbar{display:inline-flex;height:8px;border-radius:5px;overflow:hidden;min-width:70px;border:1px solid var(--line)}
.evbar i{display:block;height:100%} .evbar .sup{background:var(--high)} .evbar .con{background:var(--vlow)}
/* drawer */
.drawer{position:fixed;inset:0;background:rgba(2,6,23,.5);display:flex;justify-content:flex-end;z-index:50}
.drawer[hidden]{display:none}
.drawer-inner{background:var(--bg);width:min(680px,100%);height:100%;overflow:auto;padding:22px;position:relative;border-left:1px solid var(--line)}
#d-close{position:absolute;right:16px;top:16px}
.tl{display:grid;gap:6px;margin-top:8px}
.tl .row{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center}
.tl .bar{height:10px;border-radius:5px}
.foot{border-top:1px solid var(--line);margin-top:30px;padding:24px 0;color:var(--muted);font-size:13px}
.demoform{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:640px;margin-top:14px}
.demoform .row{display:grid;gap:5px} .demoform .wide{grid-column:1/-1}
.demoform label{font-size:13px;font-weight:600} 
.demoform input,.demoform textarea{padding:11px 13px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink);font:inherit}
@media (max-width:620px){.demoform{grid-template-columns:1fr}}
"""

_BASE_JS = r"""
(function(){
  var root=document.documentElement;
  try{var t=localStorage.getItem('strata-theme'); if(t) root.setAttribute('data-theme',t);}catch(e){}
  var btn=document.getElementById('theme');
  if(btn) btn.addEventListener('click',function(){
    var cur=root.getAttribute('data-theme');
    var next = cur==='dark'?'light':(cur==='light'?'dark':(matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark'));
    root.setAttribute('data-theme',next);
    try{localStorage.setItem('strata-theme',next);}catch(e){}
  });
})();
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function cls(s){return String(s||'').replace(/[^a-z]/g,'');}
function badge(kind,label){return '<span class="badge b-'+cls(kind)+'">'+esc(label||kind)+'</span>';}
function trendEl(t){var m={strengthening:['up','↑ strengthening'],weakening:['down','↓ weakening'],stable:['stable','→ stable'],new:['new','• new']};var v=m[t]||['stable',t||''];return '<span class="trend '+v[0]+'">'+v[1]+'</span>';}
async function getJSON(url){var r=await fetch(url);return await r.json();}
var EXAMPLES=["Does Treatment X reduce hospitalization in elderly patients with heart failure?",
  "Does metformin reduce cardiovascular mortality in type 2 diabetes?",
  "Is intermittent fasting effective for weight loss?"];
// shared study/reasons renderers (used by both Verify and the Console)
function studyCard(s){
  var eff=s.effect?('<span class="pill">'+esc(s.effect.metric)+' '+esc(s.effect.value)+(s.effect.ci_low!=null?(' (95% CI '+esc(s.effect.ci_low)+'–'+esc(s.effect.ci_high)+')'):'')+'</span>'):'';
  var dis=s.disagreement_label?('<span class="disagree">'+esc(s.disagreement_label)+'</span>'):'';
  var pmv=(s.population_match&&typeof s.population_match==='object')?s.population_match.match:s.population_match;
  var pm=pmv?('<span class="pill">population: '+esc(pmv)+'</span>'):'';
  return '<div class="study '+esc(s.stance)+'"><div class="top">'+badge(s.strength,s.strength)+
    '<span class="pill">'+esc(s.study_type)+'</span>'+eff+pm+dis+'<span class="pill">'+esc(s.year||'n.d.')+'</span></div>'+
    '<div class="ti">'+esc(s.title)+'</div><div class="rz">'+esc(s.stance_reason||'')+'</div>'+
    (s.url?('<a href="'+esc(s.url)+'" target="_blank" rel="noopener">View source →</a>'):'')+'</div>';
}
function reasonsPanel(d){
  var a=d.assessment||{};var r=(a.reasons||[]).map(function(x){return '<li><span class="plus">+</span> '+esc(x)+'</li>';}).join('');
  var l=(a.limitations||[]).map(function(x){return '<li><span class="minus">−</span> '+esc(x)+'</li>';}).join('');
  return '<div class="panel"><h3>Why this grade</h3><ul class="reasons">'+r+l+'</ul></div>';
}
"""

_HOME_JS = r"""
(function(){
  var ex=document.getElementById('examples');
  if(ex){ex.innerHTML=EXAMPLES.map(function(e){return '<button type="button" class="chip">'+esc(e)+'</button>';}).join('');
    ex.addEventListener('click',function(e){if(e.target.classList.contains('chip')){document.getElementById('vq').value=e.target.textContent;runVerify();}});}
  var form=document.getElementById('vform');
  if(form) form.addEventListener('submit',function(e){e.preventDefault();runVerify();});
  var df=document.getElementById('dform');
  if(df) df.addEventListener('submit',submitDemo);
})();
function pyramid(pyr,levels){
  var names={1:'Systematic review / meta-analysis',2:'Randomized controlled trial',3:'Cohort / prospective',4:'Observational',5:'Case report / series',6:'Review / opinion'};
  var widths=[46,56,66,76,86,96],out='<div class="panel pyr"><h3>Evidence pyramid</h3>';
  var tbl='<table class="sr-only"><caption>Studies by evidence level</caption><tbody>';
  for(var L=1;L<=6;L++){var c=(pyr&&pyr[L])||0;
    out+='<div class="tier t'+L+(c?' has':'')+'" style="width:'+widths[L-1]+'%"><span>'+esc(names[L])+'</span><span class="cnt">'+c+'</span></div>';
    tbl+='<tr><th>'+esc(names[L])+'</th><td>'+c+'</td></tr>';}
  return out+tbl+'</tbody></table></div>';
}
function renderVerifyCompact(d){
  var sup=d.supporting_evidence||[],con=d.contradicting_evidence||[];
  var st=(d.claim_status||'').replace(/_/g,' ');
  var h='<div class="verdict">'+badge(d.claim_status==='supported'?'supported':(d.claim_status==='contested'?'contested':(d.claim_status==='unsupported'?'unsupported':'partial')),st)+
    badge(d.evidence_strength,d.evidence_strength+' certainty')+'</div>'+
    '<p class="summary">'+esc((d.assessment&&d.assessment.summary)||'')+'</p>'+
    '<div class="cols"><div>'+pyramid((d.assessment&&d.assessment.domains)?levelCounts(d):countPyr(d),null)+
    reasonsPanel(d)+'</div><div>'+
    '<div class="panel stance-col"><h3>Supporting evidence <span class="n">('+sup.length+')</span></h3>'+(sup.length?sup.map(studyCard).join(''):'<p class="muted">No study clearly supports the claim.</p>')+'</div>'+
    '<div class="panel stance-col"><h3>Contradicting evidence <span class="n">('+con.length+')</span></h3>'+(con.length?con.map(studyCard).join(''):'<p class="muted">No study contradicts the claim.</p>')+'</div>'+
    '</div></div>';
  return h;
}
function countPyr(d){var p={1:0,2:0,3:0,4:0,5:0,6:0};(['supporting_evidence','contradicting_evidence','neutral_evidence']).forEach(function(k){(d[k]||[]).forEach(function(s){p[s.level]=(p[s.level]||0)+1;});});return p;}
function levelCounts(d){return countPyr(d);}
async function runVerify(){
  var q=document.getElementById('vq').value.trim(); if(!q) return;
  var out=document.getElementById('vout'), go=document.getElementById('vgo');
  go.disabled=true; go.innerHTML='<span class="spin"></span> Verifying';
  out.setAttribute('aria-busy','true'); out.innerHTML='<p class="summary">Structuring the question, searching the literature, grading each study…</p>';
  try{ var d=await getJSON('/app/verify?q='+encodeURIComponent(q));
    if(d.error){out.innerHTML='<div class="err">'+esc(d.error)+'</div>';}
    else{ out.innerHTML='<div class="q">'+esc(q)+'</div>'+(window.renderVerifyFull?window.renderVerifyFull(d):renderVerifyCompact(d)); }
  }catch(e){ out.innerHTML='<div class="err">'+esc(e.message||e)+'</div>'; }
  finally{ go.disabled=false; go.textContent='Verify'; out.setAttribute('aria-busy','false'); }
}
async function submitDemo(e){
  e.preventDefault();
  var f=e.target, msg=document.getElementById('dmsg'), btn=document.getElementById('dgo');
  var body={}; ['name','email','organization','role','company','use_case'].forEach(function(k){var el=f.querySelector('[name="'+k+'"]');body[k]=el?el.value:'';});
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)){msg.textContent='Please enter a valid work email.';document.getElementById('d-email').focus();return;}
  btn.disabled=true; msg.textContent='Sending…';
  try{var r=await fetch('/app/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});var d=await r.json();
    msg.textContent=d.ok?d.message:(d.error||'Something went wrong.'); if(d.ok) f.reset();
  }catch(err){msg.textContent='Network error — please try again.';}
  finally{btn.disabled=false;}
}
"""

_VERIFY_FULL_JS = r"""
window.renderVerifyFull=function(d){
  var base=renderVerifyCompact(d);
  var neu=d.neutral_evidence||[];
  var pr=d.retrieval||{};
  var pico=d.pico||{};
  var picoRow=function(k,v){return v&&v.value?('<div class="pill">'+k+': '+esc(v.value)+'</div>'):'';};
  var picoBlock='<div class="panel"><h3>Structured question (PICO)</h3><div class="chips">'+
    picoRow('Population',pico.population)+picoRow('Intervention',pico.intervention)+
    picoRow('Comparator',pico.comparator)+picoRow('Outcome',pico.outcome)+'</div>'+
    '<p class="muted" style="margin-top:8px;font-size:13px">Search: <code>'+esc(d.query||'')+'</code></p></div>';
  var prisma='<div class="panel"><h3>Retrieval (PRISMA)</h3><ul class="reasons">'+
    '<li>'+ (pr.identified||0) +' records identified across '+((pr.sources||[]).join(', ')||'sources')+'</li>'+
    '<li>'+ (pr.duplicates_removed||0) +' duplicates removed</li>'+
    '<li><strong>'+ (pr.screened||0) +'</strong> unique studies screened</li>'+
    ((pr.errors&&Object.keys(pr.errors).length)?('<li><span class="minus">−</span> source errors: '+esc(JSON.stringify(pr.errors))+'</li>'):'')+
    '</ul></div>';
  var forest=forestPlot(d);
  var trail='<div class="panel"><h3>Audit trail</h3><ol class="trail">'+
    (d.audit_trail||[]).map(function(s){return '<li><strong>'+esc(s.step.replace(/_/g,' '))+'</strong> — '+esc(String(s.detail||'').slice(0,140))+'</li>';}).join('')+'</ol></div>';
  var neutral = neu.length?('<div class="panel stance-col"><h3>Contextual / neutral ('+neu.length+')</h3>'+neu.map(studyCard).join('')+'</div>'):'';
  return base+picoBlock+forest+neutral+'<div class="cols"><div>'+prisma+'</div><div>'+trail+'</div></div>';
};
function forestPlot(d){
  var eff=[];(['supporting_evidence','contradicting_evidence']).forEach(function(k){(d[k]||[]).forEach(function(s){
    if(s.effect&&s.effect.ci_low!=null&&s.effect.ci_high!=null&&s.effect.kind==='ratio') eff.push({t:s.title,e:s.effect,st:s.stance});});});
  if(!eff.length) return '';
  var W=520,rowH=30,padL=8,padR=8,H=eff.length*rowH+34;
  var lo=Math.min.apply(null,eff.map(function(x){return x.e.ci_low;}).concat([0.5]));
  var hi=Math.max.apply(null,eff.map(function(x){return x.e.ci_high;}).concat([2]));
  var L=Math.log(lo),Hh=Math.log(hi);
  function X(v){return padL+(Math.log(v)-L)/(Hh-L)*(W-padL-padR);}
  var svg='<svg class="forest" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Forest plot of reported ratio effect estimates with 95% confidence intervals">';
  svg+='<line class="null" x1="'+X(1)+'" y1="6" x2="'+X(1)+'" y2="'+(H-24)+'"/>';
  svg+='<text x="'+X(1)+'" y="'+(H-8)+'" text-anchor="middle" font-size="11">no effect (1.0)</text>';
  eff.forEach(function(x,i){var y=18+i*rowH;var col=x.st==='supporting'?'var(--high)':'var(--vlow)';
    svg+='<line x1="'+X(x.e.ci_low)+'" y1="'+y+'" x2="'+X(x.e.ci_high)+'" y2="'+y+'" stroke="'+col+'" stroke-width="2"/>';
    svg+='<rect x="'+(X(x.e.value)-3)+'" y="'+(y-3)+'" width="6" height="6" fill="'+col+'"/>';
    svg+='<text x="'+(W-padR)+'" y="'+(y-6)+'" text-anchor="end" font-size="10">'+esc(x.e.metric)+' '+x.e.value+'</text>';});
  svg+='</svg>';
  var tbl='<table class="sr-only"><caption>Reported ratio effect estimates</caption><thead><tr><th>Study</th><th>Estimate</th><th>95% CI</th></tr></thead><tbody>'+
    eff.map(function(x){return '<tr><td>'+esc(x.t)+'</td><td>'+esc(x.e.metric)+' '+x.e.value+'</td><td>'+x.e.ci_low+'–'+x.e.ci_high+'</td></tr>';}).join('')+'</tbody></table>';
  return '<div class="panel"><h3>Forest plot — reported effects</h3>'+svg+tbl+'<p class="muted" style="font-size:12px">Only effect estimates reported verbatim with a confidence interval are plotted.</p></div>';
}
"""

_CONSOLE_JS = r"""
var STATE={claims:[],areas:[]};
(function(){ loadOverview(); loadClaims();
  ['f-q','f-status','f-strength','f-area'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',applyFilters);});
  document.getElementById('filters').addEventListener('submit',function(e){e.preventDefault();});
  document.getElementById('d-close').addEventListener('click',closeDrawer);
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!document.getElementById('detail').hidden)closeDrawer();});
  document.getElementById('detail').addEventListener('mousedown',function(e){if(e.target===this)closeDrawer();});
})();
var LAST_FOCUS=null;
async function loadOverview(){
  var d=await getJSON('/app/console/overview'); var s=d.stats||{};
  document.getElementById('ws-name').textContent='Evidence health · '+d.workspace;
  var tiles=[['Claims monitored',s.claims_monitored,''],['Strengthened',s.strengthened,'up'],
    ['Weakened',s.weakened,'down'],['Newly contradicted',s.newly_contradicted,'down'],
    ['New studies',s.new_studies,''],['Open alerts',s.open_alerts,'down']];
  document.getElementById('tiles').innerHTML=tiles.map(function(t){
    return '<div class="tile"><div class="k">'+esc(t[0])+'</div><div class="v '+(t[2]?'trend '+t[2]:'')+'">'+(t[1]||0)+'</div></div>';}).join('');
  document.getElementById('changes').innerHTML=(d.changes||[]).map(function(c){
    return '<li><div>'+esc(c.summary)+'</div><div class="meta">'+esc(c.change_type.replace(/_/g,' '))+' · '+esc((c.claim_text||'').slice(0,60))+'</div></li>';}).join('')||'<li class="muted">No recent changes.</li>';
  document.getElementById('alerts').innerHTML=(d.alerts||[]).map(function(a){
    return '<li>'+badge(a.level==='critical'?'unsupported':'moderate',a.level)+' <div style="margin-top:5px">'+esc(a.title)+'</div><div class="meta">'+esc(a.recommended_action||'')+'</div></li>';}).join('')||'<li class="muted">No open alerts.</li>';
}
async function loadClaims(){
  var d=await getJSON('/app/console/claims'); STATE.claims=d.claims||[]; STATE.areas=d.areas||[];
  var ss=[].concat.apply([],STATE.claims.map(function(c){return [c.status];})).filter(function(v,i,a){return a.indexOf(v)===i;});
  fill('f-status',ss.map(function(s){return [s,s.replace(/_/g,' ')];}));
  fill('f-strength',['high','moderate','low','very low','none'].map(function(s){return [s,s];}));
  fill('f-area',STATE.areas.map(function(s){return [s,s];}));
  renderClaims(STATE.claims);
}
function fill(id,pairs){var el=document.getElementById(id);pairs.forEach(function(p){var o=document.createElement('option');o.value=p[0];o.textContent=p[1];el.appendChild(o);});}
function applyFilters(){
  var q=document.getElementById('f-q').value.toLowerCase(), st=document.getElementById('f-status').value,
      str=document.getElementById('f-strength').value, ar=document.getElementById('f-area').value;
  renderClaims(STATE.claims.filter(function(c){
    return (!q||c.text.toLowerCase().indexOf(q)>=0)&&(!st||c.status===st)&&(!str||c.evidence_strength===str)&&(!ar||c.area===ar);}));
}
function renderClaims(list){
  var el=document.getElementById('claims');
  if(!list.length){el.innerHTML='<p class="muted">No claims match.</p>';return;}
  el.innerHTML=list.map(function(c){
    var tot=Math.max(1,c.supporting+c.contradicting);
    var bar='<span class="evbar" role="img" aria-label="'+c.supporting+' supporting, '+c.contradicting+' contradicting"><i class="sup" style="width:'+(c.supporting/tot*100)+'%"></i><i class="con" style="width:'+(c.contradicting/tot*100)+'%"></i></span>';
    var stkind=c.status==='supported'?'supported':(c.status==='contested'?'contested':(c.status==='unsupported'?'unsupported':'partial'));
    return '<button class="claimrow" data-id="'+c.id+'"><span class="ct">'+esc(c.text)+'<div class="meta">'+esc(c.area)+' · v'+c.version+'</div></span>'+
      '<span class="cmeta">'+bar+badge(c.evidence_strength,c.evidence_strength)+badge(stkind,c.status.replace(/_/g,' '))+trendEl(c.trend)+'</span></button>';
  }).join('');
  Array.prototype.forEach.call(el.querySelectorAll('.claimrow'),function(b){b.addEventListener('click',function(){openClaim(b.getAttribute('data-id'));});});
}
async function openClaim(id){
  var d=await getJSON('/app/console/claim?id='+id); if(d.error) return;
  var body=document.getElementById('d-body');
  var st=(d.status||'').replace(/_/g,' ');
  var stkind=d.status==='supported'?'supported':(d.status==='contested'?'contested':(d.status==='unsupported'?'unsupported':'partial'));
  var head='<h2 id="d-title">'+esc(d.text)+'</h2><div class="verdict" style="margin-top:10px">'+
    badge(stkind,st)+badge(d.evidence_strength,d.evidence_strength+' certainty')+trendEl(d.trend)+'</div>'+
    '<p class="summary">'+esc((d.assessment&&d.assessment.summary)||'')+'</p>';
  var tl='<div class="panel"><h3>Evidence timeline</h3>'+timeline(d.timeline)+'</div>';
  var sc=(d.supporting||[]).concat(d.contradicting||[]);
  var studies='<div class="panel"><h3>Supporting ('+(d.supporting||[]).length+')</h3>'+((d.supporting||[]).map(studyCard).join('')||'<p class="muted">None.</p>')+'</div>'+
    '<div class="panel"><h3>Contradicting ('+(d.contradicting||[]).length+')</h3>'+((d.contradicting||[]).map(studyCard).join('')||'<p class="muted">None.</p>')+'</div>';
  var reasons=reasonsPanel({assessment:d.assessment});
  body.innerHTML=head+tl+reasons+studies;
  LAST_FOCUS=document.activeElement;
  var dr=document.getElementById('detail'); dr.hidden=false; document.getElementById('d-close').focus();
}
function timeline(tl){
  if(!tl||!tl.length) return '<p class="muted">No history yet.</p>';
  var order={'very low':1,low:2,moderate:3,high:4,none:0};
  return '<div class="tl">'+tl.map(function(v){var w=(order[v.evidence_strength]||0)/4*100;
    var col=v.evidence_strength==='high'?'var(--high)':v.evidence_strength==='moderate'?'var(--moderate)':v.evidence_strength==='low'?'var(--low)':'var(--vlow)';
    return '<div class="row"><span class="pill">v'+v.version+'</span><span class="bar" style="width:'+Math.max(8,w)+'%;background:'+col+'"></span> '+badge(v.evidence_strength,v.evidence_strength)+' <span class="muted" style="font-size:12px">'+esc((v.status||'').replace(/_/g,' '))+' · '+(v.supporting)+'↑/'+(v.contradicting)+'↓</span></div>';
  }).join('')+'</div>';
}
function closeDrawer(){var dr=document.getElementById('detail'); if(dr) dr.hidden=true; if(LAST_FOCUS&&LAST_FOCUS.focus){LAST_FOCUS.focus();LAST_FOCUS=null;}}
"""

_DOCS_HTML = r"""
<section class="wrap band">
  <h1>Strata API</h1>
  <p class="muted">Evidence verification and change-monitoring as infrastructure. One call answers:
  <em>is this medical claim actually supported, by what, how strongly — and has it changed?</em></p>

  <h2 style="margin-top:26px">Authentication</h2>
  <p>Every request uses a secret key sent as a bearer token. Keys are shown once at creation; Strata
  stores only a hash. Rotate or revoke at any time.</p>
  <pre class="code">Authorization: Bearer sk_live_&lt;your-key&gt;</pre>
  <p class="muted">Generate a key from the CLI: <code>strata apikey create --org "Acme Pharma" --name "prod"</code></p>

  <h2 style="margin-top:26px">Verify a claim</h2>
  <pre class="code">curl https://your-strata-host/v1/verify \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "claim": "Treatment X reduces hospitalization in heart failure",
    "population": "Adults over 65"
  }'</pre>
  <p>Response (abbreviated):</p>
  <pre class="code">{
  "claim_status": "PARTIALLY_SUPPORTED",
  "evidence_strength": "MODERATE",
  "supporting_evidence": [ { "title": "...", "study_type": "Randomized controlled trial",
      "strength": "high", "effect": {"metric":"HR","value":0.83,"ci_low":0.72,"ci_high":0.95} } ],
  "contradicting_evidence": [ { "title": "...", "disagreement_label": "Genuine scientific disagreement" } ],
  "key_limitations": ["1 comparable-quality study(ies) contradict the claim"],
  "supporting_reasons": ["Strongest supporting evidence is a systematic review / meta-analysis"],
  "evidence_fingerprint": "0760a0aa83849ea1",
  "audit_trail": [ {"step":"structure_question"}, {"step":"retrieve"}, ... ],
  "basis": "abstract-level"
}</pre>

  <h2 style="margin-top:26px">Endpoints</h2>
  <table class="apitable">
    <thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead>
    <tbody>
      <tr><td>POST</td><td><code>/v1/verify</code></td><td>Verify a claim; full supporting/contradicting trail.</td></tr>
      <tr><td>POST</td><td><code>/v1/search</code></td><td>Raw multi-source literature search.</td></tr>
      <tr><td>POST</td><td><code>/v1/compare</code></td><td>Compare the evidence behind two claims or populations.</td></tr>
      <tr><td>POST</td><td><code>/v1/monitor</code></td><td>Register a claim for continuous monitoring.</td></tr>
      <tr><td>GET</td><td><code>/v1/claims/:id</code></td><td>A monitored claim: current state + version timeline.</td></tr>
      <tr><td>GET</td><td><code>/v1/changes</code></td><td>Recent evidence-change events for your organization.</td></tr>
    </tbody>
  </table>

  <h2 style="margin-top:26px">Monitor a claim (Python)</h2>
  <pre class="code">import requests
r = requests.post("https://your-strata-host/v1/monitor",
    headers={"Authorization": "Bearer sk_live_..."},
    json={"claim": "Drug X reduces hospitalization in heart failure",
          "frequency": "weekly",
          "alert_conditions": ["new_rct","new_meta_analysis","new_contradiction","strength_change"]})
print(r.json()["claim_id"])   # poll GET /v1/changes, or receive webhooks (roadmap)</pre>

  <h2 style="margin-top:26px">JavaScript</h2>
  <pre class="code">const res = await fetch("https://your-strata-host/v1/verify", {
  method: "POST",
  headers: { "Authorization": `Bearer ${process.env.STRATA_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ claim: "Statins reduce stroke risk in adults over 65" })
});
const { claim_status, evidence_strength, contradicting_evidence } = await res.json();</pre>

  <h2 style="margin-top:26px">Rate limits & errors</h2>
  <p>Each key has a per-minute limit; exceeding it returns <code>429</code>. Errors are JSON:
  <code>{ "error": { "code": "invalid_api_key", "message": "..." } }</code>. Verification never
  fabricates: if a source is unreachable it is reported in <code>retrieval.errors</code>, and an
  answer with no retrieved studies says so rather than inventing one.</p>
  <p class="muted">Assessments are abstract-level unless open-access full text is available, and are
  clearly labelled as such. Strata is decision support, not medical advice.</p>
</section>
<style>
.code{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow:auto;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ink);margin:8px 0 4px;white-space:pre}
.apitable{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}
.apitable th,.apitable td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
.apitable code{font-size:13px}
</style>
"""
