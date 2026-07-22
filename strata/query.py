"""The ask() pipeline: question -> ranked, graded evidence -> grounded answer.

    from strata import ask
    result = ask("Does metformin reduce cardiovascular mortality in type 2 diabetes?")
    print(result.answer)

Pass a ``generate`` callable (any text-in/text-out model) to get a synthesized,
inline-cited narrative; omit it and you get a grounded evidence digest built
purely from the retrieved abstracts. Either way the answer is anchored to real,
graded citations — the model is never the source of a fact, only a summariser.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

from .evidence import BodyAssessment, Grade, grade, summarize_body
from .pubmed import Article, search_articles
from . import synthesize


@dataclass
class Evidence:
    article: Article
    grade: Grade
    score: float


@dataclass
class Result:
    question: str
    answer: str
    body: BodyAssessment
    evidence: list[Evidence]
    grounded: bool          # False => an LLM synthesised the narrative


def rank(articles: list[Article], grades: list[Grade], current_year: int) -> list[Evidence]:
    ranked = []
    n = max(len(articles), 1)
    for i, (a, g) in enumerate(zip(articles, grades)):
        ev_weight = (7 - g.level)                                   # 1..6 -> 6..1
        recency = max(0.0, 1 - (current_year - (a.year or current_year)) / 20)
        relevance = max(0.0, 1 - i / n)                             # PubMed's own order
        score = ev_weight * 2 + recency * 2 + relevance * 3
        ranked.append(Evidence(a, g, score))
    ranked.sort(key=lambda e: -e.score)
    return ranked


def ask(question: str, *, k: int = 8, retmax: int = 25,
        generate: Optional[Callable[[str], str]] = None,
        current_year: Optional[int] = None,
        _search=search_articles) -> Result:
    if current_year is None:
        import datetime as _dt
        current_year = _dt.date.today().year

    articles = _search(question, retmax=retmax)
    grades = [grade(a, current_year) for a in articles]
    ranked = rank(articles, grades, current_year)[:k]
    body = summarize_body([e.grade for e in ranked])

    if generate is not None:
        answer = synthesize.narrative(question, ranked, body, generate)
        grounded = False
    else:
        answer = synthesize.digest(question, ranked, body)
        grounded = True
    return Result(question=question, answer=answer, body=body,
                  evidence=ranked, grounded=grounded)
