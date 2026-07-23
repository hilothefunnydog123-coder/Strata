"""Risk-of-bias appraisal against the instruments the field actually uses.

GRADE tells you how much to trust a *body* of evidence. It does not tell you
what is wrong with an individual paper, and the domain-level judgement it asks
for — "is risk of bias serious?" — is meant to be the output of a real
instrument, not a vibe. This module runs four of them:

    RoB 2       randomised trials                      (Cochrane, 2019)
    ROBINS-I    non-randomised studies of interventions (Cochrane, 2016)
    AMSTAR-2    systematic reviews                      (Shea et al., 2017)
    QUADAS-2    diagnostic accuracy studies             (Whiting et al., 2011)

**Read this before you use the output.** These instruments are designed to be
completed from the full text, usually by two independent reviewers, often with
the protocol and the trial registration open alongside. Strata sees an abstract.
An abstract-only appraisal can find the things a paper *states*; it can never
establish the things a paper omits, and the distinction matters enormously —
"no allocation concealment" and "allocation concealment not described in the
abstract" are different findings and only one of them is a criticism.

So every signalling question defaults to **no information**, which is the
instruments' own answer for "the source does not say", and every answer other
than that must quote the text that produced it. Nothing is inferred from
absence. The result carries ``source="abstract"`` and a ``completeness`` figure
— the share of signalling questions the abstract could answer at all — and the
overall judgement is explicitly a *screening* judgement. A reviewer doing this
properly starts here and opens the PDF; they do not stop here.

    from strata import appraise
    a = appraise(article)
    a.instrument      # "RoB 2"
    a.overall         # "some concerns"
    a.completeness    # 0.6 — the abstract answered 6 of 10 signalling questions
    a.domains[0].signals[0].quote

Where the abstract is genuinely silent the honest output is a low completeness
and an overall judgement of "no information", and this module returns that
rather than manufacturing a verdict from nothing.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# The five-point answer scale RoB 2 and ROBINS-I share. Ordered from the answer
# that most favours the study to the one that most damages it, with the
# not-stated case sitting in the middle where it belongs — it is an absence of
# evidence, not evidence either way.
YES = "yes"
PROBABLY_YES = "probably yes"
NO_INFORMATION = "no information"
PROBABLY_NO = "probably no"
NO = "no"

ANSWER_ORDER = [YES, PROBABLY_YES, NO_INFORMATION, PROBABLY_NO, NO]

#: Overall judgements, per instrument, best first.
JUDGEMENTS = {
    "RoB 2": ["low", "some concerns", "high", "no information"],
    "ROBINS-I": ["low", "moderate", "serious", "critical", "no information"],
    "AMSTAR-2": ["high", "moderate", "low", "critically low"],
    "QUADAS-2": ["low", "unclear", "high"],
}


# --------------------------------------------------------------------- cues

@dataclass(frozen=True)
class Cue:
    """A phrase that answers a signalling question, and which way it answers it."""
    pattern: str
    answer: str
    note: str = ""

    def search(self, text: str) -> str | None:
        m = re.search(self.pattern, text, re.I)
        if not m:
            return None
        return _quote_around(text, m.start(), m.end())


def _quote_around(text: str, start: int, end: int, width: int = 46) -> str:
    """The matched phrase with enough context to be readable on its own.

    Trimmed to word boundaries: a quote that starts mid-word reads as a parsing
    bug and undermines the thing the quote exists to do, which is let a reviewer
    check the machine's reasoning in one glance.
    """
    lo = max(0, start - width)
    hi = min(len(text), end + width)
    snippet = text[lo:hi]
    if lo > 0:
        snippet = snippet.split(" ", 1)[-1]
    if hi < len(text):
        snippet = snippet.rsplit(" ", 1)[0]
    snippet = " ".join(snippet.split())
    return f"{'…' if lo > 0 else ''}{snippet}{'…' if hi < len(text) else ''}"


def _ask(text: str, cues: list[Cue]) -> tuple[str, str, str]:
    """First matching cue wins, so order them most-specific first.

    Returns (answer, quote, note). Falls through to "no information" — the
    abstract did not address this signalling question, which is the common case
    and is reported as such rather than guessed at.
    """
    for cue in cues:
        quote = cue.search(text)
        if quote is not None:
            return cue.answer, quote, cue.note
    return NO_INFORMATION, "", ""


# Shared cue vocabulary. Kept as module constants rather than inlined because
# several instruments ask overlapping questions — blinding appears in RoB 2
# domain 4 and QUADAS-2 domains 2 and 3 — and they must not drift apart.

_RANDOM_SEQUENCE = [
    Cue(r"computer[- ]generated (?:random(?:isation|ization)? )?(?:sequence|list|"
        r"numbers?|code)", YES),
    Cue(r"random(?:isation|ization) (?:sequence|list|schedule) was generated", YES),
    Cue(r"(?:permuted[- ]|variable )?block randomi[sz]ation", YES),
    Cue(r"stratified (?:block )?randomi[sz]ation", YES),
    Cue(r"random(?:ly)? (?:assigned|allocated) (?:in a )?1:1", PROBABLY_YES),
    Cue(r"random(?:ly)? (?:assigned|allocated)", PROBABLY_YES),
    Cue(r"randomi[sz]ed (?:controlled |clinical )?trial", PROBABLY_YES),
    Cue(r"alternate(?:ly)? (?:assigned|allocated)|assigned by (?:date of birth|"
        r"hospital number|day of the week)", NO,
        "quasi-random allocation is not randomisation"),
]

_ALLOCATION_CONCEALMENT = [
    Cue(r"central(?:ised|ized)? (?:randomi[sz]ation|allocation|telephone|web[- ]based)", YES),
    Cue(r"(?:sequentially numbered,? )?(?:sealed,? )?opaque(?:,? sealed)? envelopes?", YES),
    Cue(r"allocation (?:was )?conceal(?:ed|ment)", YES),
    Cue(r"interactive (?:voice|web) response system", YES),
    Cue(r"allocation was not concealed|investigators were aware of (?:the )?"
        r"(?:next )?assignment", NO),
]

_BLINDING = [
    Cue(r"quadruple[- ]blind|triple[- ]blind", YES),
    Cue(r"double[- ]blind(?:ed)?|double[- ]mask(?:ed)?", YES),
    Cue(r"participants(?:,| and) (?:investigators|clinicians|care providers)[^.]{0,40}"
        r"(?:were )?(?:blind|mask)", YES),
    Cue(r"placebo[- ]controlled", PROBABLY_YES,
        "a placebo control implies participant masking"),
    Cue(r"sham[- ](?:controlled|procedure|comparator)", PROBABLY_YES),
    Cue(r"single[- ]blind(?:ed)?", PROBABLY_NO,
        "single blinding leaves one party aware of assignment"),
    Cue(r"open[- ]label|unblinded|no blinding|without blinding", NO),
]

_OUTCOME_BLINDING = [
    Cue(r"(?:independent|blinded|masked) (?:end ?point |outcome )?adjudicat",
        YES),
    Cue(r"outcome assessors? (?:were )?(?:blind|mask)|assessors? (?:were )?"
        r"(?:blind|mask)ed", YES),
    Cue(r"(?:blinded|masked) (?:to|for) (?:treatment )?(?:allocation|assignment|"
        r"group|arm)", YES),
    Cue(r"(?:clinical )?end ?points? (?:were )?adjudicated by (?:an? )?"
        r"(?:independent |blinded )?committee", YES),
    Cue(r"(?:all[- ]cause )?mortality|death from any cause|overall survival",
        PROBABLY_YES, "death is not susceptible to assessor judgement"),
    Cue(r"self[- ]report(?:ed)?|patient[- ]reported outcome|questionnaire",
        PROBABLY_NO, "a subjective outcome in an unblinded design"),
]

_ITT = [
    Cue(r"intention[- ]to[- ]treat|intent[- ]to[- ]treat|\bITT\b", YES),
    Cue(r"modified intention[- ]to[- ]treat|\bmITT\b", PROBABLY_YES,
        "a modified ITT set excludes some randomised participants"),
    Cue(r"per[- ]protocol (?:analysis|population|set)", PROBABLY_NO,
        "per-protocol analysis breaks the randomisation"),
    Cue(r"complete[- ]case analysis", PROBABLY_NO),
]

_ATTRITION = [
    Cue(r"(?:no|zero) (?:participants? |patients? )?(?:were )?lost to follow[- ]up", YES),
    Cue(r"follow[- ]up (?:was )?(?:complete|available) for (?:9[0-9]|100)(?:\.\d+)?%",
        YES),
    Cue(r"(?:9[0-9]|100)(?:\.\d+)?% (?:of (?:participants|patients) )?completed", YES),
    Cue(r"multiple imputation|inverse probability weighting|"
        r"mixed[- ]effects? model for repeated measures", PROBABLY_YES,
        "missing data addressed analytically"),
    Cue(r"(?:[3-9]\d|[1-9]\d\d)(?:\.\d+)?% (?:were )?lost to follow[- ]up", NO,
        "substantial attrition"),
    Cue(r"lost to follow[- ]up|withdrew|discontinued|attrition", PROBABLY_YES,
        "attrition is reported, which is what the domain asks"),
]

_REGISTRATION = [
    Cue(r"\bNCT\d{8}\b", YES, "ClinicalTrials.gov registration cited"),
    Cue(r"\bISRCTN\d{8}\b|\bChiCTR[- ]?\w+|\bACTRN\d{14}\b|\bEudraCT\b|"
        r"\bUMIN\d{9}\b|\bDRKS\d{8}\b|\bCTRI/\d{4}", YES,
        "trial registry identifier cited"),
    Cue(r"\bPROSPERO\b|\bCRD42\d{9,}\b", YES, "review protocol registered"),
    Cue(r"prospectively registered|registered (?:before|prior to) (?:enrolment|"
        r"enrollment|recruitment)", YES),
    Cue(r"(?:pre[- ]?specified|primary) (?:end ?point|outcome) was", PROBABLY_YES),
    Cue(r"(?:protocol|study) (?:was )?registered|registration:", PROBABLY_YES),
    Cue(r"(?:post[- ]hoc|exploratory|secondary) analysis", PROBABLY_NO,
        "a post-hoc analysis is not a pre-specified result"),
    Cue(r"retrospectively registered", NO),
]

_CONFOUNDING = [
    Cue(r"instrumental variable|mendelian randomi[sz]ation", YES,
        "a design that addresses unmeasured confounding"),
    Cue(r"target trial emulation", YES),
    Cue(r"propensity[- ]score(?:d)?(?: matched| matching| weighted| adjustment)?", YES),
    Cue(r"inverse probability(?: of treatment)? weight", YES),
    Cue(r"multivariable (?:adjusted|regression|analysis|model)|"
        r"multivariate (?:adjusted|regression|model)", YES),
    Cue(r"adjusted for (?:age|sex|baseline|potential confounder|covariates|"
        r"the following)", YES),
    Cue(r"\ba(?:HR|OR|RR|IRR)\b|adjusted (?:hazard|odds|risk|rate) ratio",
        PROBABLY_YES, "an adjusted estimate is reported"),
    Cue(r"matched (?:on|for|by) ", PROBABLY_YES),
    Cue(r"(?:unadjusted|crude) (?:analysis|estimate|hazard|odds|risk)", PROBABLY_NO),
]

_SELECTION = [
    Cue(r"consecutive(?:ly)? (?:enrolled|recruited|included|sampled|"
        r"patients|participants)", YES),
    Cue(r"population[- ]based|nationwide (?:register|registry|cohort)|"
        r"all (?:patients|residents) in", YES),
    Cue(r"random(?:ly)? (?:selected|sampled) from", YES),
    Cue(r"consecutive series", PROBABLY_YES),
    Cue(r"convenience sample|volunteers were recruited", PROBABLY_NO),
    Cue(r"case[- ]control (?:study|design)", PROBABLY_NO,
        "a case-control sampling frame is itself a source of selection bias"),
]


# ----------------------------------------------------------------- structures

@dataclass
class Signal:
    """One signalling question and the answer the abstract supports.

    ``driver`` marks the questions that decide the domain. The instruments make
    this distinction and it matters: RoB 2's domain 1 turns on how the sequence
    was generated and concealed, while the baseline-balance question only speaks
    up when it has something bad to say. Treating a supporting question's silence
    as a mark against the study would leave almost no trial at low risk.
    """
    id: str
    question: str
    answer: str
    quote: str = ""
    note: str = ""
    driver: bool = True

    @property
    def informative(self) -> bool:
        return self.answer != NO_INFORMATION

    @property
    def unfavourable(self) -> bool:
        return self.answer in (NO, PROBABLY_NO)

    def as_dict(self) -> dict:
        return {"id": self.id, "question": self.question, "answer": self.answer,
                "quote": self.quote, "note": self.note, "driver": self.driver,
                "informative": self.informative}


@dataclass
class DomainJudgement:
    id: str
    name: str
    judgement: str
    signals: list[Signal] = field(default_factory=list)
    rationale: str = ""

    @property
    def answered(self) -> int:
        return sum(1 for s in self.signals if s.informative)

    def as_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "judgement": self.judgement,
                "rationale": self.rationale,
                "answered": self.answered, "total": len(self.signals),
                "signals": [s.as_dict() for s in self.signals]}


@dataclass
class Appraisal:
    """A completed — or, honestly, partially completed — instrument."""
    instrument: str
    reference: str
    applies_to: str
    overall: str
    overall_ceiling: str = ""
    domains: list[DomainJudgement] = field(default_factory=list)
    source: str = "abstract"
    caveats: list[str] = field(default_factory=list)

    def __post_init__(self):
        if not self.overall_ceiling:
            self.overall_ceiling = self.overall

    @property
    def is_bracketed(self) -> bool:
        """Whether the two ratings disagree — i.e. whether silence is doing work."""
        return self.overall != self.overall_ceiling

    @property
    def bracket(self) -> str:
        order = JUDGEMENTS[self.instrument]
        if not self.is_bracketed:
            return self.overall
        best, worst = sorted([self.overall, self.overall_ceiling],
                             key=lambda j: order.index(j) if j in order
                             else len(order))
        return f"{best} to {worst}"

    @property
    def signals(self) -> list[Signal]:
        return [s for d in self.domains for s in d.signals]

    @property
    def answered(self) -> int:
        return sum(1 for s in self.signals if s.informative)

    @property
    def total(self) -> int:
        return len(self.signals)

    @property
    def completeness(self) -> float:
        """Share of signalling questions the source could answer at all.

        The single most important number here. A "low risk of bias" built on two
        answered questions out of ten is not a finding, and a consumer of this
        output that ignores completeness will read confidence into silence.
        """
        return round(self.answered / self.total, 3) if self.total else 0.0

    @property
    def is_screening_only(self) -> bool:
        return self.source == "abstract"

    def concerns(self) -> list[Signal]:
        """The signalling questions that actively count against the study."""
        return [s for s in self.signals if s.answer in (NO, PROBABLY_NO)]

    def summary(self) -> str:
        noun = "confidence" if self.instrument == "AMSTAR-2" else "risk of bias"
        pct = int(round(self.completeness * 100))
        head = (f"{self.instrument}: {self.overall} {noun}" if not self.is_bracketed
                else f"{self.instrument}: {self.bracket} {noun}, depending on "
                     f"whether unreported methods were in fact carried out")
        return (f"{head} ({self.answered}/{self.total} signalling questions "
                f"answerable from the abstract, {pct}%)")

    def as_dict(self) -> dict:
        return {"instrument": self.instrument, "reference": self.reference,
                "applies_to": self.applies_to,
                "overall": self.overall, "overall_ceiling": self.overall_ceiling,
                "bracketed": self.is_bracketed, "bracket": self.bracket,
                "source": self.source, "screening_only": self.is_screening_only,
                "answered": self.answered, "total": self.total,
                "completeness": self.completeness,
                "summary": self.summary(), "caveats": self.caveats,
                "concerns": [s.as_dict() for s in self.concerns()],
                "domains": [d.as_dict() for d in self.domains]}


# --------------------------------------------------------------- RoB 2 (trials)

def _rob2(text: str) -> Appraisal:
    """Cochrane RoB 2 for randomised trials, five domains.

    The domain rules follow the published algorithm's shape: a domain is low risk
    only when its critical questions are answered favourably, high risk when one
    is answered unfavourably, and "some concerns" in between. Where the abstract
    answered nothing in a domain the domain is "no information" and says so,
    rather than defaulting to either end.
    """
    d1 = _domain("D1", "Randomisation process", [
        _signal("1.1", "Was the allocation sequence random?", text, _RANDOM_SEQUENCE),
        _signal("1.2", "Was the allocation sequence concealed until enrolment?",
                text, _ALLOCATION_CONCEALMENT),
        # RoB 2 phrases this one so that "yes" is the damaging answer. Every
        # other question here reads the other way round, and a scale that flips
        # direction between questions is how appraisals get miscoded by hand.
        # Asked in the favourable direction, scored in the shared rule.
        _signal("1.3", "Were baseline characteristics balanced, as successful "
                       "randomisation would produce?", text, [
            Cue(r"baseline (?:characteristics|demographics|variables)[^.]{0,40}"
                r"(?:were )?(?:similar|balanced|comparable|well[- ]matched)", YES),
            Cue(r"(?:groups|arms) were (?:well[- ])?(?:balanced|comparable|similar)",
                YES),
            Cue(r"(?:significant|notable|marked) (?:baseline )?imbalance|"
                r"differed (?:significantly )?at baseline", NO,
                "baseline imbalance suggests a failure of the randomisation process"),
        ], driver=False),
    ])

    d2 = _domain("D2", "Deviations from intended interventions", [
        _signal("2.1", "Were participants and carers aware of their assigned "
                       "intervention?", text, _BLINDING),
        _signal("2.2", "Was an appropriate analysis used to estimate the effect "
                       "of assignment?", text, _ITT),
    ])

    d3 = _domain("D3", "Missing outcome data", [
        _signal("3.1", "Were data available for all, or nearly all, participants?",
                text, _ATTRITION),
    ])

    d4 = _domain("D4", "Measurement of the outcome", [
        _signal("4.1", "Were outcome assessors blinded to the intervention "
                       "received?", text, _OUTCOME_BLINDING),
    ])

    d5 = _domain("D5", "Selection of the reported result", [
        _signal("5.1", "Was the trial analysed in accordance with a pre-specified "
                       "plan finalised before unblinded data were available?",
                text, _REGISTRATION),
    ])

    domains = [d1, d2, d3, d4, d5]
    overall, ceiling = _rate(domains, "RoB 2", worst="high",
                             middle="some concerns")
    return Appraisal(
        instrument="RoB 2",
        reference="Sterne JAC et al. RoB 2: a revised tool for assessing risk of "
                  "bias in randomised trials. BMJ 2019;366:l4898",
        applies_to="randomised controlled trial",
        overall=overall, overall_ceiling=ceiling, domains=domains)


# ------------------------------------------------------- ROBINS-I (non-randomised)

def _robins_i(text: str) -> Appraisal:
    """ROBINS-I, seven domains, for non-randomised studies of interventions.

    ROBINS-I judges a study against the hypothetical randomised trial it is
    trying to emulate, which is why its worst category is "critical" rather than
    "high": a study can be too compromised to contribute to a synthesis at all.
    Unmeasured confounding is the domain that usually decides it, and an
    abstract that reports no adjustment strategy cannot be graded low.
    """
    d1 = _domain("D1", "Confounding", [
        _signal("1.1", "Was the analysis based on splitting participants by "
                       "intervention received, with appropriate control for "
                       "confounding?", text, _CONFOUNDING),
        _signal("1.2", "Were confounding domains measured validly and reliably?",
                text, [
            Cue(r"validated (?:instrument|questionnaire|algorithm|measure)", YES),
            Cue(r"(?:medical|electronic health) records?|registry data|"
                r"linked administrative data", PROBABLY_YES),
            Cue(r"self[- ]reported (?:exposure|comorbid|history)", PROBABLY_NO),
        ]),
    ])

    d2 = _domain("D2", "Selection of participants into the study", [
        _signal("2.1", "Was selection into the study unrelated to intervention "
                       "or outcome?", text, _SELECTION),
        _signal("2.2", "Did start of follow-up and start of intervention "
                       "coincide?", text, [
            Cue(r"new[- ]user design|incident user|at (?:the )?time of "
                r"(?:treatment )?initiation", YES),
            Cue(r"prevalent users?|already receiving", PROBABLY_NO,
                "prevalent-user designs condition on survival"),
            Cue(r"immortal time", NO),
        ]),
    ])

    d3 = _domain("D3", "Classification of interventions", [
        _signal("3.1", "Were intervention groups clearly defined and recorded at "
                       "the start of the intervention?", text, [
            Cue(r"(?:defined|ascertained) (?:using|by) (?:ATC|ICD|CPT|"
                r"prescription|dispensing) (?:codes?|records?)", YES),
            Cue(r"pharmacy (?:dispensing|claims) (?:records?|data)", YES),
            Cue(r"exposure was defined as", PROBABLY_YES),
            Cue(r"self[- ]reported (?:use|treatment|medication)", PROBABLY_NO),
            Cue(r"recall(?:ed)? (?:their )?(?:use|exposure)", NO,
                "recall bias in exposure classification"),
        ]),
    ])

    d4 = _domain("D4", "Deviations from intended interventions", [
        _signal("4.1", "Were there deviations beyond what would be expected in "
                       "usual practice?", text, [
            Cue(r"as[- ]treated analysis", PROBABLY_NO),
            Cue(r"adherence (?:was |rates? )", PROBABLY_YES),
            Cue(r"intention[- ]to[- ]treat|intent[- ]to[- ]treat", YES),
        ]),
    ])

    d5 = _domain("D5", "Missing data", [
        _signal("5.1", "Were outcome data available for all, or nearly all, "
                       "participants?", text, _ATTRITION),
    ])

    d6 = _domain("D6", "Measurement of outcomes", [
        _signal("6.1", "Could the outcome measure have been influenced by "
                       "knowledge of the intervention received?",
                text, _OUTCOME_BLINDING),
    ])

    d7 = _domain("D7", "Selection of the reported result", [
        _signal("7.1", "Was the reported effect estimate selected from multiple "
                       "analyses of the data?", text, _REGISTRATION),
    ])

    # ROBINS-I is explicit that a study cannot be judged low risk overall unless
    # it is low risk in every domain, and confounding is the domain that most
    # often makes that impossible from an abstract.
    domains = [d1, d2, d3, d4, d5, d6, d7]
    overall, ceiling = _rate(domains, "ROBINS-I", worst="serious",
                             middle="moderate")
    caveats = []
    if d1.judgement in ("serious", "critical", "no information"):
        caveats.append("residual confounding is the dominant limitation of any "
                       "non-randomised comparison, and the abstract does not "
                       "establish that it was controlled")
    return Appraisal(
        instrument="ROBINS-I",
        reference="Sterne JA et al. ROBINS-I: a tool for assessing risk of bias "
                  "in non-randomised studies of interventions. BMJ 2016;355:i4919",
        applies_to="non-randomised study of an intervention",
        overall=overall, overall_ceiling=ceiling, domains=domains,
        caveats=caveats)


# ------------------------------------------------------- AMSTAR-2 (reviews)

#: The seven items AMSTAR-2 designates critical. A weakness in any one of them
#: caps overall confidence at "low"; two or more cap it at "critically low",
#: regardless of how well the review scores on everything else.
_AMSTAR_CRITICAL = {"2", "4", "7", "9", "11", "13", "15"}


def _amstar2(text: str) -> Appraisal:
    """AMSTAR-2 for systematic reviews, reduced to the items an abstract can bear on.

    The full instrument has sixteen items and most of them ask about the methods
    section. Nine are attempted here — the ones a structured abstract routinely
    reports — and the remaining seven are listed in the caveats rather than
    silently scored, because scoring an unanswerable item as "no" would turn
    every well-conducted review with a terse abstract into a bad one.
    """
    items = [
        _signal("2", "Did the report contain an explicit statement that the "
                     "review methods were established prior to the review, and "
                     "did the report justify any deviations?", text, [
            Cue(r"\bPROSPERO\b|\bCRD42\d{9,}\b", YES, "protocol registered"),
            Cue(r"(?:a )?(?:pre[- ]?specified |published )?protocol was "
                r"(?:registered|published)", YES),
            Cue(r"(?:following|according to|in accordance with) (?:the )?PRISMA",
                PROBABLY_YES, "PRISMA adherence stated, protocol not mentioned"),
        ]),
        _signal("4", "Did the review authors use a comprehensive literature "
                     "search strategy?", text, [
            Cue(r"(?:PubMed|MEDLINE)[^.]{0,80}(?:Embase|EMBASE)[^.]{0,80}"
                r"(?:Cochrane|CENTRAL|Web of Science|Scopus)", YES,
                "three or more databases searched"),
            Cue(r"(?:searched|search of)[^.]{0,60}(?:Embase|EMBASE)", PROBABLY_YES),
            Cue(r"grey literature|conference (?:abstracts|proceedings)|"
                r"trial registries were searched", YES),
            Cue(r"(?:we )?searched (?:PubMed|MEDLINE)\b(?![^.]{0,80}"
                r"(?:Embase|Cochrane))", PROBABLY_NO,
                "a single-database search is not comprehensive"),
        ]),
        _signal("5", "Did the review authors perform study selection in "
                     "duplicate?", text, [
            Cue(r"two (?:reviewers?|authors?|investigators?)[^.]{0,60}"
                r"independent(?:ly)?", YES),
            Cue(r"independent(?:ly)?[^.]{0,40}(?:screened|selected|extracted)", YES),
            Cue(r"in duplicate", YES),
        ]),
        _signal("9", "Did the review authors use a satisfactory technique for "
                     "assessing risk of bias?", text, [
            Cue(r"\bRoB[- ]?2\b|Cochrane risk[- ]of[- ]bias tool|"
                r"\bROBINS[- ]?I\b|\bQUADAS[- ]?2\b|Newcastle[- ]Ottawa", YES),
            Cue(r"risk of bias (?:was )?(?:assessed|evaluated|appraised)",
                PROBABLY_YES, "assessment stated, instrument not named"),
            Cue(r"(?:methodological )?quality (?:was )?assessed", PROBABLY_YES),
        ]),
        _signal("11", "Was an appropriate method used for statistical combination "
                      "of results?", text, [
            Cue(r"random[- ]effects? (?:model|meta[- ]analysis)", YES),
            Cue(r"DerSimonian[- ]?(?:and )?Laird|restricted maximum likelihood|"
                r"\bREML\b|Hartung[- ]Knapp", YES),
            Cue(r"fixed[- ]effects? (?:model|meta[- ]analysis)", PROBABLY_YES,
                "a fixed-effect model assumes one shared true effect"),
            Cue(r"narrative (?:synthesis|summary)|not pooled|"
                r"meta[- ]analysis was not (?:performed|possible)", YES,
                "declining to pool heterogeneous studies is the correct choice"),
        ]),
        _signal("13", "Did the review authors account for risk of bias in "
                      "individual studies when interpreting the results?", text, [
            Cue(r"sensitivity analys[ei]s[^.]{0,60}(?:risk of bias|quality|"
                r"high[- ]quality|low risk)", YES),
            Cue(r"(?:restricted|limited) to (?:studies at )?low risk of bias", YES),
            Cue(r"\bGRADE\b|certainty of (?:the )?evidence", PROBABLY_YES),
        ]),
        _signal("14", "Did the review authors provide a satisfactory explanation "
                      "for heterogeneity?", text, [
            Cue(r"(?:meta[- ]regression|subgroup analys[ei]s)[^.]{0,60}"
                r"(?:heterogeneity|explained)", YES),
            Cue(r"heterogeneity was (?:explored|investigated|explained)", YES),
            Cue(r"I\s*[²2]\s*(?:=|of|was)?\s*\d", PROBABLY_YES,
                "heterogeneity quantified but not necessarily explained"),
        ]),
        _signal("15", "Did the review authors carry out an adequate investigation "
                      "of publication bias?", text, [
            Cue(r"Egger'?s? (?:test|regression)|Begg'?s? test|trim[- ]and[- ]fill", YES),
            Cue(r"funnel plot", YES),
            Cue(r"publication bias (?:was )?(?:assessed|evaluated|examined)",
                PROBABLY_YES),
            Cue(r"publication bias (?:could not|was not) (?:be )?assessed",
                PROBABLY_NO, "stated but not performed"),
        ]),
    ]

    domain = DomainJudgement("items", "AMSTAR-2 items answerable from an abstract",
                             "", items)

    # AMSTAR-2's own rating rule: count weaknesses, weight the critical ones.
    # Run twice — once counting an unreported item as a weakness, which is what
    # the instrument specifies, and once assuming it was met. See _rate.
    overall, why = _amstar_rate(items, count_unreported=True)
    ceiling, _ = _amstar_rate(items, count_unreported=False)
    domain.judgement, domain.rationale = overall, why

    caveats = [
        "AMSTAR-2 has 16 items; 8 are attempted here. Items 1, 3, 6, 7, 8, 10, "
        "12 and 16 ask for material that lives in a methods section or a "
        "supplement — item 7's list of excluded studies is never in an abstract "
        "— and are left unscored rather than counted against the review.",
    ]
    unreported = [s for s in items
                  if s.id in _AMSTAR_CRITICAL and s.answer == NO_INFORMATION]
    if unreported:
        caveats.append(
            f"{len(unreported)} critical item(s) — "
            f"{', '.join(sorted(s.id for s in unreported))} — are counted "
            f"against this review only because the abstract is silent on them. "
            f"AMSTAR-2 scores 'not reported' as a weakness by design, since a "
            f"reader cannot rely on a safeguard they cannot see; the full text "
            f"may well show otherwise, which is what the ceiling rating of "
            f"'{ceiling}' represents.")
    return Appraisal(
        instrument="AMSTAR-2",
        reference="Shea BJ et al. AMSTAR 2: a critical appraisal tool for "
                  "systematic reviews. BMJ 2017;358:j4008",
        applies_to="systematic review / meta-analysis",
        overall=overall, overall_ceiling=ceiling, domains=[domain],
        caveats=caveats)


def _amstar_rate(items: list[Signal], *, count_unreported: bool) -> tuple[str, str]:
    """AMSTAR-2's published rating algorithm, applied to the attempted items."""
    weak = (NO, PROBABLY_NO) + ((NO_INFORMATION,) if count_unreported else ())
    critical = [s for s in items if s.id in _AMSTAR_CRITICAL and s.answer in weak]
    minor = [s for s in items
             if s.id not in _AMSTAR_CRITICAL and s.answer in (NO, PROBABLY_NO)]

    if len(critical) > 1:
        return ("critically low",
                f"{len(critical)} critical items unmet or unreported "
                f"({', '.join('item ' + s.id for s in critical)})")
    if len(critical) == 1:
        return "low", f"one critical item unmet or unreported (item {critical[0].id})"
    if len(minor) > 1:
        return "moderate", f"{len(minor)} non-critical weaknesses"
    if minor:
        return "moderate", f"one non-critical weakness (item {minor[0].id})"
    return "high", "no weakness identified in the items the abstract addresses"


# ------------------------------------------------------ QUADAS-2 (diagnostic)

def _quadas2(text: str) -> Appraisal:
    """QUADAS-2 for diagnostic accuracy studies, four domains.

    Only reached when the abstract looks like an accuracy study — see
    :func:`looks_diagnostic`. Diagnostic studies are graded badly by every
    intervention instrument, because the questions do not apply: there is no
    randomisation to assess and no intervention to deviate from.
    """
    d1 = _domain("D1", "Patient selection", [
        _signal("1.1", "Was a consecutive or random sample of patients enrolled?",
                text, _SELECTION),
        _signal("1.2", "Was a case-control design avoided?", text, [
            Cue(r"case[- ]control (?:study|design)", NO,
                "a two-gate design inflates apparent accuracy"),
            Cue(r"consecutive|cross[- ]sectional|cohort", YES),
        ]),
    ])
    d2 = _domain("D2", "Index test", [
        _signal("2.1", "Were the index test results interpreted without knowledge "
                       "of the reference standard?", text, [
            Cue(r"(?:readers?|interpreters?|radiologists?|pathologists?)[^.]{0,50}"
                r"blind(?:ed)?", YES),
            Cue(r"blinded to (?:the )?(?:reference standard|final diagnosis|"
                r"histopathology|clinical outcome)", YES),
            Cue(r"(?:were|was) (?:not )?aware of", PROBABLY_NO),
        ]),
        _signal("2.2", "Was a threshold pre-specified?", text, [
            Cue(r"pre[- ]?(?:specified|defined) (?:threshold|cut[- ]?off)", YES),
            Cue(r"(?:optimal|best) (?:threshold|cut[- ]?off) was (?:determined|"
                r"derived|selected)|Youden(?:'s)? index", NO,
                "a threshold optimised on the same data overstates accuracy"),
        ]),
    ])
    d3 = _domain("D3", "Reference standard", [
        _signal("3.1", "Is the reference standard likely to classify the target "
                       "condition correctly?", text, [
            Cue(r"histopatholog|biopsy[- ]confirmed|autopsy|"
                r"culture[- ]confirmed|gold standard", YES),
            Cue(r"reference standard was", PROBABLY_YES),
            Cue(r"clinical diagnosis|expert (?:panel|consensus)", PROBABLY_YES),
        ]),
        _signal("3.2", "Were reference standard results interpreted without "
                       "knowledge of the index test?", text, [
            Cue(r"blinded to (?:the )?(?:index test|results? of the)", YES),
            Cue(r"independent(?:ly)? (?:assessed|reviewed|interpreted)", PROBABLY_YES),
        ]),
    ])
    d4 = _domain("D4", "Flow and timing", [
        _signal("4.1", "Did all patients receive a reference standard?", text, [
            Cue(r"all (?:patients|participants) (?:underwent|received)[^.]{0,40}"
                r"(?:reference standard|biopsy|confirmatory)", YES),
            Cue(r"(?:differential|partial) verification|only (?:test[- ]?positive|"
                r"positive) (?:patients|cases) (?:underwent|were referred)", NO,
                "verification bias"),
        ]),
        _signal("4.2", "Were all patients included in the analysis?", text,
                _ATTRITION),
    ])

    domains = [d1, d2, d3, d4]
    overall, ceiling = _rate(domains, "QUADAS-2", worst="high", middle="unclear",
                             nodata="unclear")
    return Appraisal(
        instrument="QUADAS-2",
        reference="Whiting PF et al. QUADAS-2: a revised tool for the quality "
                  "assessment of diagnostic accuracy studies. Ann Intern Med "
                  "2011;155:529-36",
        applies_to="diagnostic accuracy study",
        overall=overall, overall_ceiling=ceiling, domains=domains)


# -------------------------------------------------------------------- helpers

def _signal(sid: str, question: str, text: str, cues: list[Cue], *,
            driver: bool = True) -> Signal:
    answer, quote, note = _ask(text, cues)
    return Signal(id=sid, question=question, answer=answer, quote=quote,
                  note=note, driver=driver)


def _grade_domain(d: DomainJudgement, *, worst: str, middle: str,
                  best: str = "low", nodata: str = "no information",
                  optimistic: bool = False) -> tuple[str, str]:
    """The judgement rule all four instruments share, with their own labels.

    An unfavourable answer decides the domain immediately — a firm "no" is worse
    than a "probably no", and neither is rescued by the other questions. Absent
    that, the domain is at best risk only when every *driver* question was
    answered favourably; supporting questions may be silent without penalty.

    ``optimistic`` reads every unanswered question as though the full text would
    have answered it favourably. It produces the ceiling of :func:`_rate`'s
    bracket and is never the headline judgement.
    """
    unfavourable = [s for s in d.signals if s.unfavourable]
    if unfavourable:
        firm = next((s for s in unfavourable if s.answer == NO), None)
        s = firm or unfavourable[0]
        return ((worst if firm else middle),
                s.note or f"signalling question {s.id} answered '{s.answer}'")

    ok = (YES, PROBABLY_YES) + ((NO_INFORMATION,) if optimistic else ())
    drivers = [s for s in d.signals if s.driver] or d.signals
    if all(s.answer in ok for s in drivers):
        quoted = next((s for s in drivers if s.quote), None)
        return best, ("every driver question is answered favourably"
                      + (f" — {quoted.quote}" if quoted else ""))
    if not any(s.informative for s in d.signals):
        return nodata, "the abstract does not address this domain"
    return middle, "the abstract answers this domain only in part"


def _rate(domains: list[DomainJudgement], instrument: str, *, worst: str,
          middle: str, nodata: str = "no information") -> tuple[str, str]:
    """Judge every domain and return (as-reported, ceiling).

    Two ratings, because from an abstract there is genuinely no single right
    answer. The first takes the source at its word: a safeguard that is not
    described cannot be relied on, which is what the instruments mean when they
    score silence against a study. The second assumes every unreported safeguard
    was in fact in place and simply did not fit in 250 words.

    The truth for any given paper is somewhere in that bracket, and reporting
    both is the only presentation that does not mislead. A narrow bracket means
    the abstract was informative and the judgement is close to a real appraisal;
    a wide one means the abstract said very little and the only defensible next
    step is to open the paper.
    """
    for d in domains:
        d.judgement, d.rationale = _grade_domain(d, worst=worst, middle=middle,
                                                 nodata=nodata)
    strict = _worst([d.judgement for d in domains], instrument, middle=middle)
    ceiling = _worst(
        [_grade_domain(d, worst=worst, middle=middle, nodata=nodata,
                       optimistic=True)[0] for d in domains],
        instrument, middle=middle)
    return strict, ceiling


def _domain(did: str, name: str, signals: list[Signal]) -> DomainJudgement:
    return DomainJudgement(id=did, name=name, judgement="", signals=signals)


def _worst(judgements: list[str], instrument: str, *, middle: str) -> str:
    """The overall judgement is the worst domain judgement — no averaging.

    This is what every one of these instruments specifies, and it is the right
    rule: a trial with impeccable randomisation and unblinded subjective outcome
    assessment is at high risk of bias, and a mean would hide that.

    "No information" is not a fifth point on the scale, it is the absence of one,
    so it is handled separately: a study cannot be called low risk overall while
    a whole domain is unaddressed, but neither is silence the same accusation as
    a domain that was assessed and failed. It caps the overall judgement at the
    instrument's middle category and no further.
    """
    order = JUDGEMENTS[instrument]
    determined = [j for j in judgements if j in order and j != "no information"]
    if not determined:
        return "no information" if "no information" in order else middle
    result = max(determined, key=order.index)
    if any(j == "no information" for j in judgements):
        result = max([result, middle], key=order.index)
    return result


_DIAGNOSTIC_RE = re.compile(
    r"\b(sensitivity and specificity|diagnostic accuracy|area under the (?:ROC )?"
    r"curve|\bAUROC\b|receiver[- ]operating|positive predictive value|"
    r"negative predictive value|likelihood ratio of a positive|index test|"
    r"reference standard)\b", re.I)


def looks_diagnostic(text: str) -> bool:
    """Whether the abstract reads as a diagnostic accuracy study.

    Two independent cues are required. "Sensitivity" alone appears in sensitivity
    *analyses* throughout the trial literature, and a single-cue rule
    misclassifies a large share of RCTs into an instrument that does not fit them.
    """
    return len(set(m.group(0).lower() for m in _DIAGNOSTIC_RE.finditer(text or ""))) >= 2


# ----------------------------------------------------------------- the entry point

#: Pyramid level -> instrument. Levels 5-7 have no validated instrument for what
#: they are: a case report is not biased, it is a description, and appraising it
#: with RoB 2 would produce a number that means nothing.
_BY_LEVEL = {1: "AMSTAR-2", 2: "RoB 2", 3: "ROBINS-I", 4: "ROBINS-I"}

_BUILDERS = {"RoB 2": _rob2, "ROBINS-I": _robins_i,
             "AMSTAR-2": _amstar2, "QUADAS-2": _quadas2}


def appraise(article, grade=None, *, instrument: str | None = None) -> Appraisal | None:
    """Run the instrument that fits this study design.

    ``article`` may be a :class:`strata.pubmed.Article` or a plain string.
    ``grade`` is a :class:`strata.evidence.Grade`; when omitted the design is
    inferred from the text alone, which is less reliable than PubMed's
    indexer-assigned publication types and should be avoided where a grade
    exists.

    Returns ``None`` for designs no instrument covers — case reports, editorials
    and preclinical work — rather than forcing one on. That is not a gap; it is
    the instruments correctly declining to apply.
    """
    text = article.text() if hasattr(article, "text") else str(article or "")
    if not text.strip():
        return None

    if instrument is None:
        if looks_diagnostic(text):
            instrument = "QUADAS-2"
        elif grade is not None:
            instrument = _BY_LEVEL.get(grade.level)
        else:
            instrument = _infer_instrument(text)

    builder = _BUILDERS.get(instrument or "")
    if builder is None:
        return None

    appraisal = builder(text)
    if getattr(article, "is_retracted", False):
        appraisal.caveats.insert(
            0, "this paper has been retracted; a risk-of-bias judgement on a "
               "withdrawn result is of historical interest only")
    if appraisal.completeness < 0.4:
        appraisal.caveats.append(
            f"the abstract answered only {appraisal.answered} of "
            f"{appraisal.total} signalling questions — treat this as a triage "
            f"signal for full-text review, not as an appraisal")
    return appraisal


def _infer_instrument(text: str) -> str | None:
    head = text[:600].lower()
    if re.search(r"\b(systematic review|meta[- ]analys[ei]s)\b", head):
        return "AMSTAR-2"
    if re.search(r"\brandomi[sz]ed\b|\brandomly (?:assigned|allocated)\b", head):
        return "RoB 2"
    if re.search(r"\b(cohort|case[- ]control|cross[- ]sectional|"
                 r"observational|registry)\b", head):
        return "ROBINS-I"
    return None


def appraise_all(evidence) -> list[tuple[object, Appraisal | None]]:
    """Appraise a ranked evidence list, pairing each item with its instrument."""
    out = []
    for e in evidence:
        article = getattr(e, "article", e)
        grade = getattr(e, "grade", None)
        out.append((e, appraise(article, grade)))
    return out
