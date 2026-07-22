"""Evidence grading — the honest core.

Every retrieved paper is placed on the evidence pyramid, appraised against the
GRADE domains, and given a plain-language strength. Aggregated over the top
papers this yields a statement of how strong the answer's backing actually is —
the thing a medical chatbot never tells you.

The pyramid, strongest first:

    1  Systematic review / meta-analysis
    2  Randomised controlled trial
    3  Cohort study
    4  Case-control / cross-sectional
    5  Case report / series
    6  Narrative review / editorial / opinion
    7  Preclinical (animal / in vitro)

Level seven is not part of the classical pyramid and is here deliberately. A
mouse study is not weak clinical evidence, it is *not clinical evidence*, and
collapsing it into "expert opinion" loses that. Practice guidelines are a
cross-cutting flag rather than a level, because a guideline's authority comes
from the evidence underneath it.

**How a study gets classified.** The design network reads the abstract; the rule
set reads PubMed's publication types. Where PubMed has tagged a paper — those
tags are assigned by NLM indexers and are the closest thing to ground truth
available — the rule wins. Where it has not, and the network is confident, the
network wins. Every grade records which decided it, and ``strata ask --explain``
prints the phrases the network attended to.

**How strength is assigned.** GRADE, simplified but followed honestly: trials
start high and observational studies start low, then move for risk of bias,
imprecision, and — for observational studies only — a large effect. Each
adjustment is recorded with its reason rather than folded into a single number,
because "moderate" is not useful unless you can see what took it down from high.

This is decision support, not medical advice, and not a substitute for reading
the papers.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import stance as stance_mod
from . import stats
from .pubmed import Article

LEVEL_LABEL = {
    1: "Systematic review / meta-analysis",
    2: "Randomised controlled trial",
    3: "Cohort study",
    4: "Case-control / cross-sectional",
    5: "Case report / series",
    6: "Narrative review / opinion",
    7: "Preclinical (animal / in vitro)",
}

MAX_LEVEL = 7
STRENGTH_ORDER = ["very low", "low", "moderate", "high"]

#: GRADE's starting certainty by design: trials high, observational low.
_BASE_STRENGTH = {1: "high", 2: "high", 3: "low", 4: "low",
                  5: "very low", 6: "very low", 7: "very low"}

#: Design-network label -> pyramid level.
_NN_LEVEL = {"systematic_review": 1, "rct": 2, "cohort": 3, "case_control": 4,
             "cross_sectional": 4, "case_report": 5, "narrative_review": 6,
             "preclinical": 7}

_NN_LABEL = {"systematic_review": LEVEL_LABEL[1], "rct": LEVEL_LABEL[2],
             "cohort": LEVEL_LABEL[3], "case_control": "Case-control study",
             "cross_sectional": "Cross-sectional study",
             "case_report": LEVEL_LABEL[5], "narrative_review": LEVEL_LABEL[6],
             "preclinical": LEVEL_LABEL[7]}

# PubMed publication types that settle the question on their own, most specific
# first. NLM indexers assign these from the full text.
_DECISIVE_PUBTYPES = [
    ("meta-analysis", 1, LEVEL_LABEL[1]),
    ("systematic review", 1, LEVEL_LABEL[1]),
    ("randomized controlled trial", 2, LEVEL_LABEL[2]),
    ("controlled clinical trial", 2, LEVEL_LABEL[2]),
    ("pragmatic clinical trial", 2, LEVEL_LABEL[2]),
    ("adaptive clinical trial", 2, LEVEL_LABEL[2]),
    ("equivalence trial", 2, LEVEL_LABEL[2]),
    ("case reports", 5, LEVEL_LABEL[5]),
]

_WEAK_PUBTYPES = [
    ("editorial", 6, "Editorial"),
    ("comment", 6, "Comment"),
    ("letter", 6, "Letter"),
    ("news", 6, "News"),
    ("review", 6, LEVEL_LABEL[6]),
]

_TITLE_RULES = [
    (r"\bmeta-analys", 1, LEVEL_LABEL[1]),
    (r"\bsystematic review\b", 1, LEVEL_LABEL[1]),
    (r"\brandomi[sz]ed\b|\brandomi[sz]ation\b", 2, LEVEL_LABEL[2]),
    (r"\bcohort\b", 3, LEVEL_LABEL[3]),
    (r"\bcase[- ]control\b", 4, "Case-control study"),
    (r"\bcross[- ]sectional\b", 4, "Cross-sectional study"),
    (r"\bcase (?:report|series)\b", 5, LEVEL_LABEL[5]),
    (r"\bin vitro\b|\bin mice\b|\bmurine\b|\brat model\b|\bmouse model\b", 7,
     LEVEL_LABEL[7]),
]

_SAMPLE_PATTERNS = [
    re.compile(r"\bn\s*=\s*([\d,]{2,})", re.I),
    # Up to three adjectives may sit between the count and the noun — "1,204 ICU
    # patients", "12,004 community-dwelling older adults". Only letters and
    # hyphens are allowed through, so the match cannot cross a clause boundary.
    re.compile(r"\b([\d,]{3,})\s+(?:[A-Za-z-]+\s+){0,3}?"
               r"(?:patients|participants|subjects|individuals|adults|women|men|"
               r"children|infants|neonates|cases|people|records|admissions)\b"),
    re.compile(r"\b(?:enrolled|randomi[sz]ed|included|recruited|followed)\s+"
               r"(?:up\s+)?([\d,]{3,})\b", re.I),
    re.compile(r"\b(?:cohort|sample|population|total)\s+of\s+([\d,]{3,})", re.I),
    re.compile(r"\b(?:comprising|totalling|totaling)\s+([\d,]{3,})", re.I),
]


@dataclass
class Domain:
    """One GRADE judgement, with the reason kept alongside it."""
    name: str
    verdict: str                 # "not serious" | "serious" | "very serious" | "upgrade"
    delta: int                   # steps applied to certainty
    reason: str

    def as_dict(self) -> dict:
        return {"name": self.name, "verdict": self.verdict,
                "delta": self.delta, "reason": self.reason}


@dataclass
class Grade:
    level: int
    label: str
    strength: str
    sample_size: int | None = None
    year: int | None = None
    age_years: int | None = None
    is_guideline: bool = False
    classified_by: str = "rule"          # rule | network | rule+network
    confidence: float = 1.0
    safeguards: list[str] = field(default_factory=list)
    missing_safeguards: list[str] = field(default_factory=list)
    rigour_score: float = 0.0
    stance: str | None = None
    stance_confidence: float = 0.0
    stance_decided_by: str = "none"
    effect: object | None = None
    domains: list[Domain] = field(default_factory=list)
    spans: list = field(default_factory=list)
    retracted: bool = False
    concern: bool = False
    rationale: str = ""

    @property
    def base_strength(self) -> str:
        return _BASE_STRENGTH[self.level]

    @property
    def downgrades(self) -> list[Domain]:
        return [d for d in self.domains if d.delta < 0]

    @property
    def upgrades(self) -> list[Domain]:
        return [d for d in self.domains if d.delta > 0]

    def as_dict(self) -> dict:
        return {"level": self.level, "label": self.label, "strength": self.strength,
                "sample_size": self.sample_size, "year": self.year,
                "is_guideline": self.is_guideline, "classified_by": self.classified_by,
                "confidence": round(self.confidence, 3),
                "safeguards": self.safeguards,
                "missing_safeguards": self.missing_safeguards,
                "rigour_score": round(self.rigour_score, 3),
                "stance": self.stance,
                "stance_confidence": round(self.stance_confidence, 3),
                "stance_decided_by": self.stance_decided_by,
                "effect": self.effect.format() if self.effect else None,
                "domains": [d.as_dict() for d in self.domains],
                "retracted": self.retracted, "concern": self.concern,
                "rationale": self.rationale,
                "spans": [{"text": t, "weight": w} for t, w in self.spans]}


# --------------------------------------------------------------- classification

def _rule_classify(article: Article) -> tuple[int, str, bool] | None:
    """Design from PubMed publication types and title, or None if unknown."""
    pts = {p.lower().strip() for p in article.publication_types}
    title = (article.title or "").lower()

    for needle, level, label in _DECISIVE_PUBTYPES:
        if needle in pts:
            return level, label, True

    for pattern, level, label in _TITLE_RULES:
        if re.search(pattern, title):
            return level, label, True

    if "observational study" in pts:
        return 3, LEVEL_LABEL[3], False
    if "cohort studies" in pts:
        return 3, LEVEL_LABEL[3], False
    if "clinical trial" in pts:
        return 3, "Clinical trial (non-randomised)", False

    for needle, level, label in _WEAK_PUBTYPES:
        if needle in pts:
            return level, label, False
    return None


def classify(article: Article, *, use_nn: bool = True) -> tuple[int, str, str, float]:
    """Return (level, label, decided_by, confidence).

    A decisive publication type always wins: those are human-assigned and the
    network has no information the indexer lacked. The network is consulted where
    PubMed is silent or only weakly indicative, and only when it is confident —
    otherwise Strata keeps the rule's answer and says so.
    """
    ruled = _rule_classify(article)
    if ruled and ruled[2]:
        return ruled[0], ruled[1], "rule", 1.0

    prediction = None
    if use_nn:
        try:
            from . import nn
            net = nn.design_net()
            if net is not None:
                prediction = net.predict(article.text(), explain=False)
        except Exception:
            prediction = None

    if prediction is not None and prediction.is_confident:
        level = _NN_LEVEL.get(prediction.label, 6)
        label = _NN_LABEL.get(prediction.label, LEVEL_LABEL[6])
        by = "rule+network" if ruled else "network"
        return level, label, by, prediction.confidence

    if ruled:
        return ruled[0], ruled[1], "rule", 0.7
    if prediction is not None:
        return (_NN_LEVEL.get(prediction.label, 6),
                _NN_LABEL.get(prediction.label, LEVEL_LABEL[6]),
                "network (low confidence)", prediction.confidence)
    return 6, "Unclassified", "rule", 0.3


# ------------------------------------------------------------------- features

def sample_size(text: str) -> int | None:
    """Largest plausible participant count stated in the text.

    The largest rather than the first: abstracts commonly mention a subgroup
    before the total, and the total is the number that bears on precision. Values
    above ten million are rejected as parse artefacts — usually a year range or a
    cost figure that matched the pattern.
    """
    best = None
    for pattern in _SAMPLE_PATTERNS:
        for m in pattern.finditer(text or ""):
            try:
                v = int(m.group(1).replace(",", ""))
            except ValueError:
                continue
            if 1 <= v <= 10_000_000:
                best = v if best is None else max(best, v)
    return best


def _rigour(article: Article, use_nn: bool):
    """(present, missing, score, spans) from the safeguard network."""
    if not use_nn:
        return [], [], 0.0, []
    try:
        from . import nn
        from .nn.corpus import RIGOUR_WEIGHT
        net = nn.rigour_net()
        if net is None:
            return [], [], 0.0, []
        pred = net.predict_labels(article.text())
        present = list(pred.present)
        missing = [l for l in pred.probs if l not in pred.present]
        return present, missing, pred.score(RIGOUR_WEIGHT), pred.evidence_spans
    except Exception:
        return [], [], 0.0, []


def _stance(article: Article, effect) -> tuple[str | None, float, str]:
    """Direction of the finding, from :mod:`strata.stance`.

    No network is involved. One was trained and measured against the same
    adversarial probes as everything else: it labelled every paper and got 36%
    of them right, while the rules labelled fewer and got 90% of those right.
    For a consensus meter a wrong vote corrupts the answer and an abstention only
    shrinks it, so precision wins and the rules ship. See ``strata.stance``.
    """
    result = stance_mod.infer(article.text(), effect)
    return result.label, result.confidence, result.decided_by


# -------------------------------------------------------------- GRADE domains

def _apply_domains(level: int, n: int | None, effect, safeguards: list[str],
                   article: Article) -> tuple[str, list[Domain]]:
    """Move certainty from its starting point, recording every reason."""
    idx = STRENGTH_ORDER.index(_BASE_STRENGTH[level])
    domains: list[Domain] = []

    def move(name, verdict, delta, reason):
        nonlocal idx
        idx = max(0, min(len(STRENGTH_ORDER) - 1, idx + delta))
        domains.append(Domain(name, verdict, delta, reason))

    # --- risk of bias -------------------------------------------------------
    if level == 2:                       # a trial that does not report masking
        if "blinded" not in safeguards:
            move("Risk of bias", "serious", -1,
                 "no blinding or masking is described")
        elif "itt" not in safeguards and "randomised" in safeguards:
            move("Risk of bias", "not serious", 0,
                 "randomised and blinded; no intention-to-treat analysis stated")
        else:
            move("Risk of bias", "not serious", 0,
                 "randomised, blinded, analysed by intention to treat")
    elif level in (3, 4):                # observational without adjustment
        if "confounding_adjusted" not in safeguards:
            move("Risk of bias", "serious", -1,
                 "no adjustment for confounding is described")
        else:
            move("Risk of bias", "not serious", 0,
                 "adjusted for measured confounding")
    elif level == 1:
        if "registered" in safeguards:
            move("Risk of bias", "not serious", 0,
                 "review protocol registered in advance")
        else:
            move("Risk of bias", "serious", -1,
                 "no prospective protocol registration is described")

    # --- imprecision --------------------------------------------------------
    if level <= 4:
        if n is not None and n < 100:
            move("Imprecision", "serious", -1, f"small sample (n = {n:,})")
        elif effect is not None and effect.has_interval and \
                effect.is_significant is False:
            move("Imprecision", "serious", -1,
                 "the confidence interval includes no effect")
        elif n is None:
            move("Imprecision", "serious", -1, "no sample size reported")
        else:
            move("Imprecision", "not serious", 0, f"n = {n:,}")

    # --- indirectness -------------------------------------------------------
    if level == 7:
        move("Indirectness", "very serious", 0,
             "preclinical: findings are not in humans")

    # --- upgrades for observational evidence --------------------------------
    # GRADE allows raising certainty for a large effect, and this is where an
    # enormous, well-adjusted cohort earns back the step its design cost it.
    if level in (3, 4) and effect is not None and effect.is_ratio \
            and effect.is_significant and effect.has_interval:
        if effect.estimate <= 0.5 or effect.estimate >= 2.0:
            move("Large effect", "upgrade", +1,
                 f"{effect.measure} {effect.estimate:.2f}, interval excludes no effect")

    if article.is_retracted:
        idx = 0
        domains.append(Domain("Retraction", "very serious", -3,
                              "this paper has been retracted"))
    elif article.has_expression_of_concern:
        move("Expression of concern", "serious", -1,
             "the journal has issued an expression of concern")

    return STRENGTH_ORDER[idx], domains


# ----------------------------------------------------------------- the grader

def grade(article: Article, current_year: int, *, use_nn: bool = True,
          explain: bool = False) -> Grade:
    """Place one paper on the pyramid and appraise it."""
    level, label, by, confidence = classify(article, use_nn=use_nn)
    text = article.text()
    n = sample_size(text)
    effects = stats.extract_effects(text)
    effect = stats.primary_effect(effects)
    present, missing, rigour_score, spans = _rigour(article, use_nn)
    stance_label, stance_conf, stance_by = _stance(article, effect)

    strength, domains = _apply_domains(level, n, effect, present, article)

    bits = [label]
    if article.is_guideline:
        bits.append("practice guideline")
    if n:
        bits.append(f"n = {n:,}")
    if article.year:
        bits.append(str(article.year))
    if article.is_retracted:
        bits.append("RETRACTED")

    return Grade(
        level=level, label=label, strength=strength, sample_size=n,
        year=article.year,
        age_years=(current_year - article.year) if article.year else None,
        is_guideline=article.is_guideline, classified_by=by, confidence=confidence,
        safeguards=present, missing_safeguards=missing, rigour_score=rigour_score,
        stance=stance_label, stance_confidence=stance_conf,
        stance_decided_by=stance_by, effect=effect,
        domains=domains, spans=spans if explain else [],
        retracted=article.is_retracted, concern=article.has_expression_of_concern,
        rationale=" · ".join(bits))


# ------------------------------------------------------- body-level assessment

@dataclass
class BodyAssessment:
    overall_strength: str
    best_level: int
    counts: dict
    level_counts: dict
    n_articles: int
    summary: str
    caveats: list[str] = field(default_factory=list)
    retracted_count: int = 0

    def as_dict(self) -> dict:
        return {"overall_strength": self.overall_strength,
                "best_level": self.best_level, "counts": self.counts,
                "level_counts": self.level_counts, "n_articles": self.n_articles,
                "summary": self.summary, "caveats": self.caveats,
                "retracted_count": self.retracted_count}


_PHRASE = {"high": "strong, high-certainty evidence",
           "moderate": "moderate-certainty evidence",
           "low": "weak evidence",
           "very low": "very weak evidence",
           "none": "no evidence"}


def summarize_body(grades: list[Grade], *, pooled=None,
                   disagreement: float = 0.0) -> BodyAssessment:
    """An honest verdict on the strength of the evidence taken together.

    Judged on the *best* available design, then adjusted downward for the things
    that only become visible across a body of evidence: a single study standing
    alone, papers that disagree with one another, and statistical heterogeneity
    when several report a comparable effect.
    """
    if not grades:
        return BodyAssessment("none", MAX_LEVEL, {}, {}, 0,
                              "No studies were retrieved for this question.")

    counts: dict[str, int] = {}
    level_counts = {i: 0 for i in range(1, MAX_LEVEL + 1)}
    for g in grades:
        counts[g.label] = counts.get(g.label, 0) + 1
        level_counts[g.level] += 1

    live = [g for g in grades if not g.retracted] or grades
    best = min(g.level for g in live)
    top = [g for g in live if g.level == best]
    overall = max((g.strength for g in top), key=STRENGTH_ORDER.index)
    idx = STRENGTH_ORDER.index(overall)
    caveats: list[str] = []

    if best <= 2 and len(top) == 1 and idx >= 2:
        idx -= 1
        caveats.append("rests on a single study at the strongest available level")

    if disagreement >= 0.5:
        idx = max(0, idx - 1)
        caveats.append("the retrieved studies do not agree on the direction of effect")

    if pooled is not None and pooled.i_squared >= 75:
        idx = max(0, idx - 1)
        caveats.append(f"heterogeneity across studies is considerable "
                       f"(I² = {pooled.i_squared:.0f}%)")

    retracted = sum(1 for g in grades if g.retracted)
    if retracted:
        caveats.append(f"{retracted} retrieved paper{'s' if retracted > 1 else ''} "
                       f"{'have' if retracted > 1 else 'has'} been retracted")

    if all(g.level >= 5 for g in live):
        caveats.append("nothing above the level of case reports and opinion was found")

    overall = STRENGTH_ORDER[idx]
    parts = [f"{c}× {lbl.lower()}" for lbl, c in
             sorted(counts.items(), key=lambda kv: -kv[1])[:3]]
    summary = (f"{_PHRASE[overall]} — the strongest available is "
               f"{LEVEL_LABEL.get(best, 'other').lower()} ({', '.join(parts)}).")

    return BodyAssessment(overall_strength=overall, best_level=best, counts=counts,
                          level_counts=level_counts, n_articles=len(grades),
                          summary=summary, caveats=caveats,
                          retracted_count=retracted)
