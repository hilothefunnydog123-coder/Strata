"""Tests for Strata. Run: python tests/test_strata.py

The PubMed network layer is mocked so the pipeline, grader, ranking and synthesis
are all exercised offline. The one thing not tested here is live E-utilities I/O,
which is thin and covered by running `strata ask` for real.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strata.pubmed import Article                       # noqa: E402
from strata.evidence import grade, summarize_body       # noqa: E402
from strata import query, synthesize                    # noqa: E402


def _art(pmid, title, ptypes, abstract="", year=2023):
    return Article(pmid, title, abstract, "J Test", year, ["Smith J", "Doe A"], ptypes)

SAMPLE = [
    _art("1", "A narrative overview of vitamin D", ["Review"], "Vitamin D is discussed.", 2018),
    _art("2", "Vitamin D and respiratory infection: a meta-analysis of RCTs",
         ["Meta-Analysis"], "In 25 trials (n = 11,321), supplementation reduced infection risk.", 2021),
    _art("3", "A case report of vitamin D toxicity", ["Case Reports"], "We describe one patient.", 2022),
    _art("4", "Randomized controlled trial of vitamin D in adults",
         ["Randomized Controlled Trial"], "Among 5,000 participants, the effect was modest.", 2023),
]


def test_grader_levels():
    Y = 2026
    assert grade(SAMPLE[1], Y).level == 1 and grade(SAMPLE[1], Y).strength == "high"
    assert grade(SAMPLE[3], Y).level == 2
    assert grade(SAMPLE[2], Y).level == 5 and grade(SAMPLE[2], Y).strength == "very low"
    assert grade(SAMPLE[0], Y).level == 6
    assert grade(SAMPLE[1], Y).sample_size == 11321
    print("ok  grader places studies on the evidence pyramid")


def test_ranking_prioritises_evidence():
    Y = 2026
    grades = [grade(a, Y) for a in SAMPLE]
    ranked = query.rank(SAMPLE, grades, Y)
    # the meta-analysis must rank first, the narrative review last
    assert ranked[0].article.pmid == "2", "meta-analysis should rank first"
    assert ranked[-1].grade.level >= 5, "weakest evidence should sink"
    print("ok  ranking floats strong, recent evidence to the top")


def test_ask_grounded_digest():
    Y = 2026
    r = query.ask("Does vitamin D prevent respiratory infections?",
                  current_year=Y, _search=lambda q, retmax=25: SAMPLE)
    assert r.grounded is True
    assert r.body.best_level == 1
    assert "evidence" in r.body.summary.lower()
    assert "[1]" in r.answer and "http" in r.answer          # cited digest
    assert r.evidence[0].article.pmid == "2"
    print("ok  ask() returns a grounded, cited digest with an honest verdict")


def test_ask_with_model_is_anchored():
    Y = 2026
    seen = {}

    def fake_model(prompt):
        seen["prompt"] = prompt
        return "Supplementation modestly reduces infection risk [2][4]."

    r = query.ask("vitamin D infections?", current_year=Y, generate=fake_model,
                  _search=lambda q, retmax=25: SAMPLE)
    assert r.grounded is False
    # the model only ever saw the retrieved sources, and the answer keeps the verdict
    assert "SOURCES:" in seen["prompt"] and "meta-analysis" in seen["prompt"].lower()
    assert "Evidence strength:" in r.answer
    print("ok  model synthesis is anchored to retrieved sources + keeps the verdict")


def test_empty_is_honest():
    r = query.ask("a question with no hits", current_year=2026,
                  _search=lambda q, retmax=25: [])
    assert r.body.overall_strength == "none"
    assert "no studies" in r.answer.lower()
    print("ok  no evidence -> says so, invents nothing")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nall tests passed")
