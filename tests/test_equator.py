"""EQUATOR reporting-guideline compliance tests.

Run: ``python tests/test_equator.py``

The property worth pinning down here is the one that separates this module from
:mod:`strata.rob`: compliance is a claim about the *text*, not about the study.
A checklist item is present when the abstract says the thing, and absent when it
does not — and "absent" must never quietly become "the trial did not do it".
Several tests exist only to hold that line, because the two readings look
identical in a percentage and mean completely different things to an author
being handed a list of gaps.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, OSError):
    pass

import json                                                     # noqa: E402

from strata import equator                                      # noqa: E402
from strata.pubmed import Article                                # noqa: E402


def _article(title: str, abstract: str, pmid: str = "1") -> Article:
    return Article(pmid=pmid, title=title, abstract=abstract, journal="J Test",
                   year=2021, authors=["Smith J"], publication_types=[])


WELL_REPORTED_TRIAL = _article(
    "A randomised, double-blind, placebo-controlled trial of X in sepsis",
    "METHODS: In this multicentre parallel-group trial, adults aged 18 years or "
    "older with septic shock were randomly assigned 1:1 by a computer-generated "
    "sequence to X or placebo. The primary outcome was 28-day mortality. "
    "Assessors were blinded. 1,240 patients were randomised and analysed by "
    "intention to treat. RESULTS: Mortality was 24% versus 31% (risk ratio 0.78, "
    "95% CI 0.66 to 0.92, p = 0.003). Serious adverse events occurred in 12%. "
    "CONCLUSIONS: X reduced mortality. Registered at ClinicalTrials.gov "
    "(NCT01234567). Funded by the Medical Research Council.")

BARE_TRIAL = _article("A trial of Y", "We gave Y to some patients. It worked.", "2")


def test_the_checklist_is_chosen_by_design():
    art = WELL_REPORTED_TRIAL
    assert equator.check(art, 2).guideline.startswith("CONSORT")
    assert equator.check(art, 1).guideline.startswith("PRISMA")
    assert equator.check(art, 3).guideline.startswith("STROBE")
    assert equator.check(art, 4).guideline.startswith("STROBE")
    assert equator.check(art, 5).guideline == "CARE"
    assert equator.check(art, 7).guideline.startswith("ARRIVE")
    print("ok  each design is scored against the checklist that governs it")


def test_narrative_reviews_get_no_checklist_rather_than_a_zero():
    """Level 6 is opinion. There is no method to report, so there is no
    checklist — and returning 0% would read as a failure where the truth is
    that the question does not apply."""
    assert equator.check(WELL_REPORTED_TRIAL, 6) is None
    print("ok  narrative reviews and editorials get None, not a score of zero")


def test_item_counts_match_the_published_checklists():
    art = WELL_REPORTED_TRIAL
    assert len(equator.check(art, 2).items) == 17, "CONSORT for Abstracts has 17 items"
    assert len(equator.check(art, 1).items) == 12, "PRISMA 2020 for Abstracts has 12"
    assert len(equator.check(art, 3).items) == 9
    assert len(equator.check(art, 5).items) == 8
    assert len(equator.check(art, 7).items) == 8
    print("ok  each checklist carries its published number of items")


def test_a_well_reported_trial_scores_far_above_a_bare_one():
    good = equator.check(WELL_REPORTED_TRIAL, 2)
    bad = equator.check(BARE_TRIAL, 2)
    assert good.score > 0.7, f"well-reported trial scored only {good.score:.0%}"
    assert bad.score < 0.25, f"bare trial scored {bad.score:.0%}"
    assert good.band in ("complete", "adequate")
    assert bad.band == "poor"
    print(f"ok  compliance separates a reported trial ({good.score:.0%}) "
          f"from a bare one ({bad.score:.0%})")


def test_every_item_marked_present_carries_the_text_that_proves_it():
    """A checklist item scored present with nothing quotable is an assertion."""
    for level in (1, 2, 3, 5, 7):
        c = equator.check(WELL_REPORTED_TRIAL, level)
        for item in c.items:
            if item.present:
                assert item.quote, f"{c.guideline} item {item.number}: no quote"
            else:
                assert not item.quote, "an absent item must not carry a quote"
    print("ok  every item scored present quotes the text that produced it")


def test_absence_is_reported_as_not_stated_never_as_not_done():
    """The line this module must not cross."""
    c = equator.check(BARE_TRIAL, 2)
    assert c.missing, "the bare trial is missing most items"
    # The vocabulary of the output is about *reporting*, not about conduct.
    text = json.dumps(c.as_dict()).lower()
    for forbidden in ("was not randomised", "was not blinded", "did not register",
                      "poor quality", "badly conducted"):
        assert forbidden not in text, f"output claims conduct: {forbidden!r}"
    assert "reported" in c.summary()
    print("ok  missing items are reported as unstated, never as not done")


def test_counts_reconcile():
    for level in (1, 2, 3, 5, 7):
        c = equator.check(WELL_REPORTED_TRIAL, level)
        assert c.n_present + len(c.missing) == len(c.items)
        assert 0.0 <= c.score <= 1.0
        assert abs(c.score - c.n_present / len(c.items)) < 1e-12
        assert all(i in c.missing for i in c.missing_essential)
    print("ok  present + missing = total, and the score is their ratio")


def test_registration_and_funding_are_detected():
    """The two CONSORT-A items authors most often omit, and the two a
    medical-affairs reviewer most often has to chase."""
    c = equator.check(WELL_REPORTED_TRIAL, 2)
    by_number = {i.number: i for i in c.items}
    assert by_number["15"].present, "trial registration (NCT number) not detected"
    assert by_number["16"].present, "funding statement not detected"
    assert "NCT01234567" in by_number["15"].quote
    print("ok  trial registration and funding statements are detected and quoted")


def test_check_by_name_accepts_aliases_and_refuses_the_unknown():
    assert equator.check_by_name("a randomised trial", "consort") \
        .guideline.startswith("CONSORT")
    assert equator.check_by_name("a systematic review", "PRISMA") \
        .guideline.startswith("PRISMA")
    assert equator.check_by_name("mice", "arrive2").guideline.startswith("ARRIVE")
    try:
        equator.check_by_name("text", "NOT-A-GUIDELINE")
    except ValueError as exc:
        assert "unknown checklist" in str(exc)
    else:
        raise AssertionError("an unknown checklist name must raise, not guess")
    print("ok  check_by_name resolves aliases and refuses unknown names")


def test_empty_text_scores_zero_without_raising():
    c = equator.check_by_name("", "consort")
    assert c.n_present == 0
    assert c.score == 0.0
    assert c.band == "poor"
    print("ok  empty text scores zero rather than raising")


def test_available_describes_every_checklist():
    rows = equator.available()
    assert len(rows) == 5
    for row in rows:
        assert row["id"] and row["guideline"] and row["version"]
        assert row["n_items"] > 0
    ids = {r["id"] for r in rows}
    assert ids == {"CONSORT-A", "PRISMA-A", "STROBE-A", "CARE", "ARRIVE"}, ids
    print("ok  available() describes all five checklists for discovery")


def test_output_serialises():
    c = equator.check(WELL_REPORTED_TRIAL, 2)
    payload = c.as_dict()
    json.dumps(payload)
    assert payload["n_items"] == 17
    assert isinstance(payload["missing"], list)
    assert payload["notes"], "the era caveat must travel with the score"
    print("ok  compliance serialises to JSON and carries its caveats")


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        fn()
    print(f"\nall {len(tests)} EQUATOR compliance tests passed")
