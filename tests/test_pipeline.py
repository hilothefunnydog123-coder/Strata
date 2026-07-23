"""Tests for the verification pipeline: extraction, contradiction, assessment.

Network is never touched — retrieval is injected. Run: python tests/test_pipeline.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strata.pubmed import Article                                    # noqa: E402
from strata.extract import extract                                   # noqa: E402
from strata.contradiction import claim_polarity, classify_stance, population_match  # noqa: E402
from strata.assess import assess                                     # noqa: E402
from strata.sources import RetrievalResult, dedupe                   # noqa: E402
from strata.verify import verify                                     # noqa: E402


def _art(pmid, title, abstract, ptypes, year=2023, doi="", ft=False, source="pubmed"):
    return Article(pmid, title, abstract, "J Test", year, ["Smith J", "Doe A"],
                   ptypes, doi=doi, source=source, has_full_text=ft)


def _ret(arts):
    return lambda q, retmax, sources=None: RetrievalResult(
        articles=arts, per_source={"pubmed": len(arts)}, retrieved_total=len(arts),
        unique=len(arts), sources_used=["pubmed"])


def test_extraction_provenance():
    a = _art("1", "RCT of Drug X",
             "Among 5,000 patients aged 65 to 90, Drug X reduced events (HR 0.82, 95% CI 0.70 to "
             "0.95, p = 0.01). Funded by Pfizer.", ["Randomized Controlled Trial"], 2024)
    e = extract(a)
    assert e["sample_size"]["value"] == 5000 and e["sample_size"]["provenance"] == "reported"
    eff = e["effects"][0]
    assert eff["metric"] == "HR" and eff["value"] == 0.82 and eff["significant"] is True
    assert eff["provenance"] == "reported"           # CI present => reported
    assert e["direction"]["value"] == "benefit" and e["direction"]["provenance"] == "heuristic"
    assert e["funding"]["industry"] is True
    assert e["basis"] == "abstract"                  # honest: abstract-level
    print("ok  extraction tags provenance and never claims full text it lacks")


def test_precise_null_is_genuine_not_statistical():
    a = _art("2", "Large trial of Drug X finds no benefit",
             "In 8,000 patients, Drug X did not reduce events (HR 0.98, 95% CI 0.90 to 1.07, "
             "p = 0.6).", ["Randomized Controlled Trial"], 2025)
    e = extract(a)
    assert e["direction"]["value"] == "null"
    stance = classify_stance("benefit", e, {"match": "good"})
    assert stance["stance"] == "contradicting"
    # a precise, well-powered null is a genuine conflict, not "imprecision"
    assert stance["disagreement_type"] == "genuine"
    print("ok  a precise well-powered null contradicts as genuine disagreement")


def test_imprecise_null_is_statistical():
    a = _art("3", "Small study of Drug X",
             "In 40 patients, Drug X showed no significant effect (OR 0.8, 95% CI 0.3 to 2.1).",
             ["Randomized Controlled Trial"], 2024)
    e = extract(a)
    stance = classify_stance("benefit", e, {"match": "good"})
    assert stance["disagreement_type"] == "statistical"
    print("ok  an underpowered null is attributed to statistical uncertainty")


def test_population_match():
    good = population_match({"terms": ["elderly"], "age_min": 65},
                            {"terms": ["elderly"], "age_min": 70, "age_max": 90})
    assert good["match"] == "good"
    diff = population_match({"terms": ["children"], "age_min": None},
                            {"terms": ["adults"], "age_min": 40, "age_max": 60})
    assert diff["match"] in ("different", "partial")
    print("ok  population match compares terms and age ranges")


def test_assess_is_transparent_and_downgrades_on_contradiction():
    records = [
        {"level": 1, "label": "meta", "strength": "high", "stance": "supporting",
         "significant": True, "population_match": "good", "year": 2022, "sample_size": 24500,
         "industry_funded": False, "direction": "benefit"},
        {"level": 2, "label": "rct", "strength": "high", "stance": "contradicting",
         "significant": False, "population_match": "good", "year": 2025, "sample_size": 8000,
         "industry_funded": False, "direction": "null"},
    ]
    a = assess(records, current_year=2026)
    assert a["strength"] == "moderate"               # downgraded from high by the contradiction
    assert a["status"] in ("partially_supported", "contested")
    assert any("meta-analysis" in r for r in a["reasons"])
    assert any("contradict" in l for l in a["limitations"])
    assert a["basis"] == "abstract-level"
    print("ok  assessment is inspectable and downgrades on comparable-quality contradiction")


def test_verify_separates_and_audits():
    arts = [
        _art("m", "Treatment X reduces hospitalization: meta-analysis of RCTs",
             "In 18 trials (n=24,500) of adults over 65, Treatment X reduced hospitalization "
             "(RR 0.79, 95% CI 0.71 to 0.88).", ["Meta-Analysis"], 2022),
        _art("n", "Large trial: Treatment X does not reduce hospitalization",
             "In 8,000 patients over 65, Treatment X did not reduce hospitalization (HR 0.99, "
             "95% CI 0.91 to 1.07).", ["Randomized Controlled Trial"], 2025),
    ]
    v = verify("Does Treatment X reduce hospitalization in elderly heart failure?",
               current_year=2026, retrieve_fn=_ret(arts))
    assert len(v.supporting) == 1 and len(v.contradicting) == 1
    assert v.pico["intervention"]["value"].lower().startswith("treatment x")
    assert any(s["step"] == "assess_strength" for s in v.audit_trail)
    assert v.fingerprint and len(v.fingerprint) == 16
    d = v.to_dict()
    assert d["supporting_evidence"] and d["contradicting_evidence"] and d["audit_trail"]
    print("ok  verify separates supporting vs contradicting with a full audit trail")


def test_verify_empty_is_honest():
    v = verify("a question with no hits", current_year=2026, retrieve_fn=_ret([]))
    assert v.status == "insufficient_evidence" and v.evidence_strength == "none"
    assert "no studies" in v.answer.lower()
    print("ok  no evidence -> says so, invents nothing")


def test_dedupe_across_sources():
    a = _art("1", "Trial of X", "long abstract", ["Randomized Controlled Trial"], doi="10.1/x")
    b = _art("", "trial of x", "short", ["Journal Article"], doi="10.1/X", source="europepmc", ft=True)
    merged = dedupe([a, b])
    assert len(merged) == 1
    assert merged[0].has_full_text and "pubmed" in merged[0].source and "europepmc" in merged[0].source
    print("ok  cross-source dedup merges by DOI and keeps the richest fields")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nall pipeline tests passed")
