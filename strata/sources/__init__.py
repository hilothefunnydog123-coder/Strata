"""Modular multi-source retrieval.

Each source is a ``search(query, retmax) -> list[Article]`` callable. The
registry runs the selected sources **in parallel**, tolerates any single source
failing (graceful degradation — one dead API never blanks the answer), then
de-duplicates across sources by DOI → PMID → normalized title, merging the
richest fields. The counts it returns feed a real PRISMA flow diagram, so the
retrieval is auditable rather than a black box.

Adding a source is one file plus one line in ``REGISTRY`` — the architecture is
built to grow (ClinicalTrials.gov, Crossref, guideline libraries, internal
corpora) without touching the pipeline.
"""
from __future__ import annotations

import concurrent.futures as _f
import os
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from ..pubmed import Article, search_articles as _pubmed_search
from . import europepmc, openalex

SearchFn = Callable[[str, int], List[Article]]

# name -> search function. New sources register here.
REGISTRY: Dict[str, SearchFn] = {
    "pubmed": _pubmed_search,
    "europepmc": europepmc.search,
    "openalex": openalex.search,
}

DEFAULT_SOURCES = ["pubmed", "europepmc", "openalex"]


@dataclass
class RetrievalResult:
    articles: List[Article]
    per_source: Dict[str, int] = field(default_factory=dict)
    errors: Dict[str, str] = field(default_factory=dict)
    retrieved_total: int = 0          # sum across sources, before dedup
    unique: int = 0                   # after dedup
    sources_used: List[str] = field(default_factory=list)

    @property
    def prisma(self) -> dict:
        """Counts for a PRISMA-style retrieval flow diagram (all real)."""
        return {
            "identified": self.retrieved_total,
            "duplicates_removed": max(0, self.retrieved_total - self.unique),
            "screened": self.unique,
            "per_source": dict(self.per_source),
            "sources": list(self.sources_used),
            "errors": dict(self.errors),
        }


def _merge(a: Article, b: Article) -> Article:
    """Combine two records of the same study, keeping the richest fields."""
    prefer_ab = len(a.abstract or "") >= len(b.abstract or "")
    primary, other = (a, b) if prefer_ab else (b, a)
    ptypes: List[str] = []
    seen = set()
    for p in list(a.publication_types) + list(b.publication_types):
        k = p.lower()
        if k not in seen:
            seen.add(k); ptypes.append(p)
    srcs = []
    for s in (a.source, b.source):
        for part in s.split("+"):
            if part and part not in srcs:
                srcs.append(part)
    return Article(
        pmid=a.pmid or b.pmid,
        title=primary.title or other.title,
        abstract=primary.abstract or other.abstract,
        journal=a.journal or b.journal,
        year=a.year or b.year,
        authors=a.authors if len(a.authors) >= len(b.authors) else b.authors,
        publication_types=ptypes,
        doi=a.doi or b.doi,
        source="+".join(srcs),
        has_full_text=a.has_full_text or b.has_full_text,
    )


def dedupe(articles: List[Article]) -> List[Article]:
    by_key: Dict[str, Article] = {}
    order: List[str] = []
    for art in articles:
        key = art.dedup_key
        if key in by_key:
            by_key[key] = _merge(by_key[key], art)
        else:
            by_key[key] = art
            order.append(key)
    return [by_key[k] for k in order]


def retrieve(query: str, retmax: int = 25, *, sources: Optional[List[str]] = None,
             max_workers: int = 4) -> RetrievalResult:
    """Search the selected sources in parallel and return a de-duplicated set."""
    names = sources or (os.environ.get("STRATA_SOURCES", "").split(",")
                        if os.environ.get("STRATA_SOURCES") else DEFAULT_SOURCES)
    names = [n.strip() for n in names if n.strip() in REGISTRY]
    if not names:
        names = ["pubmed"]

    collected: List[Article] = []
    per_source: Dict[str, int] = {}
    errors: Dict[str, str] = {}

    with _f.ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(REGISTRY[n], query, retmax): n for n in names}
        for fut in _f.as_completed(futures):
            name = futures[fut]
            try:
                arts = fut.result()
                per_source[name] = len(arts)
                collected.extend(arts)
            except Exception as exc:  # one source failing must not blank the answer
                errors[name] = f"{type(exc).__name__}: {exc}"

    unique = dedupe(collected)
    return RetrievalResult(
        articles=unique,
        per_source=per_source,
        errors=errors,
        retrieved_total=len(collected),
        unique=len(unique),
        sources_used=names,
    )
