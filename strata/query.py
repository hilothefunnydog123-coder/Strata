"""The ask() pipeline: question -> ranked, graded evidence -> grounded answer.

    from strata import ask
    result = ask("Does metformin reduce cardiovascular mortality in type 2 diabetes?")
    print(result.answer)
    print(result.body.summary)          # how strong the backing actually is
    print(result.consensus.summary)     # and whether the papers agree

The stages, in order:

1. **Parse** the question into PICO and build a real boolean PubMed query. A
   question sent verbatim to PubMed matches "does" as hard as "metformin".
2. **Retrieve**, and broaden once if the precise query came back thin — an empty
   result from an over-specific query looks exactly like an empty literature and
   means something completely different.
3. **De-duplicate**, so the same trial indexed twice cannot manufacture a
   consensus by itself.
4. **Grade** each paper: design, GRADE domains, safeguards, stance, effect size.
5. **Rank** on evidence level, BM25 relevance, recency and methodological rigour.
6. **Assess** the body: consensus direction, indicative pooling, overall certainty.
7. **Answer**, either as a grounded digest built only from the retrieved
   abstracts, or — if a model is supplied — as a cited narrative anchored to the
   same papers and nothing else.

Pass a ``generate`` callable (any text-in/text-out model) for the narrative;
omit it and no model is involved at any point. Either way the facts come from
the papers: the model summarises, it is never the source of a fact.
"""
from __future__ import annotations

import datetime as _dt
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from . import consensus as consensus_mod
from . import pico as pico_mod
from . import ranking as rank_mod
from . import stats, synthesize
from .evidence import BodyAssessment, Grade, grade, summarize_body
from .pubmed import Article, search_with_total

#: Retrieve well beyond ``k`` so ranking has something to choose between —
#: PubMed's relevance order is the input to the re-rank, not a substitute for it.
DEFAULT_RETMAX = 40

#: Below this many usable results, retry with the broadened query.
_THIN_RESULT = 6


@dataclass
class Evidence:
    article: Article
    grade: Grade
    score: float
    breakdown: object = None

    def as_dict(self) -> dict:
        d = self.article.as_dict()
        d["grade"] = self.grade.as_dict()
        d["score"] = round(self.score, 4)
        if self.breakdown is not None:
            d["score_breakdown"] = self.breakdown.as_dict()
        return d


@dataclass
class Result:
    question: str
    answer: str
    body: BodyAssessment
    evidence: list[Evidence]
    grounded: bool
    pico: object = None
    query: str = ""
    query_translation: str = ""
    total_hits: int = 0
    retrieved: int = 0
    broadened: bool = False
    consensus: object = None
    pooled: object = None
    timeline: list = field(default_factory=list)
    duplicates_removed: int = 0
    elapsed: float = 0.0
    used_nn: bool = False

    def as_dict(self) -> dict:
        return {
            "question": self.question, "answer": self.answer,
            "grounded": self.grounded, "query": self.query,
            "query_translation": self.query_translation,
            "pico": self.pico.as_dict() if self.pico else None,
            "total_hits": self.total_hits, "retrieved": self.retrieved,
            "broadened": self.broadened,
            "duplicates_removed": self.duplicates_removed,
            "body": self.body.as_dict(),
            "consensus": self.consensus.as_dict() if self.consensus else None,
            "pooled": _pooled_dict(self.pooled),
            "timeline": self.timeline,
            "sources": [e.as_dict() for e in self.evidence],
            "elapsed": round(self.elapsed, 2), "used_nn": self.used_nn,
        }


def _pooled_dict(p) -> dict | None:
    if p is None:
        return None
    return {"measure": p.measure, "estimate": round(p.estimate, 4),
            "ci_low": round(p.ci_low, 4), "ci_high": round(p.ci_high, 4),
            "n_studies": p.n_studies, "i_squared": round(p.i_squared, 1),
            "tau_squared": round(p.tau_squared, 5),
            "q_p_value": round(p.q_p_value, 4), "p_value": round(p.p_value, 5),
            "scale": p.scale, "excludes_null": p.excludes_null,
            "heterogeneity": p.heterogeneity, "text": p.format()}


def rank(articles: list[Article], grades: list[Grade], current_year: int, *,
         keywords: Optional[list[str]] = None) -> list[Evidence]:
    """Order papers by the blended score. Exposed for testing and for callers
    who want to re-rank a set they retrieved themselves."""
    if not articles:
        return []

    keywords = keywords or []
    bm25 = rank_mod.BM25([a.text() for a in articles])
    raw = bm25.scores(keywords) if keywords else [0.0] * len(articles)
    if keywords:
        raw = [r + 1.5 * rank_mod.mesh_bonus(a, keywords)
               for r, a in zip(raw, articles)]
    relevance = rank_mod.normalize_scores(raw)

    out = []
    for i, (a, g) in enumerate(zip(articles, grades)):
        breakdown = rank_mod.combine(
            evidence=rank_mod.evidence_score(g.level),
            relevance=relevance[i],
            recency=rank_mod.recency_score(a.year, current_year),
            rigour=g.rigour_score,
            retracted=a.is_retracted,
            concern=a.has_expression_of_concern,
            no_abstract=not a.abstract)
        out.append(Evidence(article=a, grade=g, score=breakdown.total,
                            breakdown=breakdown))
    out.sort(key=lambda e: (-e.score, e.grade.level, -(e.article.year or 0)))
    return out


def ask(question: str, *, k: int = 8, retmax: int = DEFAULT_RETMAX,
        generate: Optional[Callable[[str], str]] = None,
        current_year: Optional[int] = None, use_nn: bool = True,
        design: Optional[str] = None, years: Optional[int] = None,
        explain: bool = False, progress: Optional[Callable[[str, str], None]] = None,
        _search=None) -> Result:
    """Answer a clinical question from graded PubMed evidence."""
    started = time.time()
    if current_year is None:
        current_year = _dt.date.today().year
    search = _search or search_with_total

    def step(stage: str, message: str) -> None:
        if progress:
            try:
                progress(stage, message)
            except Exception:
                pass

    # 1 — understand the question
    step("parse", "Reading the question")
    parsed = pico_mod.parse(question)
    query = pico_mod.build_query(parsed, design=design, years=years)

    # 2 — retrieve, broadening once if the precise query came back thin
    step("search", "Searching PubMed")
    articles, total, translation = search(query, retmax)
    broadened = False
    if len(articles) < _THIN_RESULT:
        fallback = pico_mod.broaden(parsed)
        if fallback != query:
            step("search", "Few results — broadening the search")
            more, more_total, more_translation = search(fallback, retmax)
            if len(more) > len(articles):
                articles, total, translation = more, more_total, more_translation
                query, broadened = fallback, True

    if not articles:
        body = summarize_body([])
        return Result(question=question, answer=synthesize.digest(question, [], body),
                      body=body, evidence=[], grounded=True, pico=parsed,
                      query=query, query_translation=translation, total_hits=total,
                      elapsed=time.time() - started, used_nn=False)

    # 3 — collapse duplicate records of the same study
    step("dedupe", f"Checking {len(articles)} records for duplicates")
    articles, dup_groups = rank_mod.deduplicate(articles)
    duplicates_removed = sum(len(g.dropped) for g in dup_groups)

    # 4 — grade
    step("grade", f"Grading {len(articles)} papers")
    grades = [grade(a, current_year, use_nn=use_nn, explain=explain)
              for a in articles]

    # 5 — rank and take the top k
    step("rank", "Ranking by evidence, relevance, recency and rigour")
    ranked = rank(articles, grades, current_year, keywords=parsed.keywords)[:k]

    # 6 — assess the body of evidence
    step("assess", "Weighing agreement and pooling effect sizes")
    agreement = consensus_mod.assess(ranked)
    # A withdrawn result must not move the pooled estimate. It stays visible in
    # the source list and on the forest plot, clearly marked, but it does not get
    # to contribute arithmetic to a number the user might act on.
    effects = [e.grade.effect for e in ranked
               if e.grade.effect is not None and not e.grade.retracted]
    pooled = stats.pool(effects)
    body = summarize_body([e.grade for e in ranked], pooled=pooled,
                          disagreement=consensus_mod.disagreement_index(agreement))
    line = consensus_mod.timeline(ranked)

    # 7 — answer
    step("answer", "Writing the answer" if generate else "Assembling the digest")
    if generate is not None:
        answer = synthesize.narrative(question, ranked, body, generate,
                                      consensus=agreement, pooled=pooled)
        grounded = False
    else:
        answer = synthesize.digest(question, ranked, body, consensus=agreement,
                                   pooled=pooled)
        grounded = True

    used_nn = use_nn and any(g.classified_by != "rule" or g.stance for g in grades)
    return Result(question=question, answer=answer, body=body, evidence=ranked,
                  grounded=grounded, pico=parsed, query=query,
                  query_translation=translation, total_hits=total,
                  retrieved=len(articles), broadened=broadened,
                  consensus=agreement, pooled=pooled, timeline=line,
                  duplicates_removed=duplicates_removed,
                  elapsed=time.time() - started, used_nn=used_nn)


@dataclass
class Comparison:
    """Two interventions, each answered independently, then set side by side."""
    question: str
    left: Result
    right: Result
    verdict: str

    def as_dict(self) -> dict:
        return {"question": self.question, "verdict": self.verdict,
                "left": self.left.as_dict(), "right": self.right.as_dict()}


def compare(intervention_a: str, intervention_b: str, *, outcome: str = "",
            k: int = 6, **kw) -> Comparison:
    """Grade the evidence for two interventions and report which is better backed.

    Deliberately not a head-to-head effect estimate. Comparing the pooled result
    of one set of trials against the pooled result of a different set is an
    indirect comparison, and doing it naively is how you conclude that whichever
    drug was studied in sicker patients is the worse drug. What this reports is
    which intervention has the stronger *evidence base* — a question the
    retrieved literature can actually answer.
    """
    tail = f" for {outcome}" if outcome else ""
    left = ask(f"Is {intervention_a} effective{tail}?", k=k, **kw)
    right = ask(f"Is {intervention_b} effective{tail}?", k=k, **kw)

    order = ["none", "very low", "low", "moderate", "high"]

    def rankof(r):
        s = r.body.overall_strength
        return order.index(s) if s in order else 0

    la, lb = rankof(left), rankof(right)
    if la == lb:
        verdict = (f"The evidence base for {intervention_a} and {intervention_b} "
                   f"is of comparable certainty ({left.body.overall_strength}). "
                   f"This does not mean the two are equally effective — no "
                   f"head-to-head comparison was made.")
    else:
        stronger, weaker = ((intervention_a, intervention_b) if la > lb
                            else (intervention_b, intervention_a))
        s_res = left if la > lb else right
        w_res = right if la > lb else left
        verdict = (f"{stronger} is the better-evidenced of the two "
                   f"({s_res.body.overall_strength} vs "
                   f"{w_res.body.overall_strength} certainty). That is a "
                   f"statement about the strength of the literature, not a "
                   f"head-to-head result: no trial compared them directly here.")
    return Comparison(question=f"{intervention_a} vs {intervention_b}{tail}",
                      left=left, right=right, verdict=verdict)
