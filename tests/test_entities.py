"""Tests for the claim-centered data model + evidence-change/alert engine.
Run: python tests/test_entities.py  (fully offline)
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["STRATA_HOME"] = tempfile.mkdtemp(prefix="strata-ent-")
for k in ("STRATA_LLM_KEY", "GROQ_API_KEY"):
    os.environ.pop(k, None)

from strata import entities, demo                                 # noqa: E402
from strata.pubmed import Article                                 # noqa: E402


def _art(pmid, title, pt, ab, yr, cb=0):
    return Article(pmid, title, ab, "J", yr, ["S"], pt, cited_by=cb)


BASE = [
    _art("1", "Meta-analysis: drug X reduces mortality", ["Meta-Analysis"],
         "Across trials (n=20,000), HR 0.82 (95% CI 0.74 to 0.91).", 2020, 300),
    _art("2", "RCT of drug X", ["Randomized Controlled Trial"],
         "HR 0.79 (95% CI 0.66 to 0.95).", 2021, 150),
]
# a later check: a fresh RCT + a fresh contradicting cohort arrives
LATER = BASE + [
    _art("3", "New randomized trial of drug X", ["Randomized Controlled Trial"],
         "In 5,000 patients, HR 0.80 (95% CI 0.70 to 0.92).", 2024, 40),
    _art("4", "Drug X and harm: a large cohort", ["Observational Study"],
         "Drug X was associated with increased risk of adverse events (HR 1.35, 95% CI 1.10 to 1.60).", 2024, 20),
]


def test_hierarchy_and_claim_creation():
    org = entities.create_org("Acme Pharma", id="org-acme")
    ws = entities.create_workspace(org["id"], "Cardio", id="ws-acme")
    area = entities.create_area(ws["id"], "Cardiology", id="area-c")
    c = entities.create_claim("Drug X reduces mortality", workspace_id=ws["id"],
                              area_id=area["id"], priority="high", id="clm-x")
    assert c["workspace_id"] == "ws-acme" and c["area_id"] == "area-c"
    assert set(c["alert_rules"]) == set(entities.ALERT_RULES)
    assert entities.get_claim("clm-x")["claim"] == "Drug X reduces mortality"
    assert [a["name"] for a in entities.list_areas("ws-acme")] == ["Cardiology"]
    print("ok  org -> workspace -> area -> claim graph persists")


def test_recheck_versions_and_alerts():
    entities.create_claim("Drug X reduces mortality", workspace_id="ws-acme",
                          area_id="area-c", id="clm-ver")
    r1 = entities.recheck("clm-ver", now="2026-01-01T00:00:00+00:00",
                          _search=lambda q, retmax=40: BASE)
    assert r1["version"] == 1 and r1["change"]["first_check"] is True and r1["alerts"] == []
    r2 = entities.recheck("clm-ver", now="2026-02-01T00:00:00+00:00",
                          _search=lambda q, retmax=40: LATER)
    assert r2["version"] == 2, r2["version"]                       # material change -> new version
    types = {a["type"] for a in r2["alerts"]}
    assert "new_rct" in types                                     # study 3 is a fresh RCT
    assert ("new_contradiction" in types) or ("safety_signal" in types)  # study 4 is a fresh harm cohort
    assert any(a["severity"] == "amber" or a["severity"] == "red" for a in r2["alerts"])
    print(f"ok  recheck bumps version on material change and raises {sorted(types)}")


def test_evaluate_alerts_strength_and_status():
    proto = {"id": "clm-eval", "claim": "Drug X reduces mortality",
             "alert_rules": {r: True for r in entities.ALERT_RULES}}
    prev = {"strength": "moderate", "status": "Supported", "citations": [], "effect_estimates": []}
    new = {"strength": "high", "status": "Supported", "citations": [], "effect_estimates": []}
    alerts = entities.evaluate_alerts(proto, prev, new, {"first_check": False})
    assert any(a["type"] == "strength_change" and a["severity"] == "green" for a in alerts)
    # a downgrade into conflict
    new2 = {"strength": "low", "status": "Contradicted", "citations": [], "effect_estimates": []}
    alerts2 = entities.evaluate_alerts(proto, prev, new2, {"first_check": False})
    kinds = {(a["type"], a["severity"]) for a in alerts2}
    assert ("strength_change", "red") in kinds and ("status_change", "red") in kinds
    print("ok  strength upgrade -> green, downgrade + Contradicted -> red alerts")


def test_alert_rules_can_be_disabled():
    entities.create_claim("Drug Y reduces stroke", workspace_id="ws-acme", area_id="area-c",
                          alert_rules={"new_rct": False}, id="clm-mute")
    proto = entities.get_claim("clm-mute")
    assert proto["alert_rules"]["new_rct"] is False
    alerts = entities.evaluate_alerts(
        proto, {"citations": [], "strength": "moderate", "status": "Supported", "effect_estimates": []},
        {"citations": [{"pmid": "z", "level": 2, "stance": "support", "label": "RCT", "title": "New RCT"}],
         "strength": "moderate", "status": "Supported", "effect_estimates": []},
        {"first_check": False})
    assert not any(a["type"] == "new_rct" for a in alerts)         # muted
    print("ok  a disabled alert rule suppresses its alerts")


def test_webhook_delivery_signs_payload():
    entities.register_webhook("https://example.test/hook", workspace_id="ws-acme",
                              secret="whsec_test", id="wh-1")
    captured = {}

    def fake_post(url, headers, payload):
        captured["url"] = url
        captured["sig"] = headers.get("X-Strata-Signature")
        captured["payload"] = payload
    proto = entities.get_claim("clm-x")
    sent = entities._deliver_webhooks(proto, [{"type": "new_rct", "severity": "green"}], _post=fake_post)
    assert sent == 1 and captured["url"] == "https://example.test/hook"
    assert captured["sig"].startswith("sha256=") and captured["payload"]["claim_id"] == "clm-x"
    print("ok  webhooks deliver a signed evidence.changed payload")


def test_console_summary_from_demo():
    demo.seed_all(force=True)
    s = entities.console_summary(workspace_id=demo._WS_ID)
    assert s["claims_monitored"] == 4
    assert s["strengthened"] >= 1 and s["new_studies"] >= 1
    assert s["open_alerts"] >= 1
    assert sum(a["claims"] for a in s["by_area"]) == 4
    feed = entities.changes_feed(workspace_id=demo._WS_ID)
    assert feed and all("severity" in a for a in feed)
    d = entities.claim_detail("clm-metformin-cvd")
    assert d["claim"]["area"] == "Endocrinology & Metabolism"
    assert d["claim"]["version"] >= 1 and len(d["timeline"]) == 2
    print("ok  Evidence-Health rollup, changes feed, and claim timeline from seeded demo")


if __name__ == "__main__":
    # ordered: hierarchy first (creates shared org/ws), then the rest
    for name in ["test_hierarchy_and_claim_creation", "test_recheck_versions_and_alerts",
                 "test_evaluate_alerts_strength_and_status", "test_alert_rules_can_be_disabled",
                 "test_webhook_delivery_signs_payload", "test_console_summary_from_demo"]:
        globals()[name]()
    print("\nall entities tests passed")
