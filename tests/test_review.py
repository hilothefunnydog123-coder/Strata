"""Tests for the living-review wedge. Run: python tests/test_review.py

Fully offline: PubMed is injected, and the JSON store is redirected to a temp dir. Covers
the review pipeline (inclusion, PRISMA, grading, effect extraction, accumulation, anatomy)
and the 'living' surveillance diff that makes a living review worth paying for.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# redirect the store BEFORE importing modules that read it
os.environ["STRATA_HOME"] = tempfile.mkdtemp(prefix="strata-test-")

from strata.pubmed import Article                                   # noqa: E402
from strata import review, anatomy, demo, store                     # noqa: E402


def _art(pmid, title, ptypes, abstract="", year=2023):
    return Article(pmid, title, abstract, "J Test", year, ["Smith J", "Doe A"], ptypes)


SAMPLE = [
    _art("1", "A narrative overview of vitamin D", ["Review"], "Vitamin D is discussed.", 2018),
    _art("2", "Vitamin D and respiratory infection: a meta-analysis of RCTs", ["Meta-Analysis"],
         "In 25 trials (n = 11,321), the risk ratio was 0.88 (95% CI 0.81 to 0.96).", 2021),
    _art("3", "A case report of vitamin D toxicity", ["Case Reports"], "We describe one patient.", 2022),
    _art("4", "Randomized controlled trial of vitamin D in adults", ["Randomized Controlled Trial"],
         "Among 5,000 participants the hazard ratio was 0.95 (95% CI 0.84 to 1.08).", 2023),
]


def test_effect_extraction():
    e = review._extract_effect("the hazard ratio was 0.79 (95% CI 0.65 to 0.96)")
    assert e["measure"] == "HR" and e["value"] == 0.79 and e["significant"] is True
    assert e["direction"] == "reduction"
    e2 = review._extract_effect("risk ratio 0.95 (95% CI 0.84 to 1.08)")
    assert e2["significant"] is False and e2["direction"] == "null"   # CI crosses 1
    e3 = review._extract_effect("supplementation reduced infection risk substantially")
    assert e3["direction"] == "reduction" and e3["value"] is None      # qualitative
    assert review._extract_effect("a plain descriptive sentence") is None
    print("ok  effect extraction reads ratios + CIs and falls back honestly")


def test_run_protocol_filters_grades_and_pinpoints():
    p = review.new_protocol("VitD", "Does vitamin D prevent respiratory infections?",
                            include_levels=(1, 2, 3), id="unit-vitd")
    snap = run = review.run_protocol(p, current_year=2026, now="2026-01-01T00:00:00+00:00",
                                     _search=lambda q, retmax=60: SAMPLE)
    assert snap["prisma"]["identified"] == 4
    # the narrative review (level 6) and case report (level 5) are excluded by protocol
    assert snap["prisma"]["included"] == 2
    assert snap["prisma"]["excluded_level"] == 2
    assert snap["best_level"] == 1 and snap["overall_strength"] in ("moderate", "high")
    # the meta-analysis effect is extracted for the forest plot
    assert any(e["measure"] == "RR" and e["value"] == 0.88 for e in snap["effects"])
    # anatomy pinpoints the respiratory / immune system, not nothing
    ids = {h["id"] for h in snap["hotspots"]}
    assert ids and ({"lungs", "immune"} & ids)
    print("ok  run_protocol includes by level, grades, extracts effects, pinpoints anatomy")


def test_cumulative_is_monotonic():
    pts = review._cumulative([(2019, "low"), (2021, "high"), (2021, "moderate"), (2023, "moderate")])
    counts = [p["count"] for p in pts]
    assert counts == sorted(counts) and counts[-1] == 4
    assert pts[-1]["strength"] == "high"          # best certainty reached, carried forward
    print("ok  accumulation curve is cumulative and tracks best certainty reached")


def test_surveillance_reports_change():
    old = {"pmids": ["2", "4"], "overall_strength": "moderate", "taken": "2026-05-01T00:00:00+00:00"}
    new = {"pmids": ["2", "4", "7"], "overall_strength": "high", "taken": "2026-07-01T00:00:00+00:00",
           "studies": [{"pmid": "7", "title": "new meta-analysis"}]}
    s = review.diff_snapshots(old, new)
    assert s["changed"] is True and s["new_pmids"] == ["7"]
    assert s["strength_change"] == ["moderate", "high"]
    assert review.diff_snapshots(None, new)["first_sync"] is True
    print("ok  surveillance diff flags new studies and certainty movement")


def test_store_roundtrip_and_view():
    review.create("Metformin", "Does metformin reduce cardiovascular mortality?",
                  include_levels=(1, 2, 3), id="unit-metf")
    review.sync("unit-metf", current_year=2026, now="2026-06-01T00:00:00+00:00",
                _search=lambda q, retmax=60: SAMPLE)
    review.sync("unit-metf", current_year=2026, now="2026-07-01T00:00:00+00:00",
                _search=lambda q, retmax=60: SAMPLE)
    v = review.view("unit-metf")
    assert v["snapshot"]["taken"] == "2026-07-01T00:00:00+00:00"
    assert len(v["history"]) == 2
    assert v["surveillance"]["changed"] is False        # identical second sync -> nothing new
    assert any(r["protocol"]["id"] == "unit-metf" for r in review.list_reviews())
    print("ok  store persists protocol + snapshots; view assembles the render payload")


def test_anatomy_mapping():
    hs = anatomy.hotspots_for("coronary heart disease and myocardial infarction", "high")
    assert any(h.id == "heart" for h in hs)
    assert abs(sum(h.intensity for h in hs) - 1.0) < 0.05         # intensities are shares
    assert anatomy.hotspots_for("", "none") == []                 # honest silence
    print("ok  anatomy maps clinical language to body regions, silent when nothing matches")


def test_demo_seeds_a_living_story():
    demo.seed(force=True)
    v = review.view("demo-vitamin-d-respiratory")
    assert v is not None and len(v["history"]) == 2
    # the second sync introduced the updated meta-analysis -> surveillance has news
    assert v["surveillance"]["changed"] is True
    assert len(v["snapshot"]["effects"]) >= 3        # forest plot has material
    assert len(v["snapshot"]["hotspots"]) >= 1
    print("ok  demo seeds three reviews with a real 'what changed' surveillance story")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nall review tests passed")
