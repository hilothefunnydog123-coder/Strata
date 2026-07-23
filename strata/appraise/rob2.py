"""Cochrane RoB 2 — risk of bias in randomised trials, at the abstract level.

RoB 2 is the instrument Cochrane requires for randomised trials. It asks a fixed
set of signalling questions in five domains, answers each Yes / Probably yes /
Probably no / No / No information, and derives a domain judgement from the
answers by a published algorithm. Strata implements that algorithm exactly. What
it cannot implement is a human reading the full text, the protocol and the
statistical analysis plan.

**So read what this produces as a screen, not an appraisal.** It is calibrated to
be conservative in one specific direction: silence in an abstract raises concerns
and never establishes high risk. An abstract that does not mention allocation
concealment is not a trial with inadequate concealment — abstracts are 250 words
and concealment is usually described in the methods section of the full paper.
Treating silence as failure would mark ninety per cent of the literature high
risk, which is both wrong and useless.

What it *is* good for, and what no clinician has time to do by hand: appraising
two hundred trials in eight seconds to find the twelve worth reading closely, and
attaching a documented, quotable reason to each judgement.

Domains, following the published tool:

    D1  the randomisation process
    D2  deviations from intended interventions (effect of assignment)
    D3  missing outcome data
    D4  measurement of the outcome
    D5  selection of the reported result

Every signalling question records the sentence that decided it. Where nothing in
the abstract bears on a question the answer is "no information", which is a real
answer in RoB 2 and is propagated as one rather than being guessed.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import signals as sig

#: RoB 2's answer set. "NI" is not a missing value — it is a judgement that the
#: report does not say, and the algorithm treats it differently from "No".
ANSWERS = ("Y", "PY", "PN", "N", "NI")

LOW, SOME, HIGH = "low", "some concerns", "high"

_JUDGEMENT_ORDER = [LOW, SOME, HIGH]

DOMAIN_NAMES = {
    "D1": "Bias arising from the randomisation process",
    "D2": "Bias due to deviations from intended interventions",
    "D3": "Bias due to missing outcome data",
    "D4": "Bias in measurement of the outcome",
    "D5": "Bias in selection of the reported result",
}


@dataclass
class Question:
    id: str
    text: str
    answer: str                       # one of ANSWERS
    basis: str = ""                   # the sentence that decided it

    @property
    def affirmative(self) -> bool:
        return self.answer in ("Y", "PY")

    @property
    def negative(self) -> bool:
        return self.answer in ("N", "PN")

    def as_dict(self) -> dict:
        return {"id": self.id, "question": self.text, "answer": self.answer,
                "basis": self.basis}


@dataclass
class DomainJudgement:
    id: str
    name: str
    judgement: str                    # low | some concerns | high
    rationale: str
    questions: list[Question] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "judgement": self.judgement,
                "rationale": self.rationale,
                "signalling_questions": [q.as_dict() for q in self.questions]}


@dataclass
class Rob2Assessment:
    instrument: str
    version: str
    overall: str
    rationale: str
    domains: list[DomainJudgement]
    limitations: list[str] = field(default_factory=list)
    applicable: bool = True

    @property
    def worst_domain(self) -> DomainJudgement | None:
        if not self.domains:
            return None
        return max(self.domains, key=lambda d: _JUDGEMENT_ORDER.index(d.judgement))

    #: What this assessment costs the body of evidence under GRADE.
    @property
    def grade_delta(self) -> int:
        return {LOW: 0, SOME: 0, HIGH: -1}[self.overall]

    def as_dict(self) -> dict:
        return {"instrument": self.instrument, "version": self.version,
                "applicable": self.applicable,
                "overall": self.overall, "rationale": self.rationale,
                "grade_delta": self.grade_delta,
                "domains": [d.as_dict() for d in self.domains],
                "limitations": self.limitations}


# --------------------------------------------------------------------- domains

def _d1(s: dict) -> DomainJudgement:
    rand, seq = s["randomised"], s["sequence_generation"]
    conceal = s["allocation_concealed"]

    if rand.absent:
        q11 = Question("1.1", "Was the allocation sequence random?", "N",
                       rand.quote)
    elif seq.present:
        q11 = Question("1.1", "Was the allocation sequence random?", "Y",
                       seq.quote)
    elif rand.present:
        q11 = Question("1.1", "Was the allocation sequence random?", "PY",
                       rand.quote)
    else:
        q11 = Question("1.1", "Was the allocation sequence random?", "NI")

    if conceal.present:
        q12 = Question("1.2", "Was the allocation sequence concealed until "
                              "participants were enrolled and assigned?", "Y",
                       conceal.quote)
    elif conceal.absent:
        q12 = Question("1.2", "Was the allocation sequence concealed until "
                              "participants were enrolled and assigned?", "N",
                       conceal.quote)
    else:
        q12 = Question("1.2", "Was the allocation sequence concealed until "
                              "participants were enrolled and assigned?", "NI")

    # 1.3 asks about baseline imbalance. An abstract that reports balanced
    # baseline characteristics is unusual; one that reports imbalance is rarer
    # still. Absent either, the honest answer is that we do not know.
    q13 = Question("1.3", "Did baseline differences suggest a problem with the "
                          "randomisation process?", "NI")

    if q11.negative:
        return DomainJudgement("D1", DOMAIN_NAMES["D1"], HIGH,
                               "The report states the allocation was not random.",
                               [q11, q12, q13])
    if q11.affirmative and q12.answer == "Y":
        return DomainJudgement("D1", DOMAIN_NAMES["D1"], LOW,
                               "Random sequence generation and concealed "
                               "allocation are both described.", [q11, q12, q13])
    if q12.negative:
        return DomainJudgement("D1", DOMAIN_NAMES["D1"], HIGH,
                               "The report indicates allocation was not "
                               "concealed.", [q11, q12, q13])
    return DomainJudgement(
        "D1", DOMAIN_NAMES["D1"], SOME,
        "Randomisation is stated but the abstract does not describe how the "
        "sequence was generated or concealed. This is very often described in "
        "the full text; the concern is with the report, not necessarily the "
        "trial.", [q11, q12, q13])


def _d2(s: dict) -> DomainJudgement:
    blind_p, double, itt = s["blinded_participants"], s["double_blind"], s["itt"]
    aware = "NI"
    basis = ""
    if double.present or blind_p.present:
        aware, basis = "N", (double.quote or blind_p.quote)
    elif blind_p.absent:
        aware, basis = "Y", blind_p.quote

    q21 = Question("2.1", "Were participants aware of their assigned "
                          "intervention during the trial?", aware, basis)
    q22 = Question("2.2", "Were carers and people delivering the interventions "
                          "aware of participants' assigned intervention?",
                   aware, basis)

    if itt.present:
        q26 = Question("2.6", "Was an appropriate analysis used to estimate the "
                              "effect of assignment to intervention?", "Y",
                       itt.quote)
    elif s["per_protocol"].present:
        q26 = Question("2.6", "Was an appropriate analysis used to estimate the "
                              "effect of assignment to intervention?", "PN",
                       s["per_protocol"].quote)
    else:
        q26 = Question("2.6", "Was an appropriate analysis used to estimate the "
                              "effect of assignment to intervention?", "NI")

    qs = [q21, q22, q26]
    if aware == "N" and q26.answer == "Y":
        return DomainJudgement("D2", DOMAIN_NAMES["D2"], LOW,
                               "Participants and providers were masked and the "
                               "analysis was by intention to treat.", qs)
    if aware == "Y" and q26.negative:
        return DomainJudgement("D2", DOMAIN_NAMES["D2"], HIGH,
                               "An open-label trial analysed per protocol: both "
                               "the opportunity for deviation and an analysis "
                               "that does not preserve randomisation.", qs)
    if aware == "Y":
        return DomainJudgement("D2", DOMAIN_NAMES["D2"], SOME,
                               "The trial was open-label, so deviations arising "
                               "from knowledge of assignment cannot be excluded.",
                               qs)
    return DomainJudgement("D2", DOMAIN_NAMES["D2"], SOME,
                           "The abstract does not establish whether participants "
                           "and providers were masked, nor that the analysis "
                           "preserved the randomised comparison.", qs)


def _d3(s: dict) -> DomainJudgement:
    low_att, attr = s["low_attrition"], s["attrition_reported"]
    handled = s["missing_data_handled"]

    if low_att.present:
        q31 = Question("3.1", "Were data for this outcome available for all, or "
                              "nearly all, participants randomised?", "Y",
                       low_att.quote)
    elif low_att.absent:
        q31 = Question("3.1", "Were data for this outcome available for all, or "
                              "nearly all, participants randomised?", "N",
                       low_att.quote)
    elif attr.present:
        q31 = Question("3.1", "Were data for this outcome available for all, or "
                              "nearly all, participants randomised?", "NI",
                       attr.quote)
    else:
        q31 = Question("3.1", "Were data for this outcome available for all, or "
                              "nearly all, participants randomised?", "NI")

    q32 = Question("3.2", "Is there evidence that the result was not biased by "
                          "missing outcome data?",
                   "Y" if handled.present else "NI",
                   handled.quote if handled.present else "")

    qs = [q31, q32]
    if q31.answer == "Y":
        return DomainJudgement("D3", DOMAIN_NAMES["D3"], LOW,
                               "Outcome data were available for nearly all "
                               "participants.", qs)
    if q31.answer == "N" and q32.answer != "Y":
        return DomainJudgement("D3", DOMAIN_NAMES["D3"], HIGH,
                               "Substantial loss to follow-up with no analysis "
                               "addressing it.", qs)
    if q32.answer == "Y":
        return DomainJudgement("D3", DOMAIN_NAMES["D3"], SOME,
                               "Missing data were addressed analytically, but "
                               "the abstract does not report how much was "
                               "missing.", qs)
    return DomainJudgement("D3", DOMAIN_NAMES["D3"], SOME,
                           "Completeness of outcome data is not reported in the "
                           "abstract.", qs)


def _d4(s: dict) -> DomainJudgement:
    assessors, double = s["blinded_assessors"], s["double_blind"]
    objective, subjective = s["objective_outcome"], s["subjective_outcome"]

    q41 = Question("4.1", "Was the method of measuring the outcome "
                          "inappropriate?", "PN")
    q42 = Question("4.2", "Could measurement of the outcome have differed "
                          "between intervention groups?", "NI")

    if assessors.present or double.present:
        q43 = Question("4.3", "Were outcome assessors aware of the intervention "
                              "received?", "N", assessors.quote or double.quote)
    elif assessors.absent:
        q43 = Question("4.3", "Were outcome assessors aware of the intervention "
                              "received?", "Y", assessors.quote)
    else:
        q43 = Question("4.3", "Were outcome assessors aware of the intervention "
                              "received?", "NI")

    # 4.4/4.5 turn on how much judgement the outcome takes. Death is death
    # whoever measures it; a symptom score is not.
    if objective.present and not subjective.present:
        q44 = Question("4.4", "Could assessment of the outcome have been "
                              "influenced by knowledge of the intervention "
                              "received?", "PN", objective.quote)
    elif subjective.present:
        q44 = Question("4.4", "Could assessment of the outcome have been "
                              "influenced by knowledge of the intervention "
                              "received?", "PY", subjective.quote)
    else:
        q44 = Question("4.4", "Could assessment of the outcome have been "
                              "influenced by knowledge of the intervention "
                              "received?", "NI")

    qs = [q41, q42, q43, q44]
    if q43.answer == "N":
        return DomainJudgement("D4", DOMAIN_NAMES["D4"], LOW,
                               "Outcome assessment was masked.", qs)
    if q43.answer == "Y" and q44.affirmative:
        return DomainJudgement("D4", DOMAIN_NAMES["D4"], HIGH,
                               "Unmasked assessors judging a subjective outcome "
                               "— the combination detection bias is named for.",
                               qs)
    if q44.answer == "PN":
        return DomainJudgement("D4", DOMAIN_NAMES["D4"], LOW,
                               "The outcome is objective, so masking of "
                               "assessors matters much less.", qs)
    return DomainJudgement("D4", DOMAIN_NAMES["D4"], SOME,
                           "Masking of outcome assessment is not described.", qs)


def _d5(s: dict) -> DomainJudgement:
    reg, proto = s["registered"], s["protocol_available"]
    prespec, post_hoc = s["prespecified_outcome"], s["post_hoc"]

    if proto.present or reg.present:
        q51 = Question("5.1", "Were the data analysed in accordance with a "
                              "pre-specified plan finalised before unblinded "
                              "outcome data were available?", "PY",
                       proto.quote or reg.quote)
    elif reg.absent:
        q51 = Question("5.1", "Were the data analysed in accordance with a "
                              "pre-specified plan finalised before unblinded "
                              "outcome data were available?", "N", reg.quote)
    else:
        q51 = Question("5.1", "Were the data analysed in accordance with a "
                              "pre-specified plan finalised before unblinded "
                              "outcome data were available?", "NI")

    q52 = Question("5.2", "Is the reported result likely to have been selected "
                          "from multiple eligible outcome measurements?",
                   "PY" if post_hoc.present else
                   ("PN" if prespec.present else "NI"),
                   post_hoc.quote or prespec.quote)
    q53 = Question("5.3", "Is the reported result likely to have been selected "
                          "from multiple eligible analyses?",
                   "PY" if post_hoc.present else "NI", post_hoc.quote)

    qs = [q51, q52, q53]
    if q51.affirmative and q52.answer == "PN":
        return DomainJudgement("D5", DOMAIN_NAMES["D5"], LOW,
                               "Prospective registration and a pre-specified "
                               "primary outcome.", qs)
    if post_hoc.present:
        return DomainJudgement("D5", DOMAIN_NAMES["D5"], HIGH,
                               "The reported result is described as post hoc or "
                               "exploratory.", qs)
    if q51.answer == "N":
        return DomainJudgement("D5", DOMAIN_NAMES["D5"], HIGH,
                               "The report states the trial was not registered.",
                               qs)
    return DomainJudgement("D5", DOMAIN_NAMES["D5"], SOME,
                           "No trial registration or protocol is cited in the "
                           "abstract, so selective reporting cannot be excluded.",
                           qs)


_DOMAIN_FNS = (_d1, _d2, _d3, _d4, _d5)

_SIGNAL_KEYS = [
    "randomised", "sequence_generation", "allocation_concealed", "double_blind",
    "blinded_participants", "blinded_assessors", "itt", "per_protocol",
    "attrition_reported", "low_attrition", "missing_data_handled", "registered",
    "protocol_available", "prespecified_outcome", "post_hoc",
    "objective_outcome", "subjective_outcome",
]

#: Three domains at "some concerns" is where Cochrane's guidance says confidence
#: in the result is substantially lowered even without any single domain being
#: high. Below that threshold the overall judgement stays at some concerns.
_SOME_CONCERNS_TO_HIGH = 3


def assess(text: str, *, is_randomised: bool = True) -> Rob2Assessment:
    """Score an abstract against RoB 2.

    ``is_randomised`` should come from the design classifier, not from this
    text: RoB 2 applies only to randomised trials, and running it on a cohort
    study produces a confident-looking assessment of the wrong thing. Use
    :mod:`strata.appraise.robins_i` for non-randomised studies.
    """
    s = sig.detect(text, _SIGNAL_KEYS)

    if not is_randomised and not s["randomised"].present:
        return Rob2Assessment(
            instrument="Cochrane RoB 2", version="2019 (22 August)",
            applicable=False, overall=SOME,
            rationale="RoB 2 applies to randomised trials. This study does not "
                      "appear to be one; ROBINS-I is the appropriate instrument.",
            domains=[], limitations=["not a randomised trial"])

    domains = [fn(s) for fn in _DOMAIN_FNS]
    highs = [d for d in domains if d.judgement == HIGH]
    somes = [d for d in domains if d.judgement == SOME]

    if highs:
        overall = HIGH
        rationale = (f"High risk of bias in {len(highs)} domain"
                     f"{'s' if len(highs) > 1 else ''}: "
                     + "; ".join(f"{d.id} — {d.rationale.rstrip('.')}"
                                 for d in highs) + ".")
    elif len(somes) >= _SOME_CONCERNS_TO_HIGH:
        overall = HIGH
        rationale = (f"No single domain is high risk, but {len(somes)} of five "
                     f"raise concerns ({', '.join(d.id for d in somes)}), which "
                     f"together substantially lowers confidence in the result. "
                     f"Note that abstracts are short: several of these concerns "
                     f"may resolve on reading the full text.")
    elif somes:
        overall = SOME
        rationale = ("Some concerns in "
                     + ", ".join(d.id for d in somes)
                     + "; no domain reaches high risk.")
    else:
        overall = LOW
        rationale = "Low risk of bias in all five domains."

    return Rob2Assessment(
        instrument="Cochrane RoB 2", version="2019 (22 August)",
        overall=overall, rationale=rationale, domains=domains,
        limitations=[
            "Assessed from the abstract alone. RoB 2 is designed to be applied "
            "to the full report, the protocol and the analysis plan.",
            "Silence is scored as 'no information', never as failure — the "
            "judgements below understate risk in poorly reported trials and "
            "should not be read as a quality ranking.",
            "Domain 2 is assessed for the effect of assignment to intervention "
            "(the intention-to-treat estimand), not adherence.",
        ])
