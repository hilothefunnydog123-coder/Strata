"""Tests for the claim store and the evidence-change engine.

Run: python tests/test_monitoring.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strata.pubmed import Article                                    # noqa: E402
from strata.sources import RetrievalResult                           # noqa: E402
from strata.verify import verify                                     # noqa: E402
from strata.db import Database                                       # noqa: E402
from strata.claims import create_claim_from_question, ingest         # noqa: E402
from strata.monitor import run_monitor, create_monitor               # noqa: E402


def _art(pmid, title, abstract, ptypes, year, doi):
    return Article(pmid, title, abstract, "J", year, ["Au"], ptypes, doi=doi, source="pubmed")


def _ret(arts):
    return lambda q, retmax, sources=None: RetrievalResult(
        articles=arts, per_source={"pubmed": len(arts)}, retrieved_total=len(arts),
        unique=len(arts), sources_used=["pubmed"])


BASE = [
    _art("1", "Treatment X reduces hospitalization: meta-analysis of RCTs",
         "In 18 trials (n=24,500) of adults over 65, Treatment X reduced hospitalization "
         "(RR 0.79, 95% CI 0.71 to 0.88).", ["Meta-Analysis"], 2021, "10/m"),
    _art("2", "RCT of Treatment X in older heart failure patients",
         "Among 4,200 patients aged 65 to 88, Treatment X reduced hospitalization (HR 0.83, "
         "95% CI 0.72 to 0.95).", ["Randomized Controlled Trial"], 2022, "10/r1"),
]
NEW_NULL = _art("9", "Large trial: Treatment X finds no reduction in hospitalization",
                "In 8,000 patients over 65, Treatment X did not reduce hospitalization "
                "(HR 0.98, 95% CI 0.90 to 1.07).", ["Randomized Controlled Trial"], 2025, "10/null")

Q = "Does Treatment X reduce hospitalization in elderly patients with heart failure?"


def _fresh():
    db = Database(":memory:")
    ws = db.get_or_create_workspace(db.get_or_create_org("Acme"), "Cardio")
    cid = create_claim_from_question(db, ws, Q, therapeutic_area="Heart Failure")
    return db, ws, cid


def test_baseline_then_change():
    db, ws, cid = _fresh()
    v1 = verify(Q, current_year=2026, retrieve_fn=_ret(BASE))
    r1 = ingest(db, cid, v1)
    assert r1["version"] == 1 and r1["baseline"] is True
    assert db.get_claim(cid)["evidence_strength"] == "high"

    v2 = verify(Q, current_year=2026, retrieve_fn=_ret(BASE + [NEW_NULL]))
    r2 = ingest(db, cid, v2)
    assert r2["version"] == 2 and r2["material"] is True
    assert r2["trend"] == "weakening"
    claim = db.get_claim(cid)
    assert claim["evidence_strength"] == "moderate"          # weakened
    assert claim["status"] == "partially_supported"
    types = {c["change_type"] for c in db.list_changes(ws)}
    assert {"new_rct", "new_contradiction", "strength_change"} <= types
    assert db.list_alerts(ws, status="new")                  # alerts raised
    assert len(db.claim_timeline(cid)) == 2                  # versioned
    print("ok  baseline → new null RCT → weakened, versioned, alerted")


def test_no_change_is_idempotent():
    db, ws, cid = _fresh()
    v1 = verify(Q, current_year=2026, retrieve_fn=_ret(BASE))
    ingest(db, cid, v1)
    v2 = verify(Q, current_year=2026, retrieve_fn=_ret(BASE))     # identical evidence
    r2 = ingest(db, cid, v2)
    assert r2["material"] is False and r2["version"] == 1
    assert len(db.claim_timeline(cid)) == 1                       # no new version
    print("ok  re-verifying identical evidence creates no new version or alert")


def test_run_monitor_end_to_end():
    db, ws, cid = _fresh()
    create_monitor(db, cid, frequency="weekly")
    # first run: baseline
    r1 = run_monitor(db, cid, verify_fn=lambda q, **kw: verify(
        q, current_year=2026, retrieve_fn=_ret(BASE),
        **{k: v for k, v in kw.items() if k in ("claim_population",)}))
    assert r1["version"] == 1
    # second run: new evidence
    r2 = run_monitor(db, cid, verify_fn=lambda q, **kw: verify(
        q, current_year=2026, retrieve_fn=_ret(BASE + [NEW_NULL]),
        **{k: v for k, v in kw.items() if k in ("claim_population",)}))
    assert r2["version"] == 2 and r2["material"] is True
    mon = db.get_monitor(cid)
    assert mon["last_run_at"] and mon["next_run_at"]              # scheduled forward
    print("ok  run_monitor verifies, ingests, alerts, and reschedules")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nall monitoring tests passed")
