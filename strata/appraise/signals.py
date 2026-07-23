"""Reporting signals — the shared substrate under every appraisal instrument.

RoB 2, ROBINS-I, AMSTAR-2 and the Newcastle-Ottawa Scale ask overlapping
questions in different words: was allocation concealed, were outcome assessors
masked, was there a protocol, was confounding addressed. Rather than four copies
of nearly the same regular expressions, each instrument declares which signals
its domains depend on and reads them from here.

Every signal carries the sentence that produced it. This is not decoration. An
appraisal that says "high risk of bias" without showing which words led there is
an assertion, and the entire reason Strata is worth trusting more than a chatbot
is that it never makes one.

**A signal has three states, and the third is the important one.** Present,
explicitly absent, and *not reported*. Trials that do not mention blinding are
not trials that were unblinded — they are trials whose report is silent, which
under RoB 2 raises concerns without establishing high risk. Collapsing the two
into a boolean is the single most common error in automated appraisal and it
systematically overstates how bad the literature is.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

#: Sentences longer than this are truncated in quotes; abstracts occasionally
#: contain a 400-character sentence and a quote that long is not a quote.
_QUOTE_LIMIT = 240


@dataclass
class Signal:
    key: str
    state: str                        # "present" | "absent" | "not reported"
    quote: str = ""
    matched: str = ""

    @property
    def present(self) -> bool:
        return self.state == "present"

    @property
    def absent(self) -> bool:
        return self.state == "absent"

    @property
    def silent(self) -> bool:
        return self.state == "not reported"

    def as_dict(self) -> dict:
        return {"key": self.key, "state": self.state,
                "quote": self.quote, "matched": self.matched}


# Each entry is (positive pattern, explicit-negative pattern or None). The
# negative pattern is what lets a signal reach "absent" rather than merely
# "not reported" — "outcome assessors were not blinded" is information, and it
# is different information from silence.
_CUES: dict[str, tuple[str, str | None]] = {
    # --- allocation -------------------------------------------------------
    "randomised": (
        r"\brandom(?:ly|ised|ized|isation|ization)\b|\brandomi[sz]ed\s+(?:to|in|"
        r"controlled|clinical|trial)\b",
        r"\bnon-?randomi[sz]ed\b|\bnot\s+randomi[sz]ed\b|\bquasi-?randomi[sz]ed\b"),
    "sequence_generation": (
        r"\b(?:computer[- ]generated|random\s+number\s+(?:table|generator)|"
        r"permuted\s+block|block\s+randomi[sz]ation|stratified\s+randomi[sz]ation|"
        r"minimi[sz]ation|coin\s+toss)\b", None),
    "allocation_concealed": (
        r"\ballocation\s+conceal|\bconcealed\s+allocation\b|"
        r"\b(?:sealed|opaque)\s+(?:and\s+\w+\s+)?envelope|"
        r"\bcentral(?:ised|ized)?\s+(?:randomi[sz]ation|allocation)\b|"
        r"\bweb-?based\s+randomi[sz]ation\b|\bIWRS\b|\bIVRS\b",
        r"\ballocation\s+was\s+not\s+concealed\b"),
    # --- masking ----------------------------------------------------------
    "double_blind": (
        r"\bdouble[- ]blind|\btriple[- ]blind|\bdouble[- ]mask", None),
    "blinded_participants": (
        r"\b(?:participants?|patients?|subjects?)\s+(?:and\s+\w+\s+)?"
        r"(?:were\s+)?(?:blind|mask)ed\b|\bplacebo[- ]controlled\b|"
        r"\bidentical(?:[- ]appearing)?\s+placebo\b",
        r"\b(?:participants?|patients?)\s+were\s+not\s+blinded\b|\bopen[- ]label\b|"
        r"\bunblinded\b|\bno\s+blinding\b"),
    "blinded_assessors": (
        r"\b(?:outcome\s+)?(?:assessors?|adjudicat\w+|evaluators?|raters?|"
        r"investigators?|analysts?)\s+(?:were\s+)?(?:blind|mask)ed\b|"
        r"\bblinded\s+(?:outcome\s+)?(?:assessment|adjudication|end\s?point)\b|"
        r"\bmasked\s+assessment\b|\bindependent\s+adjudication\s+committee\b",
        r"\bassessors?\s+were\s+not\s+blinded\b|\bwithout\s+blinded\s+assessment\b"),
    # --- analysis ---------------------------------------------------------
    "itt": (
        r"\bintention[- ]to[- ]treat\b|\bintent[- ]to[- ]treat\b|\bITT\b|"
        r"\bmodified\s+intention[- ]to[- ]treat\b|\bmITT\b",
        r"\bper[- ]protocol\s+analysis\s+only\b"),
    "per_protocol": (r"\bper[- ]protocol\b|\bas[- ]treated\s+analysis\b", None),
    "attrition_reported": (
        r"\b(?:lost\s+to\s+follow[- ]?up|withdrew|withdrawal|dropout|drop[- ]out|"
        r"discontinued|attrition)\b", None),
    "low_attrition": (
        r"\b(?:complete|full)\s+follow[- ]?up\b|"
        r"\bfollow[- ]?up\s+was\s+(?:complete|available\s+for)\b|"
        r"\bno\s+(?:patients?|participants?)\s+(?:were\s+)?lost\s+to\s+"
        r"follow[- ]?up\b|"
        r"\b(?:9\d|100)(?:\.\d)?%\s+(?:of\s+\w+\s+){0,3}(?:completed|had\s+"
        r"complete|were\s+followed)\b|"
        r"\bfollow[- ]?up\s+(?:was\s+|rate\s+was\s+)?(?:9\d|100)(?:\.\d)?%",
        r"\b(?:[3-9]\d|\d{3,})(?:\.\d)?%\s+(?:were\s+)?lost\s+to\s+follow[- ]?up\b"),
    "missing_data_handled": (
        r"\bmultiple\s+imputation\b|\bimputed?\b|\bmixed[- ]effects?\s+model\s+for"
        r"\s+repeated\s+measures\b|\bMMRM\b|\bsensitivity\s+analys\w+\s+for\s+"
        r"missing\b|\bcomplete[- ]case\s+analysis\b", None),
    # --- planning ---------------------------------------------------------
    "registered": (
        r"\b(?:NCT\d{8}|ISRCTN\d+|ChiCTR[- ]?\w+|ACTRN\d+|EudraCT|UMIN\d+|"
        r"CRD42\d+|PROSPERO|clinicaltrials\.gov|trial\s+registration|"
        r"prospectively\s+registered|registered\s+(?:at|with|in)\s+\w+)\b",
        r"\bnot\s+(?:been\s+)?registered\b|\bno\s+(?:trial\s+)?registration\b"),
    "protocol_available": (
        r"\bpublished\s+protocol\b|\bprotocol\s+(?:was\s+)?(?:published|available|"
        r"pre-?specified|registered)\b|\ba\s+priori\s+protocol\b|"
        r"\bstatistical\s+analysis\s+plan\b", None),
    "sample_size_calculation": (
        r"\bsample\s+size\s+(?:calculation|estimation|was\s+calculated)\b|"
        r"\bpower(?:ed)?\s+(?:calculation|analysis|to\s+detect)\b|"
        r"\b\d{1,3}%\s+power\b", None),
    "prespecified_outcome": (
        r"\bpre-?specified\b|\bprimary\s+(?:outcome|end\s?point)\s+was\b|"
        r"\bprimary\s+(?:outcome|end\s?point)s?\s+(?:were|included)\b", None),
    # --- observational ----------------------------------------------------
    "confounding_adjusted": (
        r"\badjust(?:ed|ing|ment)\s+for\b|\bmultivariable\b|\bmultivariate\s+"
        r"(?:regression|model|analysis)\b|\bcovariat\w+\b|\bpropensity\s+"
        r"(?:score|match)|\binverse\s+probability\s+weight|\bIPTW\b|"
        r"\bmatched\s+on\b|\bstratified\s+(?:by|analysis)\b|"
        r"\bCox\s+(?:proportional\s+hazards\s+)?(?:regression|model)\b|"
        r"\blogistic\s+regression\b|\bdifference[- ]in[- ]differences\b|"
        r"\binstrumental\s+variable\b|\btarget\s+trial\s+emulation\b",
        r"\bunadjusted\s+analys|\bcrude\s+(?:rates?|estimates?)\s+only\b"),
    "propensity": (r"\bpropensity\s+(?:score|match)|\bIPTW\b|"
                   r"\binverse\s+probability\s+of\s+treatment\b", None),
    "matched_design": (r"\bmatched\s+(?:cohort|controls?|pairs?|case)|"
                       r"\bfrequency[- ]matched\b|\bage[- ]\s?and\s+sex[- ]matched\b",
                       None),
    "consecutive_enrolment": (
        r"\bconsecutive(?:ly)?\s+(?:enrolled|recruited|patients?|admitted)\b|"
        r"\ball\s+eligible\s+patients?\b|\bpopulation[- ]based\b|"
        r"\bnationwide\s+(?:registry|cohort)\b|\bwhole[- ]population\b", None),
    "objective_outcome": (
        r"\b(?:all[- ]cause\s+)?mortality\b|\bdeath\b|\bsurvival\b|"
        r"\bhospitali[sz]ation\b|\blaboratory[- ]confirmed\b|"
        r"\bhistolog\w+\b|\bculture[- ]confirmed\b|\bimaging[- ]confirmed\b|"
        r"\bHbA1c\b|\bblood\s+pressure\b|\bviral\s+load\b", None),
    "subjective_outcome": (
        r"\bself[- ]report|\bquestionnaire\b|\bpatient[- ]reported\b|"
        r"\bvisual\s+analogue\s+scale\b|\bVAS\b|\bquality\s+of\s+life\b|"
        r"\bsymptom\s+scores?\b|\bclinician[- ]rated\b", None),
    "exposure_validated": (
        r"\bvalidated\s+(?:instrument|questionnaire|algorithm|measure)\b|"
        r"\bmedical\s+record\s+review\b|\bpharmacy\s+dispensing\s+records?\b|"
        r"\bprescription\s+(?:claims|records)\b|\bbiomarker[- ]confirmed\b", None),
    "follow_up_duration": (
        r"\bmedian\s+follow[- ]?up\s+(?:of\s+|was\s+)?[\d.]+|"
        r"\bfollowed\s+(?:up\s+)?for\s+(?:a\s+)?(?:median|mean)?\s*[\d.]+\s*"
        r"(?:years?|months?|weeks?|days?)\b", None),
    # --- systematic review ------------------------------------------------
    "search_strategy": (
        r"\b(?:MEDLINE|PubMed|EMBASE|Embase|CENTRAL|Cochrane\s+Library|Web\s+of"
        r"\s+Science|Scopus|CINAHL)\b", None),
    "multiple_databases": (
        r"\b(?:MEDLINE|PubMed)\b[^.]{0,80}\b(?:EMBASE|Embase|CENTRAL|Cochrane|"
        r"Scopus|Web\s+of\s+Science|CINAHL)\b", None),
    "duplicate_screening": (
        r"\btwo\s+(?:independent\s+)?(?:reviewers?|authors?|investigators?)\b|"
        r"\bindependently\s+(?:screened|extracted|assessed|reviewed)\b|"
        r"\bin\s+duplicate\b|\bdisagreements?\s+(?:were\s+)?resolved\b", None),
    "risk_of_bias_assessed": (
        r"\brisk\s+of\s+bias\b|\bCochrane\s+(?:risk[- ]of[- ]bias|RoB)\b|\bRoB\s?2\b|"
        r"\bROBINS[- ]I\b|\bNewcastle[- ]Ottawa\b|\bJadad\b|\bquality\s+"
        r"assessment\b|\bmethodological\s+quality\b|\bGRADE\b", None),
    "heterogeneity_assessed": (
        r"\bI\s*[²2]\b|\bheterogeneity\b|\bCochran'?s?\s+Q\b|\btau\s*[²2]\b|"
        r"\brandom[- ]effects?\s+model\b", None),
    "publication_bias_assessed": (
        r"\bpublication\s+bias\b|\bfunnel\s+plot\b|\bEgger'?s?\s+test\b|"
        r"\btrim[- ]and[- ]fill\b|\bsmall[- ]study\s+effects?\b", None),
    "prisma": (r"\bPRISMA\b|\bpreferred\s+reporting\s+items\b", None),
    "grey_literature": (
        r"\bgrey\s+literature\b|\bgray\s+literature\b|\bconference\s+"
        r"(?:abstracts?|proceedings)\b|\btrial\s+registr(?:y|ies)\s+(?:were\s+)?"
        r"searched\b|\bunpublished\s+(?:studies|data)\b", None),
    "language_restricted": (
        r"\b(?:English[- ]language\s+(?:only|articles|publications)|restricted\s+to"
        r"\s+English|limited\s+to\s+English)\b", None),
    # --- reporting integrity ---------------------------------------------
    "conflict_declared": (
        r"\b(?:conflicts?\s+of\s+interest|competing\s+interests?|"
        r"declaration\s+of\s+interest|disclosures?)\b", None),
    "funding_declared": (
        r"\bfunded\s+by\b|\bfunding\b|\bgrant\s+(?:from|number)\b|"
        r"\bsupported\s+by\b|\bsponsored\s+by\b", None),
    "industry_sponsor": (
        r"\b(?:sponsored|funded|supported)\s+by\s+[A-Z][\w&.\- ]{2,40}"
        r"(?:Inc|Ltd|LLC|GmbH|Pharma\w*|Pharmaceuticals?|Laboratories|Biotech\w*)\b|"
        r"\bindustry[- ]funded\b|\bemployees?\s+of\s+the\s+sponsor\b", None),
    "interim_analysis": (
        r"\binterim\s+analys|\bstopped\s+early\b|\bearly\s+termination\b|"
        r"\bdata\s+(?:and\s+)?safety\s+monitoring\s+board\b|\bDSMB\b", None),
    "multiple_outcomes": (
        r"\b(?:co-?primary|multiple\s+primary)\s+(?:outcomes?|end\s?points?)\b|"
        r"\bsecondary\s+(?:outcomes?|end\s?points?)\s+included\b", None),
    "post_hoc": (
        r"\bpost[- ]hoc\b|\bexploratory\s+analys|\bsubgroup\s+analys\w+\s+"
        r"(?:were\s+)?(?:not\s+)?pre-?specified\b|\bdata[- ]driven\b", None),
}

_COMPILED = {k: (re.compile(pos, re.I),
                 re.compile(neg, re.I) if neg else None)
             for k, (pos, neg) in _CUES.items()}

_SENTENCE = re.compile(r"(?<=[.;])\s+(?=[A-Z(])|\s{2,}")


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE.split(text or "") if s.strip()]


def _quote_for(text: str, match: re.Match) -> str:
    """The sentence containing a match, trimmed to a quotable length."""
    start = text.rfind(".", 0, match.start()) + 1
    end = text.find(".", match.end())
    end = len(text) if end == -1 else end + 1
    quote = " ".join(text[start:end].split())
    if len(quote) > _QUOTE_LIMIT:
        centre = match.start() - start
        lo = max(0, centre - _QUOTE_LIMIT // 2)
        quote = "…" + quote[lo:lo + _QUOTE_LIMIT] + "…"
    return quote


def detect(text: str, keys: list[str] | None = None) -> dict[str, Signal]:
    """Read every reporting signal (or a named subset) out of a piece of text.

    An explicit negative wins over a positive when both fire: "randomised" and
    "non-randomised" both match the randomisation cue, and the sentence that
    says *non*-randomised is the one that decides.
    """
    text = text or ""
    wanted = keys if keys is not None else list(_COMPILED)
    out: dict[str, Signal] = {}
    for key in wanted:
        compiled = _COMPILED.get(key)
        if compiled is None:
            out[key] = Signal(key=key, state="not reported")
            continue
        pos, neg = compiled
        neg_match = neg.search(text) if neg else None
        if neg_match is not None:
            out[key] = Signal(key=key, state="absent",
                              quote=_quote_for(text, neg_match),
                              matched=neg_match.group(0))
            continue
        pos_match = pos.search(text)
        if pos_match is not None:
            out[key] = Signal(key=key, state="present",
                              quote=_quote_for(text, pos_match),
                              matched=pos_match.group(0))
        else:
            out[key] = Signal(key=key, state="not reported")
    return out


def any_present(signals: dict[str, Signal], *keys: str) -> bool:
    return any(signals.get(k) is not None and signals[k].present for k in keys)


def first_present(signals: dict[str, Signal], *keys: str) -> Signal | None:
    for k in keys:
        s = signals.get(k)
        if s is not None and s.present:
            return s
    return None


def known_keys() -> list[str]:
    return sorted(_COMPILED)
