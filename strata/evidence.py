"""Evidence grading — the honest core.

Every retrieved paper is placed on the evidence pyramid from its PubMed
publication types and title, given a sample size and recency, and assigned a
plain-language strength. Aggregated over the top papers, this yields an honest
statement of how strong the answer's backing actually is — the thing a medical
chatbot never tells you.

The levels follow the standard hierarchy (Oxford CEBM / GRADE, simplified):

    1  Systematic review / meta-analysis   (strongest)
    2  Randomized controlled trial
    3  Cohort / prospective study
    4  Case-control / cross-sectional / observational
    5  Case report / case series
    6  Narrative review / editorial / opinion   (weakest)

This is a transparent heuristic, not a substitute for reading the papers — and
the tool says so.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .pubmed import Article

_LABELS = {1: "Systematic review / meta-analysis", 2: "Randomized controlled trial",
           3: "Cohort / prospective study", 4: "Observational study",
           5: "Case report / series", 6: "Review / opinion"}


@dataclass
class Grade:
    level: int
    label: str
    strength: str            # high | moderate | low | very low
    sample_size: int | None
    age_years: int | None
    is_guideline: bool
    rationale: str


def _classify(article: Article) -> tuple[int, str, bool]:
    """Return (level, label, is_guideline) from publication types then title.

    Publication types are the strongest signal; the title fills gaps PubMed
    rarely tags (cohort, cross-sectional). The ladder is ordered strongest-first
    so a design is caught at its true level — an RCT titled "a prospective
    randomized trial" is level 2, not a cohort.
    """
    pts = {p.lower() for p in article.publication_types}
    title = article.title.lower()
    guideline = any("guideline" in p for p in pts)

    def has(*needles):
        return any(n in s for s in pts for n in needles)

    if has("meta-analysis") or "meta-analysis" in title or "meta analysis" in title:
        return 1, _LABELS[1], guideline
    if has("systematic review") or "systematic review" in title:
        return 1, _LABELS[1], guideline
    if (has("randomized controlled trial", "controlled clinical trial")
            or "randomized" in title or "randomised" in title):
        return 2, _LABELS[2], guideline
    # title-based observational designs (PubMed rarely tags these as pub types)
    if "cohort" in title or "prospective" in title or "longitudinal" in title:
        return 3, _LABELS[3], guideline
    if "case-control" in title or "case control" in title:
        return 4, "Case-control study", guideline
    if "cross-sectional" in title or "cross sectional" in title or has("observational study"):
        return 4, _LABELS[4], guideline
    if has("clinical trial") or "clinical trial" in title:
        return 3, "Clinical trial", guideline
    if has("case reports") or "case report" in title or "case series" in title:
        return 5, _LABELS[5], guideline
    if has("review", "editorial", "comment", "letter", "news"):
        return 6, _LABELS[6], guideline
    return 6, "Unclassified", guideline


def _sample_size(text: str) -> int | None:
    best = None
    for m in re.finditer(r"\bn\s*=\s*([\d,]{2,})", text, re.I):
        best = max(best or 0, _num(m.group(1)))
    for m in re.finditer(r"\b([\d,]{3,})\s+(?:patients|participants|subjects|individuals|"
                         r"adults|women|men|children|cases|people)\b", text, re.I):
        best = max(best or 0, _num(m.group(1)))
    return best if best and best < 100_000_000 else best


def _num(s: str) -> int:
    try:
        return int(s.replace(",", ""))
    except ValueError:
        return 0


def _strength(level: int, n: int | None, age: int | None) -> str:
    base = {1: "high", 2: "high", 3: "moderate", 4: "low", 5: "very low", 6: "very low"}[level]
    order = ["very low", "low", "moderate", "high"]
    i = order.index(base)
    if n is not None and n < 50 and level <= 3:      # tiny study caps confidence
        i = min(i, 1)
    if age is not None and age > 15:                  # stale evidence
        i = max(0, i - 1)
    return order[i]


def grade(article: Article, current_year: int) -> Grade:
    level, label, guideline = _classify(article)
    n = _sample_size(f"{article.title}. {article.abstract}")
    age = (current_year - article.year) if article.year else None
    strength = _strength(level, n, age)
    bits = [label]
    if guideline:
        bits.append("practice guideline")
    if n:
        bits.append(f"n={n:,}")
    if age is not None:
        bits.append(f"{article.year}")
    return Grade(level=level, label=label, strength=strength, sample_size=n,
                 age_years=age, is_guideline=guideline, rationale=" · ".join(bits))


@dataclass
class BodyAssessment:
    overall_strength: str
    best_level: int
    counts: dict            # label -> count among graded articles
    n_articles: int
    summary: str


def summarize_body(grades: list[Grade]) -> BodyAssessment:
    """Honest one-line verdict on the strength of the evidence as a whole."""
    if not grades:
        return BodyAssessment("none", 6, {}, 0, "No studies retrieved.")
    counts: dict[str, int] = {}
    for g in grades:
        counts[g.label] = counts.get(g.label, 0) + 1
    best = min(g.level for g in grades)
    top = [g for g in grades if g.level == best]
    order = ["very low", "low", "moderate", "high"]
    overall = max((g.strength for g in top), key=order.index)
    # a lone strong study is weaker than several
    if best <= 2 and len(top) == 1 and overall == "high":
        overall = "moderate"
    phrase = {"high": "strong, high-quality evidence",
              "moderate": "moderate-quality evidence",
              "low": "weak evidence", "very low": "very weak evidence"}[overall]
    parts = [f"{c}× {lbl.lower()}" for lbl, c in
             sorted(counts.items(), key=lambda kv: -kv[1])[:3]]
    summary = (f"{phrase} — the strongest available is "
               f"{_LABELS.get(best, 'other').lower()} ({', '.join(parts)}).")
    return BodyAssessment(overall, best, counts, len(grades), summary)
