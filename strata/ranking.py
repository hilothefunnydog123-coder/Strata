"""Ranking and de-duplication of a retrieved result set.

PubMed's own relevance order is a reasonable starting point and a poor finishing
one: it knows nothing about study design, and it will happily put a 2004 letter
above a 2023 meta-analysis. Strata re-ranks on four things it can defend:

    evidence level   where the study sits on the pyramid
    relevance        BM25 over the question's terms, plus MeSH agreement
    recency          a gentle decay, not a cliff
    rigour           what safeguards the methods section actually reports

Relevance is BM25 rather than a learned model. That is a considered choice: the
bi-encoder trained for this job overfit badly on a corpus of forty topics (see
:class:`strata.nn.model.BiEncoder`), while BM25 needs no training, has no
failure mode that depends on subject matter, and is the standard baseline that
learned retrievers are measured against for good reason.

De-duplication runs first. The same trial is often indexed twice — a primary
report and a secondary analysis, or an epub and a print version — and counting
it twice manufactures a consensus out of a single study.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

_TOKEN = re.compile(r"[a-z][a-z0-9-]{2,}")

# Standard BM25 constants: k1 controls how fast term frequency saturates, b how
# strongly length normalisation applies. Unchanged from the defaults because
# there is no held-out relevance data here on which to tune them honestly.
BM25_K1 = 1.5
BM25_B = 0.75


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall((text or "").lower())


# ------------------------------------------------------------------- BM25

class BM25:
    """Okapi BM25 over the retrieved set.

    The corpus is the result set itself, which is the right scope: IDF computed
    over twenty-five papers all about vitamin D correctly says that "vitamin"
    carries no information *here*, even though it is rare in PubMed as a whole.
    """

    def __init__(self, documents: list[str]):
        self.docs = [tokenize(d) for d in documents]
        self.n = len(self.docs)
        self.avg_len = (sum(len(d) for d in self.docs) / self.n) if self.n else 0.0
        self.freqs: list[dict[str, int]] = []
        df: dict[str, int] = {}
        for doc in self.docs:
            f: dict[str, int] = {}
            for t in doc:
                f[t] = f.get(t, 0) + 1
            self.freqs.append(f)
            for t in f:
                df[t] = df.get(t, 0) + 1
        # Robertson-Sparck Jones IDF with the +0.5 smoothing, floored at zero so
        # a term present in every document contributes nothing rather than
        # subtracting score from documents that contain it.
        self.idf = {t: max(0.0, math.log(1.0 + (self.n - c + 0.5) / (c + 0.5)))
                    for t, c in df.items()}

    def score(self, index: int, query_terms: list[str]) -> float:
        if not self.n or index >= len(self.docs):
            return 0.0
        f = self.freqs[index]
        length = len(self.docs[index]) or 1
        total = 0.0
        for t in query_terms:
            tf = f.get(t, 0)
            if not tf:
                continue
            idf = self.idf.get(t, 0.0)
            denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * length / (self.avg_len or 1))
            total += idf * (tf * (BM25_K1 + 1)) / denom
        return total

    def scores(self, query_terms: list[str]) -> list[float]:
        return [self.score(i, query_terms) for i in range(self.n)]


def normalize_scores(values: list[float]) -> list[float]:
    """Scale to [0, 1]. A flat list maps to all-zero, not all-one: if nothing
    separates the documents, relevance should contribute nothing to the ranking
    rather than contributing equally to everything."""
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi - lo < 1e-12:
        return [0.0] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


# ----------------------------------------------------------- de-duplication

def shingles(text: str, size: int = 4) -> set[tuple]:
    toks = tokenize(text)
    if len(toks) < size:
        return {tuple(toks)} if toks else set()
    return {tuple(toks[i:i + size]) for i in range(len(toks) - size + 1)}


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / (len(a) + len(b) - inter)


@dataclass
class DuplicateGroup:
    keep: int                    # index of the record retained
    dropped: list[int]           # indices folded into it
    reason: str


def find_duplicates(articles, threshold: float = 0.55) -> list[DuplicateGroup]:
    """Group near-identical records, keeping the most informative of each.

    Two signals, in order of confidence: an identical DOI is decisive, and a high
    shingle overlap between title-plus-abstract catches the rest. The record kept
    is the one with the fuller abstract, since the others are usually truncated
    duplicates of it — except that a retracted record never displaces a clean one
    silently, because the retraction is the more important fact.
    """
    n = len(articles)
    groups: list[DuplicateGroup] = []
    merged = set()
    sigs = [shingles(a.text()) for a in articles]

    for i in range(n):
        if i in merged:
            continue
        members = []
        for j in range(i + 1, n):
            if j in merged:
                continue
            reason = ""
            if articles[i].doi and articles[i].doi == articles[j].doi:
                reason = "same DOI"
            elif jaccard(sigs[i], sigs[j]) >= threshold:
                reason = "near-identical text"
            if reason:
                members.append((j, reason))
        if not members:
            continue

        candidates = [i] + [j for j, _ in members]
        # Prefer a retracted record so the retraction is never hidden; otherwise
        # prefer the fullest abstract.
        keep = max(candidates, key=lambda k: (articles[k].is_retracted,
                                              len(articles[k].abstract),
                                              articles[k].year or 0))
        dropped = [k for k in candidates if k != keep]
        merged.update(dropped)
        groups.append(DuplicateGroup(keep=keep, dropped=dropped,
                                     reason=members[0][1]))
    return groups


def deduplicate(articles) -> tuple[list, list[DuplicateGroup]]:
    """Return (kept articles, groups). Order of the survivors is preserved."""
    groups = find_duplicates(articles)
    dropped = {k for g in groups for k in g.dropped}
    return [a for i, a in enumerate(articles) if i not in dropped], groups


# ------------------------------------------------------------------ ranking

#: Contribution of each component to the final score. Evidence level leads
#: because Strata's whole claim is that design is the first thing that matters;
#: relevance is close behind because a strong study of the wrong question is
#: worth nothing at all.
WEIGHTS = {"evidence": 0.38, "relevance": 0.32, "recency": 0.16, "rigour": 0.14}


def recency_score(year: int | None, current_year: int, half_life: float = 12.0) -> float:
    """Exponential decay with a twelve-year half-life, clamped to [0, 1].

    Not a cliff: a 2009 landmark trial is still a landmark trial, and a cutoff
    would discard it entirely. Papers dated in the future — PubMed does carry a
    few — are treated as current rather than rewarded for it.
    """
    if not year:
        return 0.35                      # unknown date: neither rewarded nor punished
    age = max(0, current_year - year)
    return 0.5 ** (age / half_life)


def evidence_score(level: int, max_level: int = 7) -> float:
    """Level 1 scores 1.0, the bottom of the pyramid scores 0."""
    level = max(1, min(level, max_level))
    return (max_level - level) / (max_level - 1)


@dataclass
class ScoreBreakdown:
    """Every component of a paper's rank, kept so the UI can explain the order."""
    total: float
    evidence: float
    relevance: float
    recency: float
    rigour: float
    penalty: float = 0.0
    note: str = ""

    def as_dict(self) -> dict:
        return {"total": round(self.total, 4), "evidence": round(self.evidence, 3),
                "relevance": round(self.relevance, 3), "recency": round(self.recency, 3),
                "rigour": round(self.rigour, 3), "penalty": round(self.penalty, 3),
                "note": self.note}


def combine(*, evidence: float, relevance: float, recency: float, rigour: float,
            retracted: bool = False, concern: bool = False,
            no_abstract: bool = False) -> ScoreBreakdown:
    """Blend the components and apply penalties.

    A retracted paper is pushed to the bottom rather than removed. Removing it
    would leave the user unable to see that the literature they half-remember has
    been withdrawn, which is information they need more than they need a tidy
    list.
    """
    total = (WEIGHTS["evidence"] * evidence + WEIGHTS["relevance"] * relevance
             + WEIGHTS["recency"] * recency + WEIGHTS["rigour"] * rigour)
    penalty = 0.0
    notes = []
    if retracted:
        penalty += 0.85
        notes.append("retracted")
    elif concern:
        penalty += 0.25
        notes.append("expression of concern")
    if no_abstract:
        penalty += 0.12
        notes.append("no abstract")
    return ScoreBreakdown(total=max(0.0, total - penalty), evidence=evidence,
                          relevance=relevance, recency=recency, rigour=rigour,
                          penalty=penalty, note=", ".join(notes))


def mesh_bonus(article, keywords: list[str]) -> float:
    """Fraction of question keywords that appear in the paper's MeSH headings.

    MeSH terms are assigned by human indexers reading the full text, so agreement
    here is a stronger relevance signal than a word appearing in the abstract.
    """
    if not article.mesh_terms or not keywords:
        return 0.0
    blob = " ".join(article.mesh_terms).lower()
    hits = sum(1 for k in keywords if k in blob)
    return min(1.0, hits / max(1, min(len(keywords), 5)))
