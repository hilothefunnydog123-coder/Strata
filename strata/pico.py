"""Turning a clinical question into a PubMed query.

A question typed by a human — "does vitamin D prevent respiratory infections?" —
makes a poor search string. Sent to PubMed verbatim it matches on every word
equally, including "does" and "prevent", and buries the trials under commentary.

This module reads the question into its PICO parts (Population, Intervention,
Comparator, Outcome), expands the clinical terms it recognises, and builds a
proper boolean query with field tags. The parse is a heuristic over cue words,
not a parser with a grammar, and it is written to degrade safely: anything it
cannot identify stays in the query as a free-text term, so a failed parse
produces a slightly worse search rather than a wrong one.

    >>> p = parse("Does vitamin D prevent respiratory infections in children?")
    >>> p.intervention, p.outcome, p.population
    ('vitamin d', 'respiratory infections', 'children')
    >>> build_query(p)                                    # doctest: +ELLIPSIS
    '("vitamin d"[tiab] OR ...) AND (...) AND hasabstract'
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Words that carry no retrieval value in a clinical question.
_STOP = frozenset("""
a an the is are was were do does did doing done can could should would will
shall may might must have has had of in on at to for from by with without
and or but if then than that this these those there here it its their his her
about into over under between among during after before while as such any some
all more most much many few new old best better good bad
what which who whom whose when where why how
patient patients people person adults adult child children women men
effect effects effective effectiveness efficacy efficacious impact influence
role use using used usage benefit benefits risk risks safety outcome outcomes
evidence study studies trial trials research compared comparison versus vs
help helps helping work works working treat treats treating treatment
""".split())

# Cue words that mark where each PICO element begins.
_OUTCOME_CUES = re.compile(
    r"\b(?:prevent(?:s|ing|ion)?|reduc(?:e|es|ing|tion)|improv(?:e|es|ing|ement)|"
    r"increas(?:e|es|ing)|lower(?:s|ing)?|rais(?:e|es|ing)|treat(?:s|ing|ment)?|"
    r"cur(?:e|es|ing)|delay(?:s|ing)?|slow(?:s|ing)?|caus(?:e|es|ing)|"
    r"protect(?:s|ing)? against|lead(?:s|ing)? to|affect(?:s|ing)?|"
    r"influenc(?:e|es|ing)|on|for)\b", re.I)

_POPULATION_CUES = re.compile(
    r"\b(?:in|among|for|amongst|within)\s+((?:patients?|adults?|children|infants?|"
    r"neonates?|adolescents?|women|men|older adults?|the elderly|people|"
    r"individuals?)[^?.,;]*|[^?.,;]*?\bwith\b[^?.,;]*)", re.I)

# Fallback for the very common "… in <condition>" ending, which names a
# population without naming a person: "…mortality in type 2 diabetes".
_TRAILING_IN = re.compile(r"\bin\s+([a-z0-9][a-z0-9\s-]{2,40})$", re.I)

_COMPARATOR_CUES = re.compile(
    r"\b(?:versus|vs\.?|compared (?:with|to)|rather than|or)\b", re.I)

_LEADING = re.compile(
    r"^\s*(?:does|do|did|is|are|was|were|can|could|should|would|will|"
    r"what(?:'s| is)?|which|how|why|when|who)\b\s*", re.I)

# A small, curated expansion table. Deliberately conservative: every entry is a
# genuine synonym or the term's standard MeSH heading, because a loose expansion
# does more damage to precision than a missing one does to recall.
_EXPANSIONS = {
    "vitamin d": ["cholecalciferol", "ergocalciferol", "25-hydroxyvitamin d"],
    "vitamin c": ["ascorbic acid"],
    "heart attack": ["myocardial infarction"],
    "stroke": ["cerebrovascular accident"],
    "high blood pressure": ["hypertension"],
    "blood pressure": ["hypertension"],
    "sugar": ["glucose"],
    "diabetes": ["diabetes mellitus"],
    "heart failure": ["cardiac failure"],
    "kidney disease": ["renal insufficiency"],
    "flu": ["influenza"],
    "cold": ["common cold"],
    "painkillers": ["analgesics"],
    "antibiotics": ["anti-bacterial agents"],
    "statins": ["hydroxymethylglutaryl-coa reductase inhibitors"],
    "aspirin": ["acetylsalicylic acid"],
    "exercise": ["physical activity", "exercise therapy"],
    "diet": ["dietary intervention"],
    "weight loss": ["weight reduction"],
    "obesity": ["overweight"],
    "depression": ["depressive disorder"],
    "anxiety": ["anxiety disorders"],
    "insomnia": ["sleep initiation and maintenance disorders"],
    "dementia": ["alzheimer disease", "cognitive decline"],
    "cancer": ["neoplasms"],
    "smoking": ["tobacco use", "smoking cessation"],
    "heart disease": ["cardiovascular diseases"],
    "cholesterol": ["hypercholesterolemia", "lipids"],
    "infection": ["infections"],
    "mortality": ["death", "survival"],
    "death": ["mortality"],
    "pain": ["pain management"],
}

#: PubMed filters for restricting a search to a level of the pyramid.
DESIGN_FILTERS = {
    "systematic_review": "(meta-analysis[pt] OR systematic review[pt] OR systematic[sb])",
    "rct": "(randomized controlled trial[pt] OR controlled clinical trial[pt])",
    "trials": "(randomized controlled trial[pt] OR controlled clinical trial[pt] "
              "OR clinical trial[pt])",
    "observational": "(cohort studies[mh] OR case-control studies[mh] "
                     "OR cross-sectional studies[mh])",
    "guideline": "(practice guideline[pt] OR guideline[pt])",
}


@dataclass
class PICO:
    question: str
    intervention: str = ""
    comparator: str = ""
    outcome: str = ""
    population: str = ""
    keywords: list[str] = field(default_factory=list)

    @property
    def is_comparative(self) -> bool:
        return bool(self.comparator)

    def as_dict(self) -> dict:
        return {"population": self.population, "intervention": self.intervention,
                "comparator": self.comparator, "outcome": self.outcome,
                "keywords": self.keywords}

    def summary(self) -> str:
        bits = []
        for label, value in (("P", self.population), ("I", self.intervention),
                             ("C", self.comparator), ("O", self.outcome)):
            if value:
                bits.append(f"{label}: {value}")
        return " · ".join(bits) if bits else "free-text search"


def _clean_phrase(text: str) -> str:
    text = re.sub(r"[?.!,;:]+$", "", (text or "").strip())
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -–—").lower()


def content_words(text: str) -> list[str]:
    """Content-bearing tokens, order preserved, duplicates removed."""
    out, seen = [], set()
    for w in re.findall(r"[a-z][a-z0-9-]+", (text or "").lower()):
        if w in _STOP or len(w) < 3 or w in seen:
            continue
        seen.add(w)
        out.append(w)
    return out


def parse(question: str) -> PICO:
    """Read a question into PICO parts. Never raises; unparsed text survives."""
    q = _clean_phrase(question)
    if not q:
        return PICO(question=question or "")

    body = _LEADING.sub("", q).strip()
    population = ""

    pm = _POPULATION_CUES.search(body)
    if pm:
        candidate = _clean_phrase(pm.group(1))
        # "in children" is a population; "in reducing mortality" is not.
        if candidate and not _OUTCOME_CUES.match(candidate):
            population = candidate
            body = (body[:pm.start()] + " " + body[pm.end():]).strip()
    else:
        tm = _TRAILING_IN.search(body)
        if tm:
            candidate = _clean_phrase(tm.group(1))
            if candidate and not _OUTCOME_CUES.match(candidate):
                population = candidate
                body = body[:tm.start()].strip()

    comparator = ""
    tail_outcome = ""
    cm = _COMPARATOR_CUES.search(body)
    if cm and cm.group(0).lower() not in ("or", "for"):
        comparator = _clean_phrase(body[cm.end():])
        body = body[:cm.start()].strip()
        # The comparator may have swallowed the outcome: "A versus B for pain".
        om = _OUTCOME_CUES.search(comparator)
        if om and om.start() > 0:
            tail_outcome = _clean_phrase(comparator[om.end():])
            comparator = _clean_phrase(comparator[:om.start()])

    intervention, outcome = body, tail_outcome
    om = _OUTCOME_CUES.search(body)
    if om and om.start() > 0:
        intervention = _clean_phrase(body[:om.start()])
        outcome = _clean_phrase(body[om.end():]) or tail_outcome

    intervention = _strip_stopwords(intervention)
    outcome = _strip_stopwords(outcome)
    comparator = _strip_stopwords(comparator)

    keywords = content_words(" ".join([intervention, outcome, comparator,
                                       population])) or content_words(q)
    return PICO(question=question, intervention=intervention, comparator=comparator,
                outcome=outcome, population=population, keywords=keywords)


def _strip_stopwords(phrase: str) -> str:
    """Trim leading and trailing filler without gutting the middle of a phrase."""
    words = (phrase or "").split()
    while words and words[0] in _STOP:
        words.pop(0)
    while words and words[-1] in _STOP:
        words.pop()
    return " ".join(words)


def expand(term: str) -> list[str]:
    """A term plus its curated synonyms, longest match first."""
    t = _clean_phrase(term)
    if not t:
        return []
    out = [t]
    for key, syns in _EXPANSIONS.items():
        if key in t:
            out.extend(syns)
    # single-word fallback: expand the individual content words too
    if len(out) == 1:
        for w in content_words(t):
            out.extend(_EXPANSIONS.get(w, []))
    seen, unique = set(), []
    for v in out:
        if v not in seen:
            seen.add(v)
            unique.append(v)
    return unique


def _clause(term: str) -> str:
    """One OR-group of a term and its synonyms, searched in title/abstract.

    A short term goes out as an exact phrase. A long one does not: PubMed matches
    ``"cardiovascular mortality in type 2 diabetes"[tiab]`` as a literal string
    and it appears in essentially no abstract, so a clause like that silently
    empties the whole result set. Long phrases are ANDed word by word instead.
    """
    parts = []
    for v in expand(term):
        words = v.split()
        if len(words) <= 3:
            parts.append(f'"{v}"[tiab]')
        else:
            content = content_words(v)[:4]
            if content:
                parts.append("(" + " AND ".join(f'"{w}"[tiab]' for w in content) + ")")
    if not parts:
        return ""
    return "(" + " OR ".join(parts) + ")"


def build_query(pico: PICO, *, design: str | None = None,
                years: int | None = None, require_abstract: bool = True) -> str:
    """Assemble a PubMed boolean query from a parsed question.

    The intervention is required; outcome and population are ANDed in only when
    they were confidently identified, because over-constraining a search is the
    faster way to an empty result set than under-constraining it is to a noisy
    one. If nothing parsed, the original question goes out as free text.
    """
    clauses = []
    for part in (pico.intervention, pico.comparator, pico.outcome):
        c = _clause(part)
        if c:
            clauses.append(c)

    if pico.population and len(pico.population.split()) <= 6:
        c = _clause(pico.population)
        if c:
            clauses.append(c)

    if not clauses:
        terms = pico.keywords or content_words(pico.question)
        if not terms:
            return pico.question.strip() or "medicine"
        clauses = ["(" + " OR ".join(f'"{t}"[tiab]' for t in terms[:6]) + ")"]
        query = " AND ".join(clauses)
    else:
        # The intervention and comparator are mandatory; the outcome and
        # population are ORed against the intervention so a paper that omits the
        # outcome word from its abstract is not silently excluded.
        query = " AND ".join(clauses[:2]) if len(clauses) > 1 else clauses[0]
        if len(clauses) > 2:
            query += " AND (" + " OR ".join(clauses[2:]) + ")"

    if design and design in DESIGN_FILTERS:
        query += f" AND {DESIGN_FILTERS[design]}"
    if years:
        query += f' AND ("last {years} years"[dp])'
    if require_abstract:
        query += " AND hasabstract"
    return query


def broaden(pico: PICO, *, require_abstract: bool = True) -> str:
    """A looser fallback query for when the precise one returns too little.

    Drops every AND except the intervention. Strata retries with this rather than
    reporting "no evidence", because an empty result caused by an over-specific
    query and an empty result caused by an empty literature look identical to the
    user and mean completely different things.
    """
    terms = pico.keywords[:5] or content_words(pico.question)[:5]
    if not terms:
        return pico.question.strip() or "medicine"
    q = "(" + " OR ".join(f'"{t}"[tiab]' for t in terms) + ")"
    return q + (" AND hasabstract" if require_abstract else "")
