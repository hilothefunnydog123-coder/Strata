"""Tests for the transparent assessment engine (strength rationale + contradiction).
Run: python tests/test_assessment.py  (fully offline)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strata import assessment                                    # noqa: E402
from strata.evidence import grade                                # noqa: E402
from strata.pubmed import Article                                # noqa: E402
from strata.review import _extract_effect                        # noqa: E402


def _item(pmid, title, pt, ab, yr, stance, cb=0):
    a = Article(pmid, title, ab, "J", yr, ["S"], pt, cited_by=cb)
    g = grade(a, 2026)
    return [a, g, stance, _extract_effect(f"{a.title}. {a.abstract}")]


STRONG = [
    _item("1", "Meta-analysis: drug X reduces hospitalization", ["Meta-Analysis"],
          "Across 20 trials (n=24,000), HR 0.70 (95% CI 0.62 to 0.79).", 2023, "support", 400),
    _item("2", "RCT of drug X", ["Randomized Controlled Trial"],
          "Among 4,744 patients, HR 0.74 (95% CI 0.65 to 0.85).", 2022, "support", 220),
]
CONTRA = [
    _item("3", "Drug X in preserved ejection fraction: observational cohort", ["Observational Study"],
          "In elderly patients on low-dose therapy over 3 months, no difference (HR 1.05, 95% CI 0.88 to 1.25).",
          2024, "contradict", 30),
]


def test_strength_rationale_is_computed_from_studies():
    r = assessment.strength_rationale(STRONG, "Supported", "moderate", 2026,
                                      pico={"population": "heart failure"}, supporting=2, contradicting=0)
    d = r["dimensions"]
    assert d["study_design"] == "high"          # meta-analysis + RCT present
    assert d["precision"] == "high"             # significant CIs excluding 1.0
    assert d["recency"] == "high"               # both within 10 years
    assert any("meta-analysis" in f["text"].lower() for f in r["factors"])
    assert any("sample size" in f["text"].lower() for f in r["factors"])
    assert all(f["sign"] == "+" for f in r["factors"])
    assert r["summary"].startswith("Moderate-quality evidence")
    print("ok  strength rationale grades each GRADE domain from the actual studies")


def test_rationale_flags_weakness_when_no_rct():
    weak = [_item("9", "Drug Y and outcomes: a cohort", ["Observational Study"],
                  "aHR 0.9 (95% CI 0.8 to 1.02).", 2005, "support")]
    r = assessment.strength_rationale(weak, "Supported", "low", 2026, supporting=1, contradicting=0)
    assert r["dimensions"]["study_design"] in ("low", "moderate")
    texts = " ".join(l["text"].lower() for l in r["limitations"])
    assert "no rct or meta-analysis" in texts
    assert "more than 15 years" in texts       # 2005 vs 2026
    print("ok  rationale downgrades honestly: no RCT, dated evidence")


def test_contradiction_names_the_reason():
    c = assessment.contradiction_analysis(STRONG, CONTRA)
    assert c["disagreement"] is True
    factors = {r["factor"] for r in c["reasons"]}
    assert "population" in factors               # HFpEF vs not, elderly vs not
    assert "design" in factors                   # observational vs RCT/meta
    for r in c["reasons"]:
        assert r["support_example"] and r["contradict_example"]
    print("ok  contradiction analysis names population + design differences with examples")


def test_no_contradiction_is_honest():
    c = assessment.contradiction_analysis(STRONG, [])
    assert c["disagreement"] is False and c["reasons"] == []
    assert "same way" in c["note"]
    print("ok  no contradicting evidence -> honest note, no invented conflict")


def test_unresolved_conflict_says_so():
    # two studies that disagree with no explanatory signal in the text
    s = [_item("a", "Drug Z trial", ["Randomized Controlled Trial"], "HR 0.80 (95% CI 0.70 to 0.90).", 2022, "support")]
    c = [_item("b", "Drug Z trial two", ["Randomized Controlled Trial"], "HR 1.20 (95% CI 1.05 to 1.40).", 2022, "contradict")]
    out = assessment.contradiction_analysis(s, c)
    assert any(r["factor"] == "unresolved" for r in out["reasons"])
    print("ok  a genuinely unexplained conflict is labelled unresolved, not fabricated")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nall assessment tests passed")
