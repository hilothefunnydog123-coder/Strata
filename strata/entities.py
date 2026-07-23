"""The claim-centered data model — Strata's core object graph.

Everything in Strata revolves around a **Claim**: a first-class, versioned medical assertion
that lives inside an organization's evidence base and carries its own history.

    Organization
        -> Workspace
            -> Therapeutic Area
                -> Claim  (PICO, status, strength, alert rules, version)
                    -> Claim Version   (a graded state at a point in time)
                        -> Evidence     (the studies behind that state)
                    -> Evidence Change Event
                        -> Alert

This is what makes Strata *version control for medical knowledge* rather than a search box.
Every material change in the evidence behind a claim creates a new **version**; every version
diff is mined for **change events**; events that cross a claim's **alert rules** become
**alerts** an organization can act on. The accumulated per-claim history is the long-term
data asset — the graded evidence-change graph.

Persistence is the same dependency-free JSON store used everywhere else. A claim reuses the
Monitor store (so :mod:`strata.monitor` re-verifies it and appends graded snapshots), and this
module adds the enterprise structure on top: orgs, workspaces, areas, versioning, alert-rule
evaluation, webhook delivery, and the Console's Evidence-Health rollup. No patient data —
bibliographic metadata, grades, and receipts only.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import hmac
import json
import re
import urllib.request
from typing import Callable, Optional

from . import monitor, store, verify

# ------------------------------------------------------------------------- store kinds
_ORG, _WS, _AREA, _CLAIM, _ALERT, _HOOK = "orgs", "workspaces", "areas", "claims", "alerts", "webhooks"

_STRENGTH = {"none": 0, "very low": 1, "low": 2, "moderate": 3, "high": 4}
_CONFLICT = {"Mixed", "Contradicted"}

# the alert conditions a claim can watch for. All on by default.
ALERT_RULES = (
    "new_meta_analysis",   # a new systematic review / meta-analysis (evidence-pyramid level 1)
    "new_rct",             # a new randomized controlled trial (level 2)
    "new_contradiction",   # a new contradicting study, or contradicting evidence grows
    "strength_change",     # evidence strength moved up or down
    "status_change",       # claim status changed (e.g. Supported -> Mixed)
    "safety_signal",       # a new study flags harm / an adverse safety signal
    "effect_change",       # a representative effect estimate moved materially
)
_DEFAULT_RULES = {r: True for r in ALERT_RULES}

_SAFETY = re.compile(r"\b(harm|adverse|toxicit|serious adverse|safety signal|increased risk|"
                     r"mortality increased|hospitali[sz]ation increased|black box|withdrawn|"
                     r"contraindicat|fatal|death rate)\b", re.I)


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _slug(text: str, prefix: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return f"{prefix}-{s[:40] or 'x'}"


def _s_idx(strength: Optional[str]) -> int:
    return _STRENGTH.get(strength or "none", 0)


# ============================================================ organizations / workspaces
def create_org(name: str, *, plan: str = "trial", id: Optional[str] = None) -> dict:
    rec = {"id": id or _slug(name, "org"), "name": name, "plan": plan, "created": _now()}
    store.save_protocol(rec, kind=_ORG)
    return rec


def create_workspace(org_id: str, name: str, *, id: Optional[str] = None) -> dict:
    rec = {"id": id or _slug(name, "ws"), "org_id": org_id, "name": name, "created": _now()}
    store.save_protocol(rec, kind=_WS)
    return rec


def create_area(workspace_id: str, name: str, *, id: Optional[str] = None) -> dict:
    rec = {"id": id or _slug(name, "area"), "workspace_id": workspace_id, "name": name,
           "created": _now()}
    store.save_protocol(rec, kind=_AREA)
    return rec


def list_orgs() -> list:
    return [it["protocol"] for it in store.list_items(_ORG)]


def list_workspaces(org_id: Optional[str] = None) -> list:
    return [it["protocol"] for it in store.list_items(_WS)
            if org_id is None or it["protocol"].get("org_id") == org_id]


def list_areas(workspace_id: Optional[str] = None) -> list:
    return [it["protocol"] for it in store.list_items(_AREA)
            if workspace_id is None or it["protocol"].get("workspace_id") == workspace_id]


def _area_index() -> dict:
    return {a["id"]: a for a in list_areas()}


# ============================================================================== claims
def create_claim(text: str, *, workspace_id: Optional[str] = None, area_id: Optional[str] = None,
                 tenant: Optional[str] = None, pico: Optional[dict] = None,
                 alert_rules: Optional[dict] = None, priority: str = "normal",
                 id: Optional[str] = None, created: Optional[str] = None) -> dict:
    """Register a first-class, monitored Claim. Reuses the Monitor store so it can be
    re-verified and versioned; adds the enterprise structure (workspace, area, rules)."""
    cid = id or verify.receipt_id(text)
    rules = dict(_DEFAULT_RULES)
    if alert_rules:
        rules.update({k: bool(v) for k, v in alert_rules.items() if k in ALERT_RULES})
    proto = {"id": cid, "claim": text.strip(), "tenant": tenant,
             "workspace_id": workspace_id, "area_id": area_id,
             "pico": pico or {}, "alert_rules": rules, "priority": priority,
             "created": created or _now()}
    store.save_protocol(proto, kind=_CLAIM)
    return proto


def get_claim(claim_id: str) -> Optional[dict]:
    doc = store.get(claim_id, kind=_CLAIM)
    return doc["protocol"] if doc else None


def _snaps(claim_id: str) -> list:
    doc = store.get(claim_id, kind=_CLAIM)
    return doc.get("snapshots", []) if doc else []


def _versioned(snaps: list) -> list:
    """Attach a version number to each snapshot: v1 at baseline, +1 on each material change."""
    out, v = [], 1
    for i, s in enumerate(snaps):
        if i > 0 and s.get("evidence_changed"):
            v += 1
        out.append((v, s))
    return out


def claim_version(claim_id: str) -> int:
    vs = _versioned(_snaps(claim_id))
    return vs[-1][0] if vs else 0


# ------------------------------------------------------------------- verification / versioning
def recheck(claim_id: str, *, now: Optional[str] = None,
            _search: Optional[Callable] = None) -> dict:
    """Re-verify a claim against current literature, version it, and raise any alerts.

    The live enterprise path: appends a graded snapshot (a new claim version when the
    evidence materially changes), evaluates the claim's alert rules against the diff,
    persists any alerts, and delivers registered webhooks. Returns a full result dict.
    """
    doc = store.get(claim_id, kind=_CLAIM)
    if doc is None:
        raise KeyError(f"no such claim: {claim_id}")
    prev = store.latest(claim_id, kind=_CLAIM)
    kw = {"_search": _search} if _search is not None else {}
    rd, ch = monitor.check(claim_id, now=now, **kw)
    version = claim_version(claim_id)
    alerts = _raise_alerts(doc["protocol"], prev, rd, ch, version)
    _touch_claim(doc["protocol"], rd)
    return {"id": claim_id, "version": version, "receipt": rd, "change": ch,
            "alerts": alerts}


def backfill_alerts(claim_id: str) -> list:
    """Derive alerts from a claim's *stored* history without hitting the network — the
    offline/demo path. Idempotent: alert ids are deterministic, so re-running is safe."""
    snaps = _snaps(claim_id)
    proto = get_claim(claim_id) or {}
    raised = []
    versioned = _versioned(snaps)
    for i in range(1, len(versioned)):
        (version, cur), (_, prev) = versioned[i], versioned[i - 1]
        ch = cur.get("change") or {}
        raised += _raise_alerts(proto, prev, cur, ch, version, deliver=False)
    if snaps:
        _touch_claim(proto, snaps[-1])
    return raised


def _touch_claim(proto: dict, receipt: dict) -> None:
    """Cache the latest status/strength on the claim protocol for fast listing."""
    proto = dict(proto)
    proto["status"] = receipt.get("status")
    proto["strength"] = receipt.get("strength")
    proto["last_checked"] = receipt.get("checked")
    store.save_protocol(proto, kind=_CLAIM)


# ================================================================== alert-rule evaluation
def _fresh_studies(prev: Optional[dict], new: dict) -> list:
    old_ids = {(c.get("pmid") or c.get("doi")) for c in (prev or {}).get("citations", [])}
    return [c for c in new.get("citations", []) if (c.get("pmid") or c.get("doi")) not in old_ids]


def _rep_effect(receipt: dict) -> Optional[dict]:
    """A representative pooled effect for the claim: prefer a significant estimate from the
    strongest design, else the first significant estimate."""
    effs = receipt.get("effect_estimates") or []
    sig = [e for e in effs if e.get("significant") and e.get("value") is not None]
    if not sig:
        return None
    return sorted(sig, key=lambda e: (0 if (e.get("label", "").lower().startswith("systematic")) else 1))[0]


def evaluate_alerts(proto: dict, prev: Optional[dict], new: dict, change: dict) -> list:
    """Pure evaluation: given a claim, its previous and new receipts, and the diff, return the
    alert dicts its rules call for. No persistence — :func:`_raise_alerts` stores them."""
    rules = proto.get("alert_rules") or _DEFAULT_RULES
    if not prev or (change or {}).get("first_check"):
        return []
    out: list[dict] = []

    def on(rule):
        return rules.get(rule, True)

    fresh = _fresh_studies(prev, new)
    for c in fresh:
        lvl, stance = c.get("level"), c.get("stance")
        ev = {"pmid": c.get("pmid"), "title": c.get("title"), "url": c.get("url"),
              "label": c.get("label"), "year": c.get("year")}
        text = f"{c.get('title', '')}. {c.get('snippet', '')}"
        if _SAFETY.search(text) and on("safety_signal"):
            out.append(_mk(proto, "safety_signal", "red",
                           "New safety signal detected",
                           f"A new {c.get('label', 'study')} flags a possible harm or safety concern.", ev))
        elif lvl == 1 and on("new_meta_analysis"):
            out.append(_mk(proto, "new_meta_analysis", "green" if stance == "support" else "amber",
                           "New meta-analysis",
                           f"A new systematic review/meta-analysis ({c.get('year') or 'n.d.'}) "
                           f"{'supports' if stance == 'support' else 'bears on'} this claim.", ev))
        elif lvl == 2 and on("new_rct"):
            out.append(_mk(proto, "new_rct", "green" if stance == "support" else "amber",
                           "New randomized trial",
                           f"A new RCT ({c.get('year') or 'n.d.'}) "
                           f"{'supports' if stance == 'support' else 'contradicts' if stance == 'contradict' else 'is relevant to'} this claim.", ev))
        if stance == "contradict" and lvl not in (1, 2) and on("new_contradiction"):
            out.append(_mk(proto, "new_contradiction", "amber", "New contradicting study",
                           f"A new {c.get('label', 'study')} runs against this claim.", ev))

    # strength movement
    o_s, n_s = prev.get("strength"), new.get("strength")
    if on("strength_change") and o_s != n_s and o_s in _STRENGTH and n_s in _STRENGTH:
        up = _s_idx(n_s) > _s_idx(o_s)
        out.append(_mk(proto, "strength_change", "green" if up else "red",
                       f"Evidence strength {'upgraded' if up else 'downgraded'}: {o_s} -> {n_s}",
                       "The weight of evidence behind this claim moved.", None))

    # status transition
    o_st, n_st = prev.get("status"), new.get("status")
    if on("status_change") and o_st != n_st:
        into_conflict = n_st in _CONFLICT and o_st not in _CONFLICT
        sev = "red" if n_st == "Contradicted" else "amber" if into_conflict else "green"
        out.append(_mk(proto, "status_change", sev,
                       f"Status changed: {o_st} -> {n_st}",
                       "Review affected materials — the claim's overall standing shifted.", None))

    # representative effect drift
    if on("effect_change"):
        pe, ne = _rep_effect(prev), _rep_effect(new)
        if pe and ne and pe.get("measure") == ne.get("measure") and pe.get("value"):
            drift = abs(ne["value"] - pe["value"]) / abs(pe["value"])
            if drift >= 0.15:
                out.append(_mk(proto, "effect_change", "amber",
                               f"Effect estimate moved: {pe['measure']} {pe['value']:.2f} -> {ne['value']:.2f}",
                               "A representative pooled effect shifted materially between checks.", None))
    return out


def _mk(proto: dict, type_: str, severity: str, headline: str, detail: str,
        evidence: Optional[dict]) -> dict:
    cid = proto["id"]
    version = claim_version(cid)
    ev_key = (evidence or {}).get("pmid") or (evidence or {}).get("title") or ""
    aid = "alt_" + hashlib.sha256(f"{cid}:{version}:{type_}:{ev_key}".encode()).hexdigest()[:12]
    return {"id": aid, "claim_id": cid, "claim": proto.get("claim"),
            "workspace_id": proto.get("workspace_id"), "area_id": proto.get("area_id"),
            "type": type_, "severity": severity, "headline": headline, "detail": detail,
            "evidence": evidence, "version": version, "created": _now(), "acknowledged": False}


def _raise_alerts(proto, prev, new, change, version, *, deliver: bool = True) -> list:
    alerts = evaluate_alerts(proto, prev, new, change)
    for a in alerts:
        a["version"] = version
        existing = store.get(a["id"], kind=_ALERT)
        if existing:                              # keep first-seen timestamp; idempotent
            a["created"] = existing["protocol"].get("created", a["created"])
            a["acknowledged"] = existing["protocol"].get("acknowledged", False)
        store.save_protocol(a, kind=_ALERT)
    if deliver and alerts:
        _deliver_webhooks(proto, alerts)
    return alerts


def acknowledge_alert(alert_id: str) -> bool:
    doc = store.get(alert_id, kind=_ALERT)
    if not doc:
        return False
    doc["protocol"]["acknowledged"] = True
    store.save_protocol(doc["protocol"], kind=_ALERT)
    return True


def list_alerts(*, workspace_id: Optional[str] = None, claim_id: Optional[str] = None,
                unacknowledged: bool = False, limit: int = 100) -> list:
    rows = [it["protocol"] for it in store.list_items(_ALERT)]
    if workspace_id:
        rows = [a for a in rows if a.get("workspace_id") == workspace_id]
    if claim_id:
        rows = [a for a in rows if a.get("claim_id") == claim_id]
    if unacknowledged:
        rows = [a for a in rows if not a.get("acknowledged")]
    rows.sort(key=lambda a: a.get("created") or "", reverse=True)
    return rows[:limit]


# =================================================================== webhooks (delivery)
def register_webhook(url: str, *, workspace_id: Optional[str] = None,
                     secret: Optional[str] = None, id: Optional[str] = None) -> dict:
    import secrets as _secrets
    rec = {"id": id or ("wh_" + _secrets.token_hex(6)), "url": url,
           "workspace_id": workspace_id, "secret": secret or ("whsec_" + _secrets.token_hex(16)),
           "active": True, "created": _now()}
    store.save_protocol(rec, kind=_HOOK)
    return {k: rec[k] for k in ("id", "url", "workspace_id", "secret", "active", "created")}


def list_webhooks(workspace_id: Optional[str] = None) -> list:
    rows = [it["protocol"] for it in store.list_items(_HOOK)]
    rows = [w for w in rows if w.get("active") and
            (workspace_id is None or w.get("workspace_id") in (None, workspace_id))]
    return [{k: w.get(k) for k in ("id", "url", "workspace_id", "active", "created")} for w in rows]


def _deliver_webhooks(proto: dict, alerts: list, *, _post: Optional[Callable] = None) -> int:
    hooks = [it["protocol"] for it in store.list_items(_HOOK) if it["protocol"].get("active")]
    ws = proto.get("workspace_id")
    sent = 0
    for h in hooks:
        if h.get("workspace_id") not in (None, ws):
            continue
        payload = {"type": "evidence.changed", "claim_id": proto["id"],
                   "claim": proto.get("claim"), "alerts": alerts, "at": _now()}
        body = json.dumps(payload).encode()
        sig = hmac.new((h.get("secret") or "").encode(), body, hashlib.sha256).hexdigest()
        headers = {"Content-Type": "application/json", "X-Strata-Signature": "sha256=" + sig,
                   "User-Agent": "Strata-Webhooks/1"}
        try:
            if _post is not None:
                _post(h["url"], headers, payload)
            else:
                req = urllib.request.Request(h["url"], data=body, headers=headers, method="POST")
                urllib.request.urlopen(req, timeout=8).read()
            sent += 1
        except Exception:
            continue                              # fail soft; a dead endpoint never blocks a check
    return sent


# ================================================================= claim detail & rollups
def claim_detail(claim_id: str) -> Optional[dict]:
    """Everything the Console renders for one claim: protocol, the version timeline, the
    latest receipt, the change feed, and open alerts."""
    doc = store.get(claim_id, kind=_CLAIM)
    if doc is None:
        return None
    proto = doc["protocol"]
    snaps = doc.get("snapshots", [])
    versioned = _versioned(snaps)
    timeline = [{"version": v, "checked": s.get("checked"), "status": s.get("status"),
                 "strength": s.get("strength"), "supporting": s.get("supporting"),
                 "contradicting": s.get("contradicting"),
                 "changed": bool(s.get("evidence_changed")),
                 "headline": (s.get("change") or {}).get("headline")}
                for v, s in versioned]
    cur = snaps[-1] if snaps else None
    area = _area_index().get(proto.get("area_id"))
    return {"claim": {**proto, "version": versioned[-1][0] if versioned else 0,
                      "area": area["name"] if area else None},
            "receipt": cur, "timeline": timeline,
            "change": cur.get("change") if cur else None,
            "alerts": list_alerts(claim_id=claim_id)}


def _claim_row(doc: dict, areas: dict) -> dict:
    proto, snaps = doc["protocol"], doc.get("snapshots", [])
    versioned = _versioned(snaps)
    cur = snaps[-1] if snaps else None
    prev = snaps[-2] if len(snaps) >= 2 else None
    trend = "flat"
    if cur and prev:
        d = _s_idx(cur.get("strength")) - _s_idx(prev.get("strength"))
        trend = "up" if d > 0 else "down" if d < 0 else "flat"
    area = areas.get(proto.get("area_id"))
    open_alerts = [a for a in list_alerts(claim_id=proto["id"]) if not a.get("acknowledged")]
    return {
        "id": proto["id"], "claim": proto.get("claim"), "tenant": proto.get("tenant"),
        "workspace_id": proto.get("workspace_id"), "area_id": proto.get("area_id"),
        "area": area["name"] if area else None, "priority": proto.get("priority", "normal"),
        "version": versioned[-1][0] if versioned else 0,
        "status": cur.get("status") if cur else None,
        "strength": cur.get("strength") if cur else None,
        "supporting": cur.get("supporting") if cur else None,
        "contradicting": cur.get("contradicting") if cur else None,
        "confidence": cur.get("confidence") if cur else None,
        "trend": trend, "evidence_changed": bool(cur.get("evidence_changed")) if cur else False,
        "last_checked": cur.get("checked") if cur else None, "checks": len(snaps),
        "open_alerts": len(open_alerts),
        "top_severity": _top_sev(open_alerts),
    }


def _top_sev(alerts: list) -> Optional[str]:
    order = {"red": 3, "amber": 2, "green": 1}
    best = None
    for a in alerts:
        if best is None or order.get(a.get("severity"), 0) > order.get(best, 0):
            best = a.get("severity")
    return best


def list_claims(*, workspace_id: Optional[str] = None, area_id: Optional[str] = None) -> list:
    areas = _area_index()
    rows = []
    for it in store.list_items(_CLAIM):
        p = it["protocol"]
        if workspace_id and p.get("workspace_id") != workspace_id:
            continue
        if area_id and p.get("area_id") != area_id:
            continue
        rows.append(_claim_row(it, areas))
    rows.sort(key=lambda r: r.get("last_checked") or "", reverse=True)
    return rows


def console_summary(*, workspace_id: Optional[str] = None) -> dict:
    """The Evidence-Health rollup: the answer to *what changed in our evidence base?*"""
    claims = list_claims(workspace_id=workspace_id)
    strengthened = weakened = newly_contradicted = new_studies = 0
    by_area: dict = {}
    by_status: dict = {}
    areas = _area_index()
    for r in claims:
        doc = store.get(r["id"], kind=_CLAIM)
        snaps = doc.get("snapshots", []) if doc else []
        cur = snaps[-1] if snaps else None
        prev = snaps[-2] if len(snaps) >= 2 else None
        if cur and prev:
            d = _s_idx(cur.get("strength")) - _s_idx(prev.get("strength"))
            if d > 0:
                strengthened += 1
            elif d < 0:
                weakened += 1
            if cur.get("status") in _CONFLICT and prev.get("status") not in _CONFLICT:
                newly_contradicted += 1
            new_studies += len(_fresh_studies(prev, cur))
        st = r.get("status") or "Unchecked"
        by_status[st] = by_status.get(st, 0) + 1
        aid = r.get("area_id")
        a = by_area.setdefault(aid or "_none", {"area_id": aid,
                                                "name": (areas.get(aid) or {}).get("name") if aid else "Unassigned",
                                                "claims": 0, "changed": 0, "weakened": 0, "alerts": 0})
        a["claims"] += 1
        a["changed"] += 1 if r.get("evidence_changed") else 0
        a["weakened"] += 1 if r.get("trend") == "down" else 0
        a["alerts"] += r.get("open_alerts", 0)
    alerts = list_alerts(workspace_id=workspace_id, limit=200)
    return {
        "claims_monitored": len(claims),
        "strengthened": strengthened, "weakened": weakened,
        "newly_contradicted": newly_contradicted, "new_studies": new_studies,
        "open_alerts": sum(1 for a in alerts if not a.get("acknowledged")),
        "by_area": sorted(by_area.values(), key=lambda a: -a["claims"]),
        "by_status": by_status,
        "attention": _attention(claims),
        "recent_alerts": alerts[:12],
    }


def _attention(claims: list) -> list:
    """Claims that most need a human, worst first: red alerts, then weakening, then conflict."""
    sev = {"red": 3, "amber": 2, "green": 1, None: 0}

    def score(r):
        return (sev.get(r.get("top_severity"), 0) * 10 + r.get("open_alerts", 0)
                + (3 if r.get("trend") == "down" else 0)
                + (2 if r.get("status") in _CONFLICT else 0))
    ranked = sorted(claims, key=score, reverse=True)
    return [r for r in ranked if score(r) > 0][:8]


def changes_feed(*, workspace_id: Optional[str] = None, limit: int = 50) -> list:
    """A flat, newest-first feed of alerts across the whole evidence base."""
    return list_alerts(workspace_id=workspace_id, limit=limit)
