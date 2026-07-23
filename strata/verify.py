"""Strata Verify — the pipeline, and the public demonstration of the engine.

A question (or a stored claim) goes in; an **auditable verdict** comes out. The
answer is never "studies show…". It is: here are the exact studies that support
the claim, here are the ones that weaken it, here is how well each matches the
population, and here — domain by domain — is why the evidence is or is not
strong.

    question
      → PICO structuring            (pico.structure)
      → query expansion             (pico.expand_query)
      → multi-source retrieval      (sources.retrieve)   [parallel, deduped]
      → per-study extraction        (extract.extract)    [provenance-tagged]
      → study-design grading        (evidence.grade)
      → stance vs the claim         (contradiction)      [support / contradict + why]
      → transparent strength        (assess.assess)      [inspectable domains]
      → grounded answer + audit trail

Every step records what it did and how many items it touched, so the conclusion
can be traced end to end. Facts come only from retrieved abstracts; a model, if
present, may phrase the narrative but is never the source of a fact.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from . import assess as _assess
from . import contradiction as _contra
from . import pico as _pico
from .evidence import grade as _grade
from .extract import extract as _extract
from .models import ModelRouter, ROUTER
from .pubmed import Article
from .sources import retrieve as _retrieve, RetrievalResult


@dataclass
class EvidenceLine:
    n: int
    article: Article
    extraction: Dict[str, Any]
    grade: Any
    stance: str
    stance_reason: str
    disagreement_type: Optional[str]
    population_match: Dict[str, Any]
    relevance: float

    def to_dict(self) -> Dict[str, Any]:
        a, g, e = self.article, self.grade, self.extraction
        effects = e.get("effects") or []
        return {
            "n": self.n, "title": a.title, "year": a.year, "journal": a.journal,
            "url": a.url, "pmid": a.pmid, "doi": a.doi, "source": a.source,
            "study_type": g.label, "level": g.level, "strength": g.strength,
            "is_guideline": g.is_guideline,
            "stance": self.stance, "stance_reason": self.stance_reason,
            "disagreement_type": self.disagreement_type,
            "disagreement_label": _contra.DISAGREEMENT_LABELS.get(self.disagreement_type or ""),
            "relevance": round(self.relevance, 3),
            "sample_size": (e.get("sample_size") or {}).get("value") if e.get("sample_size") else None,
            "effect": effects[0] if effects else None,
            "population_match": self.population_match,
            "direction": e.get("direction"),
            "basis": e.get("basis"), "basis_note": e.get("basis_note"),
            "snippet": _first_sentences(a.abstract) or "(no abstract available)",
        }


@dataclass
class Verdict:
    question: str
    pico: Dict[str, Any]
    query: str
    status: str
    evidence_strength: str
    assessment: Dict[str, Any]
    lines: List[EvidenceLine]
    answer: str
    grounded: bool
    retrieval: Dict[str, Any]
    audit_trail: List[Dict[str, Any]]
    fingerprint: str

    @property
    def supporting(self) -> List[EvidenceLine]:
        return [l for l in self.lines if l.stance == "supporting"]

    @property
    def contradicting(self) -> List[EvidenceLine]:
        return [l for l in self.lines if l.stance == "contradicting"]

    @property
    def neutral(self) -> List[EvidenceLine]:
        return [l for l in self.lines if l.stance == "neutral"]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "question": self.question, "pico": self.pico, "query": self.query,
            "claim_status": self.status, "evidence_strength": self.evidence_strength,
            "assessment": self.assessment,
            "supporting_evidence": [l.to_dict() for l in self.supporting],
            "contradicting_evidence": [l.to_dict() for l in self.contradicting],
            "neutral_evidence": [l.to_dict() for l in self.neutral],
            "key_limitations": self.assessment.get("limitations", []),
            "supporting_reasons": self.assessment.get("reasons", []),
            "answer": self.answer, "grounded": self.grounded,
            "retrieval": self.retrieval, "audit_trail": self.audit_trail,
            "evidence_fingerprint": self.fingerprint,
            "basis": self.assessment.get("basis", "abstract-level"),
            "disclaimer": ("Decision support from public literature — not medical advice, "
                           "and not a substitute for reading the primary sources."),
        }


def _first_sentences(text: str, n: int = 2) -> str:
    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return " ".join(parts[:n]).strip()


def _relevance(article: Article, terms: List[str]) -> float:
    if not terms:
        return 0.5
    hay = f"{article.title} {article.abstract}".lower()
    hits = sum(1 for t in set(t.lower() for t in terms) if t and t in hay)
    denom = len(set(t.lower() for t in terms if t))
    return hits / denom if denom else 0.5


def _fingerprint(lines: List[EvidenceLine]) -> str:
    """Stable identity of the evidence set + each study's directional read.

    Changes when a study is added/removed or when a study's direction flips —
    exactly the events the monitor needs to detect materially new evidence.
    """
    parts = sorted(f"{l.article.dedup_key}:{(l.extraction.get('direction') or {}).get('value')}"
                   for l in lines)
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def verify(question: str, *, k: int = 10, retmax: int = 25,
           sources: Optional[List[str]] = None,
           claim_population: Optional[Dict[str, Any]] = None,
           router: ModelRouter = ROUTER,
           current_year: Optional[int] = None,
           retrieve_fn: Callable[..., RetrievalResult] = _retrieve) -> Verdict:
    """Run the full verification pipeline for a question or claim."""
    if current_year is None:
        import datetime as _dt
        current_year = _dt.date.today().year

    trail: List[Dict[str, Any]] = []

    # 1-2. structure + expand
    pico = _pico.structure(question, router=router)
    exp = _pico.expand_query(pico)
    query = exp["query"]
    claim_pop = claim_population or pico.population
    trail.append({"step": "structure_question", "detail": "parsed PICO",
                  "confident": pico.confident, "pico": pico.as_dict()})
    trail.append({"step": "expand_query", "detail": query, "notes": exp["notes"]})

    # 3. retrieve
    result = retrieve_fn(query, retmax, sources=sources)
    trail.append({"step": "retrieve", "detail": "multi-source search",
                  "per_source": result.per_source, "errors": result.errors,
                  "retrieved": result.retrieved_total})
    trail.append({"step": "deduplicate",
                  "detail": f"{result.retrieved_total} → {result.unique} unique",
                  "duplicates_removed": max(0, result.retrieved_total - result.unique)})

    polarity = _contra.claim_polarity(question)

    # 4-6. extract, grade, stance, relevance
    raw_lines: List[EvidenceLine] = []
    for art in result.articles:
        extraction = _extract(art)
        g = _grade(art, current_year)
        pop = _contra.population_match(claim_pop, extraction.get("population"))
        stance = _contra.classify_stance(polarity, extraction, pop)
        rel = _relevance(art, exp["terms"] or [pico.raw])
        raw_lines.append(EvidenceLine(
            n=0, article=art, extraction=extraction, grade=g,
            stance=stance["stance"], stance_reason=stance["reason"],
            disagreement_type=stance["disagreement_type"],
            population_match=pop, relevance=rel))

    # 7. rank: evidence weight, recency, relevance, informativeness
    def _score(l: EvidenceLine) -> float:
        ev = (7 - l.grade.level)
        rec = max(0.0, 1 - (current_year - (l.article.year or current_year)) / 20)
        info = 1.0 if l.stance in ("supporting", "contradicting") else 0.4
        return ev * 2 + rec * 2 + l.relevance * 3 + info
    raw_lines.sort(key=_score, reverse=True)
    lines = raw_lines[:k]
    for i, l in enumerate(lines, 1):
        l.n = i
    trail.append({"step": "grade_and_classify", "detail": "graded designs, assigned stances",
                  "graded": len(raw_lines), "shown": len(lines)})

    # 8. transparent assessment over the shown set
    records = [{
        "level": l.grade.level, "label": l.grade.label, "strength": l.grade.strength,
        "stance": l.stance, "year": l.article.year,
        "significant": next((e.get("significant") for e in l.extraction.get("effects", [])
                             if e.get("significant") is not None), None),
        "population_match": l.population_match.get("match", "unknown"),
        "sample_size": (l.extraction.get("sample_size") or {}).get("value"),
        "industry_funded": (l.extraction.get("funding") or {}).get("industry"),
        "direction": (l.extraction.get("direction") or {}).get("value"),
    } for l in lines]
    assessment = _assess.assess(records, current_year=current_year, claim_population=claim_pop)
    trail.append({"step": "assess_strength", "detail": assessment["summary"],
                  "strength": assessment["strength"], "status": assessment["status"]})

    # 9. answer
    grounded = not router.has("synthesize")
    answer = (_grounded_answer(question, lines, assessment)
              if grounded else _model_answer(question, lines, assessment, router))

    return Verdict(
        question=question, pico=pico.as_dict(), query=query,
        status=assessment["status"], evidence_strength=assessment["strength"],
        assessment=assessment, lines=lines, answer=answer, grounded=grounded,
        retrieval=result.prisma, audit_trail=trail, fingerprint=_fingerprint(lines))


def _grounded_answer(question: str, lines: List[EvidenceLine], assessment: Dict[str, Any]) -> str:
    if not lines:
        return ("No studies were retrieved for this claim. Treat this as absence of "
                "retrieved evidence — not as evidence of absence — and try broadening the terms.")
    sup = [l for l in lines if l.stance == "supporting"]
    con = [l for l in lines if l.stance == "contradicting"]
    out = [assessment["summary"], ""]
    if assessment["reasons"]:
        out.append("Why the evidence is rated this way:")
        out += [f"  + {r}" for r in assessment["reasons"]]
    if assessment["limitations"]:
        out.append("Limitations:")
        out += [f"  - {r}" for r in assessment["limitations"]]
    out.append("")
    out.append(f"Supporting evidence ({len(sup)}):" if sup else "No study clearly supports the claim.")
    for l in sup[:5]:
        out.append(f"  [{l.n}] {l.grade.label} · {l.grade.strength} · {l.article.year or 'n.d.'} — "
                   f"{l.article.title}")
    if con:
        out.append(f"Contradicting evidence ({len(con)}):")
        for l in con[:5]:
            lbl = _contra.DISAGREEMENT_LABELS.get(l.disagreement_type or "", "disagrees")
            out.append(f"  [{l.n}] {l.grade.label} · {l.article.year or 'n.d.'} — {l.article.title} "
                       f"({lbl})")
    out.append("")
    out.append("Assessment is abstract-level. This is decision support, not medical advice.")
    return "\n".join(out)


def _model_answer(question: str, lines: List[EvidenceLine], assessment: Dict[str, Any],
                  router: ModelRouter) -> str:
    src = []
    for l in lines:
        src.append(f"[{l.n}] ({l.grade.label}, {l.grade.strength}, {l.article.year or 'n.d.'}, "
                   f"stance={l.stance}) {l.article.title}\n{l.article.abstract[:1200]}")
    prompt = (
        "You are a careful medical-evidence assistant. Using ONLY the numbered sources, "
        "state whether the claim is supported, cite every claim inline like [2], name the "
        "studies that contradict it and why, and never add facts of your own.\n\n"
        f"COMPUTED ASSESSMENT: {assessment['summary']}\n"
        f"SUPPORTING REASONS: {assessment['reasons']}\nLIMITATIONS: {assessment['limitations']}\n\n"
        f"CLAIM/QUESTION: {question}\n\nSOURCES:\n" + "\n\n".join(src) + "\n\nANSWER:")
    text = router.generate("synthesize", prompt)
    if not text:
        return _grounded_answer(question, lines, assessment)
    return text + f"\n\n— Evidence strength (computed): {assessment['summary']}"
