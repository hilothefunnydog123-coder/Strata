"""Tests for the enterprise HTTP API (claims / changes / evidence / alerts / webhooks).
Runs a real server on an ephemeral localhost port, fully offline (seeded demo data).
Run: python tests/test_api.py
"""
import json
import os
import sys
import tempfile
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["STRATA_HOME"] = tempfile.mkdtemp(prefix="strata-api-")
for k in ("STRATA_LLM_KEY", "GROQ_API_KEY", "STRATA_API_KEYS"):
    os.environ.pop(k, None)

from http.server import ThreadingHTTPServer                        # noqa: E402
from strata import server, demo                                   # noqa: E402

_PORT = 8791
_BASE = f"http://127.0.0.1:{_PORT}"


def _read(req):
    try:
        return json.loads(urllib.request.urlopen(req, timeout=20).read())
    except urllib.error.HTTPError as e:          # 4xx bodies carry the JSON error we assert on
        return json.loads(e.read())


def _get(path):
    return _read(urllib.request.Request(_BASE + path))


def _post(path, body):
    return _read(urllib.request.Request(_BASE + path, data=json.dumps(body).encode(),
                                        headers={"Content-Type": "application/json"}, method="POST"))


def _boot():
    demo.seed_all(force=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", _PORT), server._handler())
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.5)
    return httpd


def test_console_summary_and_changes():
    s = _get("/v1/console/summary")
    assert s["claims_monitored"] == 7 and s["strengthened"] >= 1
    assert "by_area" in s and sum(a["claims"] for a in s["by_area"]) == 7
    ch = _get("/v1/changes?limit=5")["changes"]
    assert ch and all("severity" in c and "headline" in c for c in ch)
    print("ok  GET /v1/console/summary + /v1/changes return the Evidence-Health rollup")


def test_claims_list_detail_history():
    cl = _get("/v1/claims")["claims"]
    assert len(cl) == 7 and all("version" in c and "area" in c for c in cl)
    d = _get("/v1/claims/clm-metformin-cvd")
    assert d["claim"]["area"] == "Endocrinology & Metabolism"
    assert len(d["timeline"]) == 2 and "receipt" in d
    h = _get("/v1/claims/clm-metformin-cvd/history")
    assert [t["version"] for t in h["timeline"]] == [1, 2]
    assert _get("/v1/claims/does-not-exist").get("error")
    print("ok  GET /v1/claims (list, detail, history) + 404 on unknown id")


def test_create_claim_and_recheck():
    # a seeded claim text resolves offline, so creating it runs a real baseline verification
    out = _post("/v1/claims", {"claim": "SGLT2 inhibitors reduce heart-failure hospitalization",
                               "area_id": "area-cardiology", "workspace_id": "ws-meridian",
                               "alert_rules": {"safety_signal": False}})
    cid = out["id"]
    assert out["receipt"]["status"] in ("Supported", "Mixed", "Partially_Supported", "PARTIALLY_SUPPORTED", "Insufficient")
    assert entitiesget(cid)["alert_rules"]["safety_signal"] is False
    r = _post(f"/v1/claims/{cid}/recheck", {})
    assert "version" in r and "receipt" in r
    print("ok  POST /v1/claims creates + verifies; /recheck re-versions")


def entitiesget(cid):
    from strata import entities
    return entities.get_claim(cid)


def test_evidence_lookup_and_webhooks():
    ev = _get("/v1/evidence/40022006")            # a metformin RCT cited by >=1 monitored claim
    citing = {c["claim_id"] for c in ev.get("cited_by_claims", [])}
    assert "clm-metformin-cvd" in citing           # resolves the study across the claims citing it
    assert _get("/v1/evidence/nonexistent-pmid").get("error")
    wh = _post("/v1/webhooks", {"url": "https://example.test/strata"})
    assert wh["id"].startswith("wh_") and wh["secret"].startswith("whsec_")
    assert any(w["url"] == "https://example.test/strata" for w in _get("/v1/webhooks")["webhooks"])
    bad = _post("/v1/webhooks", {"url": "not-a-url"})
    assert bad.get("error")
    print("ok  GET /v1/evidence/:id resolves across claims; webhooks register + validate")


def test_alerts_and_ack():
    alerts = _get("/v1/alerts")["alerts"]
    assert alerts, "expected backfilled alerts"
    aid = alerts[0]["id"]
    assert _post(f"/v1/alerts/{aid}/ack", {})["acknowledged"] is True
    print("ok  GET /v1/alerts + POST /v1/alerts/:id/ack")


if __name__ == "__main__":
    _boot()
    for name in ["test_console_summary_and_changes", "test_claims_list_detail_history",
                 "test_create_claim_and_recheck", "test_evidence_lookup_and_webhooks",
                 "test_alerts_and_ack"]:
        globals()[name]()
    print("\nall api tests passed")
