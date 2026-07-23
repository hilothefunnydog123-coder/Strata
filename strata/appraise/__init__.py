"""Formal critical appraisal — the named instruments, applied automatically.

GRADE, which :mod:`strata.evidence` implements, judges a *body* of evidence. It
is not a study-level instrument, and the risk-of-bias domain it contains is a
summary of study-level appraisals done with something else. This package is that
something else:

    Randomised trial        Cochrane RoB 2
    Non-randomised study    ROBINS-I
    Systematic review       AMSTAR-2

Which instrument applies is decided by the design classifier, not by keywords in
the text — running RoB 2 over a cohort study produces a confident assessment of
a question the study never asked, and that failure mode is worse than no
assessment at all.

    from strata.appraise import appraise

    a = appraise(article, level=2)     # a randomised trial
    a.overall                          # "some concerns"
    a.instrument                       # "Cochrane RoB 2"
    for d in a.detail.domains:
        print(d.id, d.judgement, d.rationale)

**Every one of these is a screen.** The instruments are designed to be applied
by a trained reviewer to a full report, a protocol and an analysis plan; Strata
applies them to 250 words of abstract. What that buys is triage across two
hundred papers in seconds with a quotable reason attached to every judgement,
and a defensible starting point for the human appraisal — not a replacement for
it. Every assessment carries its own ``limitations`` list saying so, and those
limitations travel with the result into the API, the exports and the audit
record.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import amstar2, rob2, robins_i, signals
from .amstar2 import Amstar2Assessment
from .rob2 import Rob2Assessment
from .robins_i import RobinsAssessment
from .signals import Signal, detect

__all__ = ["appraise", "Appraisal", "Signal", "detect", "signals",
           "rob2", "robins_i", "amstar2",
           "Rob2Assessment", "RobinsAssessment", "Amstar2Assessment"]

#: Pyramid level -> instrument. Level 5 (case reports), 6 (opinion) and 7
#: (preclinical) have no risk-of-bias instrument worth running: a case report is
#: not biased, it is anecdote, and appraising it as though it were a study
#: implies a comparison it never made.
_INSTRUMENT_FOR_LEVEL = {1: "amstar2", 2: "rob2", 3: "robins_i", 4: "robins_i"}


@dataclass
class Appraisal:
    """One study, one instrument, one judgement — with the reasoning attached."""
    instrument: str
    overall: str
    rationale: str
    grade_delta: int
    detail: object                      # the instrument-specific assessment
    limitations: list

    def as_dict(self) -> dict:
        return {"instrument": self.instrument, "overall": self.overall,
                "rationale": self.rationale, "grade_delta": self.grade_delta,
                "limitations": self.limitations,
                "detail": self.detail.as_dict() if self.detail else None}


def appraise(article, *, level: int, has_meta_analysis: bool | None = None
             ) -> Appraisal | None:
    """Run the instrument appropriate to this study's design.

    ``article`` is anything with a ``text()`` method — a :class:`strata.pubmed.Article`,
    or a plain object wrapping a title and abstract. ``level`` is Strata's
    pyramid level from :func:`strata.evidence.classify`.

    Returns ``None`` for designs no instrument covers, which is the honest
    answer rather than a fabricated one.
    """
    which = _INSTRUMENT_FOR_LEVEL.get(level)
    if which is None:
        return None

    text = article.text() if hasattr(article, "text") else str(article)

    if which == "rob2":
        a = rob2.assess(text, is_randomised=True)
        return Appraisal(instrument=a.instrument, overall=a.overall,
                         rationale=a.rationale, grade_delta=a.grade_delta,
                         detail=a, limitations=a.limitations)
    if which == "robins_i":
        a = robins_i.assess(text, design_level=level)
        return Appraisal(instrument=a.instrument, overall=a.overall,
                         rationale=a.rationale, grade_delta=a.grade_delta,
                         detail=a, limitations=a.limitations)

    a = amstar2.assess(text, has_meta_analysis=has_meta_analysis)
    return Appraisal(instrument=a.instrument, overall=a.confidence,
                     rationale=a.rationale, grade_delta=a.grade_delta,
                     detail=a, limitations=a.limitations)


def instrument_for(level: int) -> str | None:
    """Which instrument a pyramid level gets, without running it."""
    return {"rob2": "Cochrane RoB 2", "robins_i": "ROBINS-I",
            "amstar2": "AMSTAR-2"}.get(_INSTRUMENT_FOR_LEVEL.get(level, ""))
