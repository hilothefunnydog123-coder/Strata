"""Tests for Strata Verify + Monitor. Run: python tests/test_verify.py

Fully offline: PubMed is injected and the JSON store is redirected to a temp dir. Covers
claim-direction detection, study stance classification, status/strength aggregation, the
receipt + Seal, and the Monitor change feed (upgrade, new study, conflict).
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["STRATA_HOME"] = tempfile.mkdtemp(prefix="strata-verify-")

from strata.pubmed import Article                                   # noqa: E402
from strata import verify, monitor, demo                            # noqa: E402
from strata.receipt import Receipt, seal_svg, render_terminal       # noqa: E402


def _art(pmid, title, ptypes, abstract="", year=2023):
    return Article(pmid, title, abstract, "J Test", year, ["Smith J", "Doe A"], ptypes)


SUPPORT = [
    _art("1", "Drug X reduces mortality: a meta-analysis", ["Meta-Analysis"],
         "Across 20 trials, the hazard ratio was 0.82 (95% CI 0.74 to 0.91).", 2022),
    _art("2", "Drug X versus placebo: a randomized trial", ["Randomized Controlled Trial"],
         "Among 3,000 patients the hazard ratio was 0.79 (95% CI 0.66 to 0.95).", 2021),
    _art("3", "Drug X and outcomes: a cohort", ["Observational Study"],
         "Adjusted hazard ratio 0.88 (95% CI 0.80 to 0.97).", 2020),
]
CONFLICT = SUPPORT + [
    _art("4", "Drug X increases harm: a large cohort", ["Observational Study"],
         "Drug X was associated with higher mortality (hazard ratio 1.30, 95% CI 1.10 to 1.54).", 2024),
    _art("5", "Drug X shows no benefit: a randomized trial", ["Randomized Controlled Trial"],
         "No significant difference was seen (hazard ratio 1.01, 95% CI 0.88 to 1.16).", 2023),
    _art("6", "Drug X harm confirmed: a second cohort", ["Observational Study"],
         "Associated with increased events (risk ratio 1.4, 95% CI 1.15 to 1.70).", 2023),
    _art("7", "Drug X worsens outcomes: cohort", ["Observational Study"],
         "Higher risk observed (hazard ratio 1.5, 95% CI 1.2 to 1.9).", 2022),
]


def test_claim_direction_and_stance():
    assert verify._claim_direction("Drug X reduces mortality") == "down"
    assert verify._claim_direction("Drug X increases risk of stroke") == "up"
    red = {"direction": "reduction", "significant": True, "value": 0.8}
    inc = {"direction": "increase", "significant": True, "value": 1.3}
    null = {"direction": "null", "significant": False, "value": 1.0}
    assert verify._stance(red, "down", "") == "support"
    assert verify._stance(inc, "down", "") == "contradict"
    assert verify._stance(null, "down", "") == "neutral"
    assert verify._stance(None, "down", "no significant difference was found") == "neutral"
    print("ok  claim direction + study stance classification")


def test_supported_claim():
    r = verify.verify_claim("Drug X reduces mortality", current_year=2026,
                            now="2026-01-01T00:00:00+00:00", _search=lambda q, retmax=40: SUPPORT)
    assert r.status == "Supported", r.status
    assert r.supporting >= 3 and r.contradicting == 0
    assert r.strength in ("moderate", "high")
    assert r.receipt_id.startswith("STR-") and r.highest_evidence["level"] == 1
    assert len(r.citations) == 3 and r.citations[0]["stance"] == "support"
    print("ok  a well-supported claim reads as Supported with citations")


def test_conflict_claim_is_mixed():
    r = verify.verify_claim("Drug X reduces mortality", current_year=2026,
                            now="2026-01-01T00:00:00+00:00", _search=lambda q, retmax=40: CONFLICT)
    assert r.contradicting >= 2 and r.supporting >= 2
    assert r.status in ("Mixed", "Contradicted"), r.status
    assert r.strength in ("low", "moderate")          # conflict caps certainty
    print(f"ok  conflicting evidence reads as {r.status}, not falsely Supported")


def test_receipt_serialization_and_seal():
    r = verify.verify_claim("Drug X reduces mortality", current_year=2026,
                            now="2026-01-01T00:00:00+00:00", _search=lambda q, retmax=40: SUPPORT)
    d = r.to_dict()
    r2 = Receipt.from_dict(d)
    assert r2.receipt_id == r.receipt_id and r2.status == r.status
    svg = seal_svg(r)
    assert svg.startswith("<svg") and "EVIDENCE VERIFIED" in svg and r.status in svg
    assert "STRATA EVIDENCE RECEIPT" in render_terminal(r, color=False)
    print("ok  receipt round-trips; Seal SVG + terminal render render")


def test_diff_detects_change():
    old = {"strength": "moderate", "status": "Supported", "contradicting": 0,
           "citations": [{"pmid": "1"}, {"pmid": "2"}]}
    new = verify.verify_claim("Drug X reduces mortality", current_year=2026,
                              now="2026-02-01T00:00:00+00:00", _search=lambda q, retmax=40: SUPPORT)
    ch = verify.diff(old, new)
    assert ch["changed"] is True
    kinds = {e["type"] for e in ch["events"]}
    assert "new_study" in kinds        # pmid 3 is new vs old
    assert verify.diff(None, new)["first_check"] is True
    print("ok  diff surfaces new studies and certainty movement")


def test_monitor_lifecycle_and_demo():
    c = monitor.register("Drug X reduces mortality", tenant="Acme")
    r1, ch1 = monitor.check(c["id"], now="2026-03-01T00:00:00+00:00",
                            _search=lambda q, retmax=40: SUPPORT[:2])
    assert ch1["first_check"] is True
    r2, ch2 = monitor.check(c["id"], now="2026-04-01T00:00:00+00:00",
                            _search=lambda q, retmax=40: CONFLICT)
    assert ch2["changed"] is True                     # conflict + new studies arrived
    v = monitor.view(c["id"])
    assert len(v["history"]) == 2 and v["receipt"]["status"] in ("Mixed", "Contradicted")
    assert any(x["id"] == c["id"] for x in monitor.list_claims())

    # demo seeds a real conflict story
    demo.seed_claims(force=True)
    vf = monitor.view("clm-fasting-cvd")
    assert vf is not None and vf["receipt"]["status"] in ("Mixed", "Contradicted", "Insufficient")
    assert vf["receipt"]["evidence_changed"] is True
    print("ok  monitor registers, checks, diffs, and lists; demo seeds a conflict story")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nall verify + monitor tests passed")
