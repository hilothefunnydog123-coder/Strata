"""EQUATOR reporting-guideline compliance: did the abstract say what it must?

Named for the EQUATOR network, which maintains these checklists. It sits at the
top level rather than inside :mod:`strata.reporting` because the two answer
opposite questions: ``strata.reporting`` *emits* regulated artefacts — a PRISMA
flow diagram, a Summary of Findings table — describing work Strata has done,
while this *assesses* an incoming abstract against the checklist its design is
governed by. One is rendering, the other is appraisal.

Risk of bias asks whether a study was *done* well. This asks something narrower
and much more reliably answerable from an abstract: whether it was *reported*
according to the guideline that governs its design. The EQUATOR network's
checklists all have an abstract-specific extension precisely because the abstract
is what most readers read and what every screening process sees first.

    CONSORT for Abstracts   randomised trials              17 items
    PRISMA 2020 for Abstracts   systematic reviews         12 items
    STROBE (abstract item)  observational studies           9 items
    CARE                    case reports                    8 items
    ARRIVE 2.0 (essential)  animal research                 8 items

Why this is worth computing separately from risk of bias: it is a much cleaner
measurement. "Does the abstract state the primary outcome?" has a determinate
answer in the text in front of you. "Was allocation adequately concealed?" does
not — the abstract's silence is compatible with excellent and terrible practice
alike. Compliance is therefore reported as a percentage with a straight face,
where a risk-of-bias judgement from an abstract is reported with a paragraph of
caveats.

It is also the number that moves. Journals and funders act on reporting
compliance; a medical-affairs team can hand an author a list of eight missing
CONSORT-A items and get them fixed before submission, which is not true of
anything else in this codebase.

The one thing it must not be read as: a quality score. A perfectly reported
trial can be a badly designed one, and a landmark trial published in 1987 will
score poorly against a checklist written in 2008. Compliance is compared within
a design and within an era, or not at all.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class Item:
    number: str
    name: str
    present: bool
    quote: str = ""
    essential: bool = True

    def as_dict(self) -> dict:
        return {"number": self.number, "name": self.name, "present": self.present,
                "essential": self.essential, "quote": self.quote}


@dataclass
class Compliance:
    guideline: str
    version: str
    applies_to: str
    items: list[Item] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def n_present(self) -> int:
        return sum(1 for i in self.items if i.present)

    @property
    def score(self) -> float:
        return self.n_present / len(self.items) if self.items else 0.0

    @property
    def missing(self) -> list[Item]:
        return [i for i in self.items if not i.present]

    @property
    def missing_essential(self) -> list[Item]:
        return [i for i in self.items if not i.present and i.essential]

    @property
    def band(self) -> str:
        """Rough bands, for sorting a screening list rather than for judgement."""
        s = self.score
        if s >= 0.80:
            return "complete"
        if s >= 0.60:
            return "adequate"
        if s >= 0.40:
            return "partial"
        return "poor"

    def summary(self) -> str:
        return (f"{self.guideline}: {self.n_present}/{len(self.items)} items "
                f"reported ({self.score:.0%}, {self.band})")

    def as_dict(self) -> dict:
        return {"guideline": self.guideline, "version": self.version,
                "applies_to": self.applies_to,
                "n_items": len(self.items), "n_present": self.n_present,
                "score": round(self.score, 3), "band": self.band,
                "summary": self.summary(),
                "missing": [i.number for i in self.missing],
                "missing_essential": [i.name for i in self.missing_essential],
                "items": [i.as_dict() for i in self.items], "notes": self.notes}


def _check(text: str, pattern: str) -> tuple[bool, str]:
    m = re.search(pattern, text, re.I)
    if not m:
        return False, ""
    lo = max(0, m.start() - 55)
    hi = min(len(text), m.end() + 55)
    return True, " ".join(text[lo:hi].split())


def _build(guideline: str, version: str, applies_to: str, spec, text: str,
           notes: list[str] | None = None) -> Compliance:
    items = []
    for number, name, pattern, essential in spec:
        present, quote = _check(text, pattern)
        items.append(Item(number, name, present, quote, essential))
    return Compliance(guideline, version, applies_to, items, notes or [])


# ------------------------------------------------------------- CONSORT-A 2008

_CONSORT_A = [
    ("1", "Identified as randomised in the title",
     r"\brandomi[sz]ed\b|\brandomi[sz]ation\b|\bRCT\b", True),
    ("2", "Trial design described (parallel, cluster, crossover, non-inferiority)",
     r"\bparallel[- ]group\b|\bcluster[- ]randomi|\bcross[- ]over\b|"
     r"\bnon[- ]inferiority\b|\bfactorial\b|\bsuperiority trial\b|"
     r"\b(?:two|three|multi)[- ]arm\b|\bphase (?:I{1,3}|1|2|3|4)\b", True),
    ("3", "Eligibility criteria for participants",
     r"\beligib|\binclusion criteria\b|\bpatients? (?:aged|with)\b|"
     r"\badults? (?:aged|with)\b|\bparticipants? (?:aged|with)\b", True),
    ("4", "Settings where the data were collected",
     r"\b(?:multi|single)[- ]cent(?:re|er)\b|\bhospitals?\b|\bclinics?\b|"
     r"\bprimary care\b|\bICUs?\b|\bintensive care\b|\bcommunity\b|"
     r"\bin \d+ (?:cent|hospital|site|countr)", True),
    ("5", "Interventions intended for each group",
     r"\brandomi[sz]ed to\b|\ballocated to\b|\bassigned to\b|\bversus\b|\bvs\.?\b|"
     r"\bcompared with\b|\bplacebo\b|\bcontrol group\b|\busual care\b", True),
    ("6", "Primary outcome defined",
     r"\bprimary (?:outcome|end ?point|efficacy)\b|\bmain outcome measure",
     True),
    ("7", "Randomisation: how participants were allocated",
     r"\brandom(?:ly)? (?:assign|allocat)|\bcomputer[- ]generated\b|"
     r"\b1:1\b|\ballocation ratio\b|\bpermuted block|\bstratified randomi", True),
    ("8", "Blinding: whether participants, carers and assessors were masked",
     r"\bdouble[- ]blind|\bsingle[- ]blind|\btriple[- ]blind|\bopen[- ]label\b|"
     r"\bmasked\b|\bblinded\b|\bunblinded\b", True),
    ("9", "Number randomised to each group",
     r"\b\d[\d,]{1,7}\s+(?:were |participants? |patients? )?(?:were )?"
     r"randomi[sz]ed\b|\brandomi[sz]ed\s+[\d,]{2,}\b|\bn\s*=\s*[\d,]{2,}\b", True),
    ("10", "Number analysed in each group",
     r"\banalys(?:ed|is) (?:population|set)\b|\bintention[- ]to[- ]treat\b|\bITT\b|"
     r"\bper[- ]protocol\b|\b[\d,]{2,}\s+(?:were |patients? |participants? )?"
     r"(?:were )?(?:analys|included in the analys)", True),
    ("11", "Primary outcome result for each group, with effect size and precision",
     r"9[05]\s*%\s*(?:CI|confidence interval)|\brisk ratio\b|\bhazard ratio\b|"
     r"\bodds ratio\b|\bmean difference\b|\babsolute (?:risk )?(?:difference|"
     r"reduction)\b", True),
    ("12", "Statistical significance or estimate precision reported",
     r"\bp\s*[<>=≤≥]\s*0?\.\d+|\bp\s*[<>=]\s*\.\d+|9[05]\s*%\s*(?:CI|confidence)",
     True),
    ("13", "Important adverse events or side effects",
     r"\badverse (?:events?|reactions?|effects?)\b|\bside effects?\b|"
     r"\bserious adverse\b|\btoxicit|\bsafety (?:outcomes?|profile|endpoint)\b|"
     r"\bharms?\b|\bmortality\b|\bdiscontinu(?:ed|ation) (?:due to|because)", True),
    ("14", "General interpretation of the results",
     r"\b(?:CONCLUSIONS?|INTERPRETATION)\b|\bwe conclude\b|\bthese (?:findings|"
     r"results) (?:suggest|indicate|show|support)\b", True),
    ("15", "Trial registration number and register name",
     r"\bNCT\d{8}\b|\bISRCTN\s?\d+|\bEudraCT\b|\bClinicalTrials\.gov\b|"
     r"\bregistered (?:at|with|on)\b|\bChiCTR|\bANZCTR|\bUMIN\d+", True),
    ("16", "Source of funding",
     r"\bfunded by\b|\bfunding\b|\bsupported by (?:a )?(?:grant|the)\b|"
     r"\bsponsored? by\b|\bgrant (?:from|number)\b", False),
    ("17", "Where the full trial protocol can be accessed",
     r"\bprotocol (?:is )?available\b|\bpublished protocol\b|"
     r"\bsupplementary (?:appendix|material)\b", False),
]

# --------------------------------------------------------- PRISMA 2020-A

_PRISMA_A = [
    ("1", "Identified as a systematic review in the title",
     r"\bsystematic review\b|\bmeta[- ]analys", True),
    ("2", "Objectives stated with an explicit question",
     r"\b(?:OBJECTIVE|AIM|PURPOSE)S?\b|\bwe (?:aimed|sought) to\b|"
     r"\bto (?:assess|evaluate|determine|examine|compare|synthesi[sz]e)\b", True),
    ("3", "Eligibility criteria for included studies",
     r"\beligib|\binclusion criteria\b|\bstudies were included if\b|"
     r"\bwe included\b|\bRCTs? (?:were |that )?(?:comparing|evaluating|included)",
     True),
    ("4", "Information sources named, with the last search date",
     r"\b(?:MEDLINE|PubMed|Embase|EMBASE|CENTRAL|Cochrane|CINAHL|Scopus|"
     r"Web of Science|PsycINFO)\b", True),
    ("5", "Risk of bias assessed",
     r"\brisk of bias\b|\bRoB ?2\b|\bstudy quality\b|\bmethodological quality\b|"
     r"\bNewcastle[- ]Ottawa\b|\bJadad\b|\bQUADAS\b|\bROBINS", True),
    ("6", "Synthesis method described",
     r"\brandom[- ]effects\b|\bfixed[- ]effect\b|\bnarrative synthesis\b|"
     r"\bmeta[- ]analys|\bpooled\b|\bDerSimonian\b|\bMantel[- ]Haenszel\b|"
     r"\bnetwork meta", True),
    ("7", "Number of included studies and participants",
     r"\b\d+\s+(?:studies|trials|RCTs?|articles|records|cohorts)\b|"
     r"\b\d[\d,]{2,}\s+(?:participants|patients|subjects)\b", True),
    ("8", "Results with effect estimates and confidence intervals",
     r"9[05]\s*%\s*(?:CI|confidence interval)|\bpooled (?:RR|OR|HR|SMD|MD|"
     r"risk ratio|odds ratio|hazard ratio|estimate)", True),
    ("9", "Heterogeneity reported",
     r"\bI\s*[²2]\s*[=<>]|\bheterogene|\btau\s*[²2]\b|\bCochran'?s? Q\b", True),
    ("10", "Limitations of the evidence discussed",
     r"\blimitation|\bcaution\b|\blow[- ]certainty\b|\bvery low[- ]certainty\b|"
     r"\bGRADE\b|\bcertainty of (?:the )?evidence\b|\bpublication bias\b|"
     r"\bhigh risk of bias\b", True),
    ("11", "Interpretation and implications",
     r"\b(?:CONCLUSIONS?|INTERPRETATION)\b|\bwe conclude\b|\bthese findings\b|"
     r"\bimplications? for (?:practice|policy|research)\b", True),
    ("12", "Registration number and funding",
     r"\bPROSPERO\b|\bCRD42\d+\b|\bregistered\b|\bfunded by\b|\bfunding\b|"
     r"\bno (?:external )?funding\b", True),
]

# ------------------------------------------------------------------ STROBE

_STROBE_A = [
    ("1", "Design indicated in the title or abstract",
     r"\bcohort\b|\bcase[- ]control\b|\bcross[- ]sectional\b|\bprospective\b|"
     r"\bretrospective\b|\bregistry[- ]based\b|\bpopulation[- ]based\b", True),
    ("2", "Background and objectives",
     r"\b(?:BACKGROUND|OBJECTIVE|AIM|PURPOSE|IMPORTANCE)S?\b|\bwe (?:aimed|"
     r"sought|investigated) to\b", True),
    ("3", "Setting, locations and relevant dates",
     r"\bbetween \d{4}\b|\bfrom \d{4} (?:to|through|and) \d{4}\b|\b\d{4}[–-]\d{4}\b|"
     r"\bhospitals?\b|\bcohort\b.{0,40}\b\d{4}\b|\bnationwide\b|\bregistry\b", True),
    ("4", "Eligibility criteria and methods of participant selection",
     r"\beligib|\binclusion criteria\b|\bconsecutive\b|\benrolled\b|"
     r"\bwe (?:included|identified)\b|\ball (?:patients|adults|participants) "
     r"(?:who|with|aged)", True),
    ("5", "Outcomes and exposures defined",
     r"\bprimary (?:outcome|end ?point|exposure)\b|\boutcome was\b|"
     r"\bexposure was\b|\bdefined as\b|\bICD[- ]?(?:9|10)\b|\bmain outcome", True),
    ("6", "Number of participants",
     r"\bn\s*=\s*[\d,]{2,}\b|\b[\d,]{3,}\s+(?:patients|participants|adults|"
     r"individuals|subjects|women|men|children)\b", True),
    ("7", "Confounding addressed in the analysis",
     r"\badjust(?:ed|ment)\b|\bmultivariable\b|\bpropensity\b|\bmatched\b|"
     r"\bcovariat|\bstratified\b|\bCox (?:proportional|regression)\b|"
     r"\blogistic regression\b", True),
    ("8", "Estimates with confidence intervals",
     r"9[05]\s*%\s*(?:CI|confidence interval)|\badjusted (?:OR|HR|RR|odds|"
     r"hazard|risk)", True),
    ("9", "Cautious overall interpretation",
     r"\b(?:CONCLUSIONS?|INTERPRETATION)\b|\blimitation|\bcausal(?:ity)?\b|"
     r"\bassociation (?:does not|cannot)\b|\bresidual confounding\b|"
     r"\bobservational\b", True),
]

# -------------------------------------------------------------------- CARE

_CARE = [
    ("1", "Identified as a case report in the title",
     r"\bcase report\b|\bcase series\b|\ba case of\b", True),
    ("2", "Patient demographics",
     r"\b\d{1,3}[- ]year[- ]old\b|\bage[d]? \d{1,3}\b|\b(?:man|woman|male|female|"
     r"boy|girl|patient) aged\b", True),
    ("3", "Presenting concerns and symptoms",
     r"\bpresented with\b|\bcomplain|\bsymptoms?\b|\bhistory of\b|"
     r"\badmitted (?:with|for)\b", True),
    ("4", "Diagnostic methods and results",
     r"\bdiagnos|\bbiopsy\b|\bimaging\b|\bMRI\b|\bCT\b|\bhistolog|\bculture\b|"
     r"\blaboratory\b|\bendoscop|\bserolog", True),
    ("5", "Therapeutic intervention",
     r"\btreated with\b|\btherapy\b|\btreatment\b|\bsurgery\b|\bresection\b|"
     r"\badministered\b|\bstarted on\b|\bmanaged (?:with|by)\b", True),
    ("6", "Outcomes and follow-up",
     r"\bfollow[- ]up\b|\bresolved\b|\brecover|\bdischarged\b|\bremission\b|"
     r"\bdied\b|\boutcome\b|\bat \d+ (?:days?|weeks?|months?|years?)\b", True),
    ("7", "Discussion of strengths and limitations",
     r"\blimitation|\bfirst reported\b|\brare\b|\bto our knowledge\b|"
     r"\bdiscussion\b|\bliterature\b", False),
    ("8", "Take-away lesson",
     r"\b(?:CONCLUSIONS?)\b|\bclinicians? should\b|\bhighlights?\b|"
     r"\bthis case (?:illustrates|demonstrates|suggests|underscores)\b|"
     r"\bshould be considered\b", True),
]

# ------------------------------------------------------------- ARRIVE 2.0

_ARRIVE = [
    ("1", "Study design: groups and comparisons",
     r"\bcontrol group\b|\bsham\b|\bvehicle\b|\bcompared with\b|\bversus\b|"
     r"\btreatment group\b|\bwild[- ]type\b|\bknockout\b", True),
    ("2", "Sample size per group",
     r"\bn\s*=\s*\d+\b|\b\d+\s+(?:mice|rats|animals|rabbits|dogs|pigs|"
     r"zebrafish|monkeys|primates)\b|\bper group\b", True),
    ("3", "Inclusion and exclusion criteria for animals or data",
     r"\bexclud|\binclusion criteri|\banimals were selected\b|\bcriteria\b", True),
    ("4", "Randomisation of animals to groups",
     r"\brandom(?:ly|i[sz]ed|isation|ization)\b", True),
    ("5", "Blinding of the experimenter or assessor",
     r"\bblind(?:ed|ing)?\b|\bmasked\b", True),
    ("6", "Outcome measures defined",
     r"\bprimary (?:outcome|end ?point)\b|\bmeasured\b|\bassessed\b|"
     r"\bquantif|\bassay", True),
    ("7", "Statistical methods stated",
     r"\bANOVA\b|\bt[- ]test\b|\bMann[- ]Whitney\b|\bKruskal\b|\bp\s*[<>=]\b|"
     r"\bstatistical(?:ly)? (?:analys|significan)", True),
    ("8", "Species, strain, sex and age of the animals",
     r"\bC57BL|\bBALB/c\b|\bSprague[- ]Dawley\b|\bWistar\b|\bmale\b|\bfemale\b|"
     r"\b\d+[- ]week[- ]old\b|\bmice\b|\brats\b", True),
]

_SPECS = {
    "CONSORT-A": ("CONSORT for Abstracts", "2008", "randomised trial", _CONSORT_A,
                  ["The 2008 extension. A trial reported before it existed will "
                   "score poorly for reasons that say nothing about its quality."]),
    "PRISMA-A": ("PRISMA 2020 for Abstracts", "2020", "systematic review",
                 _PRISMA_A,
                 ["Reviews published before 2021 were written against PRISMA "
                  "2009, which has 12 different items."]),
    "STROBE-A": ("STROBE (abstract items)", "2007", "observational study",
                 _STROBE_A,
                 ["STROBE has one abstract item; these nine are its components, "
                  "as recommended by the STROBE explanation and elaboration."]),
    "CARE": ("CARE", "2013", "case report", _CARE, []),
    "ARRIVE": ("ARRIVE 2.0 essential 10", "2020", "preclinical study", _ARRIVE,
               ["The eight ARRIVE items an abstract can plausibly carry; the "
                "full essential-10 set includes items that live in the methods."]),
}

#: Pyramid level -> which checklist governs.
_LEVEL_GUIDELINE = {1: "PRISMA-A", 2: "CONSORT-A", 3: "STROBE-A", 4: "STROBE-A",
                    5: "CARE", 7: "ARRIVE"}


def article_text(article) -> str:
    """Title plus abstract — the text a checklist is scored against.

    Composed here rather than taken from a method on the record, so this module
    works against any object carrying ``title`` and ``abstract``: a
    :class:`~strata.pubmed.Article` from any of the federated sources, or a bare
    stand-in from a caller who has the text and nothing else. Scoring a checklist
    needs two strings, and requiring a particular class for that would be a
    coupling with nothing behind it.
    """
    title = getattr(article, "title", "") or ""
    abstract = getattr(article, "abstract", "") or ""
    return f"{title} {abstract}".strip()


def check(article, level: int) -> Compliance | None:
    """Score an abstract against the checklist its design is governed by.

    Level 6 — narrative reviews, editorials, opinion — has no EQUATOR checklist,
    because there is no method to report. That returns ``None`` rather than a
    zero, since a zero would read as a failure where the truth is that the
    question does not apply.
    """
    key = _LEVEL_GUIDELINE.get(level)
    if key is None:
        return None
    guideline, version, applies_to, spec, notes = _SPECS[key]
    return _build(guideline, version, applies_to, spec, article_text(article),
                  list(notes))


def check_by_name(text: str, name: str) -> Compliance:
    """Score arbitrary text against a named checklist — the API's entry point."""
    key = name.upper().replace("_", "-")
    aliases = {"CONSORT": "CONSORT-A", "PRISMA": "PRISMA-A", "STROBE": "STROBE-A",
               "ARRIVE-2": "ARRIVE", "ARRIVE2": "ARRIVE"}
    key = aliases.get(key, key)
    if key not in _SPECS:
        raise ValueError(f"unknown checklist {name!r}; "
                         f"known: {', '.join(sorted(_SPECS))}")
    guideline, version, applies_to, spec, notes = _SPECS[key]
    return _build(guideline, version, applies_to, spec, text, list(notes))


def available() -> list[dict]:
    """What this module can score, for the API's discovery endpoint."""
    return [{"id": k, "guideline": v[0], "version": v[1], "applies_to": v[2],
             "n_items": len(v[3])} for k, v in sorted(_SPECS.items())]
