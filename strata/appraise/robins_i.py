"""ROBINS-I — risk of bias in non-randomised studies of interventions.

The instrument RoB 2's authors wrote for everything RoB 2 does not cover: cohort
studies, case-control studies, controlled before-after designs, anything where
the investigator did not assign the intervention.

The thing that makes ROBINS-I different from every quality checklist that came
before it, and the reason it is worth implementing properly, is its reference
point. Domains are not judged against "other observational studies". They are
judged against **a hypothetical randomised trial of the same question** — the
target trial. A cohort study is low risk of bias only if it is as trustworthy as
a well-conducted RCT would have been. That is a demanding bar and it is meant to
be: the whole point is that "good for an observational study" is not a standard
anybody can act on.

    Low        comparable to a well-performed randomised trial
    Moderate   sound for a non-randomised study, but not comparable to an RCT
    Serious    an important problem in at least one domain
    Critical   too problematic to provide useful evidence
    No information  no basis for a judgement

In practice almost nothing reaches Low, because confounding by indication is
almost never fully addressed. Strata's default judgement for a well-adjusted
cohort study is Moderate, and that is the correct answer, not a hedge.

Seven domains, split as the tool splits them, into pre-intervention,
at-intervention and post-intervention:

    D1  confounding                      (pre)
    D2  selection of participants        (pre)
    D3  classification of interventions   (at)
    D4  deviations from intended interventions   (post)
    D5  missing data                     (post)
    D6  measurement of outcomes          (post)
    D7  selection of the reported result (post)
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import signals as sig

LOW, MODERATE, SERIOUS, CRITICAL, NO_INFO = (
    "low", "moderate", "serious", "critical", "no information")

#: Ordered worst-last, so ``max`` over this list is the overall judgement.
_ORDER = [LOW, MODERATE, NO_INFO, SERIOUS, CRITICAL]

DOMAINS = {
    "D1": ("Bias due to confounding", "pre-intervention"),
    "D2": ("Bias in selection of participants into the study", "pre-intervention"),
    "D3": ("Bias in classification of interventions", "at intervention"),
    "D4": ("Bias due to deviations from intended interventions", "post-intervention"),
    "D5": ("Bias due to missing data", "post-intervention"),
    "D6": ("Bias in measurement of outcomes", "post-intervention"),
    "D7": ("Bias in selection of the reported result", "post-intervention"),
}


@dataclass
class Domain:
    id: str
    name: str
    stage: str
    judgement: str
    rationale: str
    basis: str = ""

    def as_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "stage": self.stage,
                "judgement": self.judgement, "rationale": self.rationale,
                "basis": self.basis}


@dataclass
class RobinsAssessment:
    instrument: str
    version: str
    overall: str
    rationale: str
    domains: list[Domain]
    limitations: list[str] = field(default_factory=list)

    @property
    def grade_delta(self) -> int:
        """What this costs under GRADE's risk-of-bias domain.

        Observational evidence already starts at low certainty in GRADE, so
        Moderate here — the normal result for a competent cohort study — costs
        nothing further. Serious and Critical do.
        """
        return {LOW: 0, MODERATE: 0, NO_INFO: -1, SERIOUS: -1, CRITICAL: -2}[self.overall]

    def as_dict(self) -> dict:
        return {"instrument": self.instrument, "version": self.version,
                "overall": self.overall, "rationale": self.rationale,
                "grade_delta": self.grade_delta,
                "domains": [d.as_dict() for d in self.domains],
                "limitations": self.limitations}


_SIGNAL_KEYS = ["confounding_adjusted", "propensity", "matched_design",
                "consecutive_enrolment", "exposure_validated",
                "attrition_reported", "low_attrition", "missing_data_handled",
                "blinded_assessors", "objective_outcome", "subjective_outcome",
                "registered", "protocol_available", "prespecified_outcome",
                "post_hoc", "follow_up_duration", "randomised"]


def assess(text: str, *, design_level: int = 3) -> RobinsAssessment:
    """Score an abstract against ROBINS-I.

    ``design_level`` is Strata's pyramid level; it distinguishes a cohort study
    (3) from a case-control or cross-sectional design (4), which differ in how
    D2 — selection into the study — is judged. Case-control sampling is
    outcome-dependent by construction, and that is a structural feature to be
    assessed, not a flaw to be discovered.
    """
    s = sig.detect(text, _SIGNAL_KEYS)
    domains: list[Domain] = []

    # --- D1 confounding -----------------------------------------------------
    if s["propensity"].present:
        d1 = Domain("D1", *DOMAINS["D1"],
                    judgement=MODERATE,
                    rationale="Propensity-based adjustment is described, which "
                              "addresses measured confounding. It cannot address "
                              "unmeasured confounding, and confounding by "
                              "indication is rarely fully measured — so this "
                              "does not reach the standard of a randomised "
                              "comparison.",
                    basis=s["propensity"].quote)
    elif s["confounding_adjusted"].present:
        d1 = Domain("D1", *DOMAINS["D1"], judgement=MODERATE,
                    rationale="Adjustment for measured confounders is described. "
                              "Residual and unmeasured confounding remain, which "
                              "is why a well-adjusted observational study is "
                              "moderate rather than low risk.",
                    basis=s["confounding_adjusted"].quote)
    elif s["confounding_adjusted"].absent:
        d1 = Domain("D1", *DOMAINS["D1"], judgement=SERIOUS,
                    rationale="The report states the analysis was unadjusted. In "
                              "a non-randomised comparison that is a serious "
                              "problem, not a minor one.",
                    basis=s["confounding_adjusted"].quote)
    else:
        d1 = Domain("D1", *DOMAINS["D1"], judgement=SERIOUS,
                    rationale="No adjustment for confounding is described. "
                              "Groups that were not randomised differ "
                              "systematically, and nothing in this report shows "
                              "that difference was accounted for.")
    domains.append(d1)

    # --- D2 selection -------------------------------------------------------
    if design_level >= 4:
        d2 = Domain("D2", *DOMAINS["D2"], judgement=SERIOUS,
                    rationale="Participants were sampled on the basis of the "
                              "outcome (case-control or cross-sectional "
                              "sampling). Selection is structurally related to "
                              "the outcome, which ROBINS-I treats as a serious "
                              "concern unless the control sampling is shown to "
                              "be independent of exposure.")
    elif s["consecutive_enrolment"].present:
        d2 = Domain("D2", *DOMAINS["D2"], judgement=LOW,
                    rationale="Consecutive or population-based enrolment, so "
                              "selection into the study is unlikely to depend on "
                              "intervention or outcome.",
                    basis=s["consecutive_enrolment"].quote)
    else:
        d2 = Domain("D2", *DOMAINS["D2"], judgement=MODERATE,
                    rationale="How participants entered the study is not "
                              "described, so selection related to intervention "
                              "or outcome cannot be excluded.")
    domains.append(d2)

    # --- D3 classification of interventions --------------------------------
    if s["exposure_validated"].present:
        d3 = Domain("D3", *DOMAINS["D3"], judgement=LOW,
                    rationale="Intervention status was ascertained from records "
                              "or a validated instrument, so misclassification "
                              "is unlikely to depend on the outcome.",
                    basis=s["exposure_validated"].quote)
    else:
        d3 = Domain("D3", *DOMAINS["D3"], judgement=MODERATE,
                    rationale="How intervention status was determined is not "
                              "described. If it was ascertained after the "
                              "outcome was known, differential misclassification "
                              "is possible.")
    domains.append(d3)

    # --- D4 deviations ------------------------------------------------------
    d4 = Domain("D4", *DOMAINS["D4"], judgement=MODERATE,
                rationale="Adherence and co-intervention are not described. In a "
                          "routine-care setting both differ between groups by "
                          "design — that is what routine care means — and the "
                          "abstract gives no basis for judging the effect.")
    domains.append(d4)

    # --- D5 missing data ----------------------------------------------------
    if s["low_attrition"].present:
        d5 = Domain("D5", *DOMAINS["D5"], judgement=LOW,
                    rationale="Follow-up was essentially complete.",
                    basis=s["low_attrition"].quote)
    elif s["missing_data_handled"].present:
        d5 = Domain("D5", *DOMAINS["D5"], judgement=MODERATE,
                    rationale="Missing data were addressed analytically; the "
                              "extent of missingness is not reported here.",
                    basis=s["missing_data_handled"].quote)
    elif s["low_attrition"].absent:
        d5 = Domain("D5", *DOMAINS["D5"], judgement=SERIOUS,
                    rationale="Substantial loss to follow-up with no described "
                              "analytic handling.", basis=s["low_attrition"].quote)
    else:
        d5 = Domain("D5", *DOMAINS["D5"], judgement=NO_INFO,
                    rationale="Completeness of data is not reported.")
    domains.append(d5)

    # --- D6 measurement of outcomes ----------------------------------------
    if s["objective_outcome"].present and not s["subjective_outcome"].present:
        d6 = Domain("D6", *DOMAINS["D6"], judgement=LOW,
                    rationale="The outcome is objective, so ascertainment is "
                              "unlikely to differ with knowledge of exposure.",
                    basis=s["objective_outcome"].quote)
    elif s["blinded_assessors"].present:
        d6 = Domain("D6", *DOMAINS["D6"], judgement=LOW,
                    rationale="Outcome assessment was masked to exposure.",
                    basis=s["blinded_assessors"].quote)
    elif s["subjective_outcome"].present:
        d6 = Domain("D6", *DOMAINS["D6"], judgement=SERIOUS,
                    rationale="A subjective outcome assessed without described "
                              "masking, in a study where assessors generally "
                              "know exposure status.",
                    basis=s["subjective_outcome"].quote)
    else:
        d6 = Domain("D6", *DOMAINS["D6"], judgement=MODERATE,
                    rationale="How the outcome was measured, and whether "
                              "assessors knew exposure status, is not described.")
    domains.append(d6)

    # --- D7 selective reporting --------------------------------------------
    if s["post_hoc"].present:
        d7 = Domain("D7", *DOMAINS["D7"], judgement=SERIOUS,
                    rationale="The reported result is described as post hoc or "
                              "exploratory.", basis=s["post_hoc"].quote)
    elif s["registered"].present or s["protocol_available"].present:
        d7 = Domain("D7", *DOMAINS["D7"], judgement=LOW,
                    rationale="A pre-registered protocol or analysis plan is "
                              "cited.",
                    basis=s["registered"].quote or s["protocol_available"].quote)
    else:
        d7 = Domain("D7", *DOMAINS["D7"], judgement=MODERATE,
                    rationale="No protocol or registration is cited. "
                              "Observational analyses are rarely pre-registered "
                              "and the number of analyses that could have been "
                              "run is large.")
    domains.append(d7)

    worst = max(domains, key=lambda d: _ORDER.index(d.judgement))
    overall = worst.judgement
    serious = [d for d in domains if d.judgement in (SERIOUS, CRITICAL)]
    silent = [d for d in domains if d.judgement == NO_INFO]

    if serious:
        rationale = (f"Overall {overall} risk of bias, driven by "
                     + ", ".join(f"{d.id} ({DOMAINS[d.id][0].lower()})"
                                 for d in serious)
                     + ". ROBINS-I takes the worst domain as the overall "
                       "judgement: a study cannot be more trustworthy than its "
                       "weakest link.")
    elif silent:
        rest = [d.judgement for d in domains if d.judgement != NO_INFO]
        worst_rest = (max(rest, key=_ORDER.index) if rest else "unassessable")
        rationale = ("Overall: no information. Nothing in the abstract bears on "
                     + ", ".join(f"{d.id} ({DOMAINS[d.id][0].lower()})"
                                 for d in silent)
                     + ", and ROBINS-I does not permit a domain with no "
                       "information to be scored as though it were adequate. "
                       f"Every other domain is {worst_rest} at worst, so the "
                       f"full report would very likely resolve this.")
    elif overall == MODERATE:
        rationale = ("Overall moderate risk of bias — sound for a "
                     "non-randomised study, but not comparable to a "
                     "well-performed randomised trial. That is the ceiling for "
                     "almost every observational study and is not a criticism "
                     "of this one.")
    else:
        rationale = ("Overall low risk of bias: on the evidence in the abstract "
                     "this study is comparable to a well-performed randomised "
                     "trial. This is a rare judgement and worth checking "
                     "against the full text.")

    return RobinsAssessment(
        instrument="ROBINS-I", version="2016 (Sterne et al., BMJ)",
        overall=overall, rationale=rationale, domains=domains,
        limitations=[
            "Assessed from the abstract alone; ROBINS-I expects the full report "
            "and a specified target trial.",
            "The confounders that matter are question-specific. Strata detects "
            "that adjustment happened, not whether the right variables were "
            "adjusted for — which is the judgement that actually decides D1.",
            "No target trial was specified, so 'deviations from intended "
            "intervention' is assessed generically.",
        ])
