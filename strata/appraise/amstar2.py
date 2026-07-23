"""AMSTAR-2 — how much confidence to place in a systematic review.

Systematic reviews sit at the top of the evidence pyramid, which is why a bad
one is so dangerous. A review with no protocol, a single database, no risk-of-bias
assessment and a meta-analysis that pools whatever it found still arrives
labelled "systematic review / meta-analysis" and still outranks every trial
beneath it. AMSTAR-2 exists to separate those from the real ones, and Strata runs
it on every level-1 paper it retrieves.

Sixteen items. Seven of them are **critical**: a single critical flaw drops
overall confidence to Low, and two drop it to Critically low, regardless of how
well the other fourteen are answered. The critical items are the ones where
failure invalidates the review's conclusion rather than merely weakening it:

    2   protocol registered before the review commenced
    4   adequacy of the literature search
    7   list of excluded studies, with justification
    9   risk of bias assessed in the included studies
    11  appropriate methods for statistical combination
    13  risk of bias accounted for when interpreting results
    15  investigation of publication bias

Answers are Yes / Partial yes / No, exactly as the instrument specifies —
"partial yes" is a real answer for items 2, 4, 7, 8 and 9 and carries different
weight from either extreme.

**What the abstract cannot see.** Item 7 (the list of excluded studies) and item
16 (conflicts of interest) live in supplementary material almost by definition.
Scoring them "No" from an abstract would mark essentially every review as
critically low, which is worse than useless. Strata scores what an abstract can
support, marks the rest ``unassessable``, and — this is the part that matters —
**excludes unassessable critical items from the overall rating** rather than
counting them as flaws. The rating that comes out is therefore an upper bound on
confidence: the review is *at best* this good.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import signals as sig

YES, PARTIAL, NO, UNASSESSABLE = "yes", "partial yes", "no", "unassessable"

HIGH, MODERATE, LOW, CRITICALLY_LOW = ("high", "moderate", "low",
                                       "critically low")

#: The seven items where a failure is disqualifying rather than merely
#: weakening, per Shea et al. 2017.
CRITICAL_ITEMS = (2, 4, 7, 9, 11, 13, 15)

_ITEMS = {
    1: "Did the research questions and inclusion criteria include the "
       "components of PICO?",
    2: "Did the report contain an explicit statement that the review methods "
       "were established prior to the conduct of the review, and did the report "
       "justify any significant deviations from the protocol?",
    3: "Did the review authors explain their selection of the study designs for "
       "inclusion in the review?",
    4: "Did the review authors use a comprehensive literature search strategy?",
    5: "Did the review authors perform study selection in duplicate?",
    6: "Did the review authors perform data extraction in duplicate?",
    7: "Did the review authors provide a list of excluded studies and justify "
       "the exclusions?",
    8: "Did the review authors describe the included studies in adequate detail?",
    9: "Did the review authors use a satisfactory technique for assessing the "
       "risk of bias in individual studies?",
    10: "Did the review authors report on the sources of funding for the studies "
        "included in the review?",
    11: "If meta-analysis was performed, did the review authors use appropriate "
        "methods for statistical combination of results?",
    12: "If meta-analysis was performed, did the review authors assess the "
        "potential impact of risk of bias in individual studies on the results?",
    13: "Did the review authors account for risk of bias in individual studies "
        "when interpreting/discussing the results?",
    14: "Did the review authors provide a satisfactory explanation for, and "
        "discussion of, any heterogeneity observed?",
    15: "If they performed quantitative synthesis, did the review authors carry "
        "out an adequate investigation of publication bias?",
    16: "Did the review authors report any potential sources of conflict of "
        "interest, including any funding they received for conducting the review?",
}


@dataclass
class Item:
    number: int
    text: str
    answer: str
    critical: bool
    basis: str = ""
    note: str = ""

    @property
    def is_flaw(self) -> bool:
        return self.answer == NO

    @property
    def is_weakness(self) -> bool:
        return self.answer == PARTIAL

    def as_dict(self) -> dict:
        return {"item": self.number, "text": self.text, "answer": self.answer,
                "critical": self.critical, "basis": self.basis,
                "note": self.note}


@dataclass
class Amstar2Assessment:
    instrument: str
    version: str
    confidence: str
    rationale: str
    items: list[Item]
    critical_flaws: list[int] = field(default_factory=list)
    non_critical_weaknesses: list[int] = field(default_factory=list)
    unassessable: list[int] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)

    @property
    def grade_delta(self) -> int:
        """A review too weak to trust cannot confer high certainty on a body of
        evidence, however good its constituent trials were."""
        return {HIGH: 0, MODERATE: 0, LOW: -1, CRITICALLY_LOW: -2}[self.confidence]

    def as_dict(self) -> dict:
        return {"instrument": self.instrument, "version": self.version,
                "confidence": self.confidence, "rationale": self.rationale,
                "grade_delta": self.grade_delta,
                "critical_flaws": self.critical_flaws,
                "non_critical_weaknesses": self.non_critical_weaknesses,
                "unassessable": self.unassessable,
                "items": [i.as_dict() for i in self.items],
                "limitations": self.limitations}


_SIGNAL_KEYS = ["registered", "protocol_available", "prisma", "search_strategy",
                "multiple_databases", "duplicate_screening",
                "risk_of_bias_assessed", "heterogeneity_assessed",
                "publication_bias_assessed", "grey_literature",
                "language_restricted", "conflict_declared", "funding_declared",
                "prespecified_outcome"]


def assess(text: str, *, has_meta_analysis: bool | None = None) -> Amstar2Assessment:
    """Score a systematic review abstract against AMSTAR-2.

    ``has_meta_analysis`` controls items 11, 12 and 15, which are conditional on
    a quantitative synthesis having been performed. When it is ``None`` the
    presence of pooling language in the text decides.
    """
    s = sig.detect(text, _SIGNAL_KEYS)
    low = (text or "").lower()
    if has_meta_analysis is None:
        has_meta_analysis = any(w in low for w in
                                ("meta-analys", "meta analys", "pooled",
                                 "random-effects", "random effects", "forest plot"))

    items: list[Item] = []

    def add(n: int, answer: str, basis: str = "", note: str = "") -> None:
        items.append(Item(number=n, text=_ITEMS[n], answer=answer,
                          critical=n in CRITICAL_ITEMS, basis=basis, note=note))

    # 1 — PICO. An abstract with population, intervention and an outcome named.
    pico_bits = sum(bool(w in low) for w in
                    ("patients", "participants", "adults", "children", "population"))
    add(1, YES if pico_bits and ("outcome" in low or "primary" in low) else PARTIAL,
        note="Judged from the structure of the abstract's objective statement.")

    # 2 — protocol before commencement (CRITICAL)
    if s["protocol_available"].present or "prospero" in low or "crd42" in low:
        add(2, YES, s["protocol_available"].quote or "PROSPERO registration cited")
    elif s["registered"].present:
        add(2, PARTIAL, s["registered"].quote,
            "A registration is cited but the abstract does not state that the "
            "methods were fixed before the review began.")
    else:
        add(2, NO, note="No protocol or PROSPERO registration is cited.")

    # 3 — justification of included designs
    add(3, YES if any(w in low for w in
                      ("randomised controlled trial", "randomized controlled trial",
                       "rcts", "cohort studies", "observational studies",
                       "eligible study designs")) else UNASSESSABLE)

    # 4 — comprehensive search (CRITICAL)
    if s["multiple_databases"].present and s["grey_literature"].present:
        add(4, YES, s["multiple_databases"].quote)
    elif s["multiple_databases"].present:
        add(4, PARTIAL, s["multiple_databases"].quote,
            "Two or more databases searched; no grey literature or registry "
            "search is described.")
    elif s["search_strategy"].present:
        add(4, PARTIAL, s["search_strategy"].quote,
            "Only one database is named in the abstract.")
    else:
        add(4, UNASSESSABLE, note="No search sources are named in the abstract.")
    if s["language_restricted"].present:
        items[-1].note += (" The search was restricted to English-language "
                           "publications, which AMSTAR-2 counts against this item.")

    # 5 / 6 — duplicate selection and extraction
    dup = s["duplicate_screening"]
    add(5, YES if dup.present else UNASSESSABLE, dup.quote)
    add(6, YES if dup.present else UNASSESSABLE, dup.quote)

    # 7 — list of excluded studies (CRITICAL, and essentially never in an abstract)
    add(7, UNASSESSABLE,
        note="The list of excluded studies is supplementary material by "
             "convention. It cannot be judged from an abstract and is excluded "
             "from the rating rather than scored as a flaw.")

    # 8 — adequate description of included studies
    add(8, PARTIAL if any(w in low for w in ("included", "studies were", "trials"))
        else UNASSESSABLE)

    # 9 — risk of bias assessed (CRITICAL)
    rob = s["risk_of_bias_assessed"]
    if rob.present:
        named = any(w in low for w in ("rob 2", "rob2", "robins", "newcastle",
                                       "cochrane risk", "risk-of-bias tool"))
        add(9, YES if named else PARTIAL, rob.quote,
            "" if named else "Risk of bias is mentioned; no named instrument.")
    else:
        add(9, NO, note="No risk-of-bias or quality assessment is mentioned.")

    # 10 — funding of included studies
    add(10, UNASSESSABLE,
        note="Funding of the *included* studies is rarely stated in a review's "
             "abstract.")

    # 11 — appropriate statistical combination (CRITICAL, conditional)
    if not has_meta_analysis:
        add(11, YES, note="No meta-analysis was performed, so the item does not "
                          "apply and is scored yes per the instrument.")
    elif any(w in low for w in ("random-effects", "random effects",
                                "dersimonian", "restricted maximum likelihood")):
        add(11, YES, note="A random-effects model is named.")
    elif "fixed-effect" in low or "fixed effect" in low:
        add(11, PARTIAL,
            note="A fixed-effect model is named. Appropriate only if the "
                 "included studies are genuinely estimating one common effect, "
                 "which the abstract does not establish.")
    else:
        add(11, PARTIAL, note="Pooling is reported but the model is not named.")

    # 12 — impact of risk of bias on the pooled result (conditional)
    if not has_meta_analysis:
        add(12, YES, note="No meta-analysis performed.")
    elif rob.present and any(w in low for w in
                             ("sensitivity analys", "excluding studies at high",
                              "low risk of bias only", "restricted to trials at low")):
        add(12, YES, rob.quote)
    else:
        add(12, UNASSESSABLE,
            note="Whether the pooled estimate was re-run excluding high-risk "
                 "studies is not stated.")

    # 13 — risk of bias in the interpretation (CRITICAL)
    add(13, YES if rob.present else NO,
        rob.quote,
        "" if rob.present else "Risk of bias is not mentioned anywhere in the "
                               "abstract, so it cannot have informed the stated "
                               "conclusion.")

    # 14 — heterogeneity discussed
    het = s["heterogeneity_assessed"]
    add(14, YES if het.present else UNASSESSABLE, het.quote)

    # 15 — publication bias (CRITICAL, conditional)
    if not has_meta_analysis:
        add(15, YES, note="No quantitative synthesis, so the item does not apply.")
    elif s["publication_bias_assessed"].present:
        add(15, YES, s["publication_bias_assessed"].quote)
    else:
        add(15, NO, note="A meta-analysis was performed with no mention of "
                         "publication bias, small-study effects or a funnel plot.")

    # 16 — conflicts of interest
    add(16, YES if s["conflict_declared"].present else UNASSESSABLE,
        s["conflict_declared"].quote)

    # ------------------------------------------------------------- the rating
    critical_flaws = [i.number for i in items if i.critical and i.is_flaw]
    critical_partial = [i.number for i in items if i.critical and i.is_weakness]
    unassessable = [i.number for i in items if i.answer == UNASSESSABLE]
    weaknesses = [i.number for i in items
                  if not i.critical and i.answer in (NO, PARTIAL)]

    if len(critical_flaws) > 1:
        confidence = CRITICALLY_LOW
        rationale = (f"Critically low confidence: {len(critical_flaws)} critical "
                     f"flaws (items {', '.join(map(str, critical_flaws))}). More "
                     f"than one critical flaw means the review should not be "
                     f"relied on to summarise the available studies, whatever "
                     f"its other strengths.")
    elif len(critical_flaws) == 1:
        confidence = LOW
        rationale = (f"Low confidence: one critical flaw (item "
                     f"{critical_flaws[0]}). A single critical flaw is enough — "
                     f"AMSTAR-2 is explicitly not a score to be summed.")
    elif len(weaknesses) + len(critical_partial) > 1:
        confidence = MODERATE
        rationale = (f"Moderate confidence: no critical flaw, but more than one "
                     f"weakness (items "
                     f"{', '.join(map(str, sorted(weaknesses + critical_partial)))}). "
                     f"The review is likely to provide an accurate summary.")
    else:
        confidence = HIGH
        rationale = ("High confidence: no critical flaw and at most one "
                     "non-critical weakness on what the abstract shows.")

    if unassessable:
        rationale += (f" Items {', '.join(map(str, unassessable))} could not be "
                      f"judged from an abstract and were excluded from the "
                      f"rating, so this is an upper bound on confidence — the "
                      f"review is at best this good.")

    return Amstar2Assessment(
        instrument="AMSTAR-2", version="2017 (Shea et al., BMJ)",
        confidence=confidence, rationale=rationale, items=items,
        critical_flaws=critical_flaws,
        non_critical_weaknesses=sorted(weaknesses),
        unassessable=unassessable,
        limitations=[
            "Scored from the abstract. AMSTAR-2 is designed for the full report "
            "including supplementary material.",
            "Unassessable items are excluded from the rating rather than scored "
            "as failures, so the confidence rating is an upper bound.",
            "AMSTAR-2 assesses the conduct of the review, not the quality of the "
            "trials inside it. A well-conducted review of bad trials scores high "
            "here and still gives low-certainty evidence — that is GRADE's job, "
            "not this instrument's.",
        ])
