"""OpenAlex — a real, free scholarly index (no key required).

OpenAlex is an open catalogue of ~250M works with rich metadata and a generous
free API. It broadens coverage beyond MEDLINE and adds citation counts (a signal
we can use for weighting). Abstracts are stored as an inverted index, which we
reconstruct. Setting ``STRATA_CONTACT_EMAIL`` joins OpenAlex's faster "polite
pool"; it is optional.

    https://docs.openalex.org/
"""
from __future__ import annotations

import os
from typing import List, Optional

from ..pubmed import Article
from . import _http

BASE = "https://api.openalex.org/works"


def _abstract(inv: Optional[dict]) -> str:
    """Reconstruct plain text from OpenAlex's abstract_inverted_index."""
    if not inv:
        return ""
    positioned = []
    for word, spots in inv.items():
        for s in spots:
            positioned.append((s, word))
    positioned.sort()
    return " ".join(w for _, w in positioned)


def _pmid(ids: dict) -> str:
    p = (ids or {}).get("pmid") or ""
    return p.rstrip("/").rsplit("/", 1)[-1] if p else ""


def _pub_types(rec: dict) -> List[str]:
    # OpenAlex 'type' is coarse (article, review, ...); map review-ish types so the
    # grader can still see them. Fine-grained design still comes from the title.
    t = (rec.get("type") or "").lower()
    tc = (rec.get("type_crossref") or "").lower()
    types = []
    if "review" in t or "review" in tc:
        types.append("Review")
    if t:
        types.append(t)
    return types


def search(query: str, retmax: int = 25) -> List[Article]:
    params = {
        "search": query, "per_page": min(retmax, 50),
        "filter": "type:article|review",
    }
    email = os.environ.get("STRATA_CONTACT_EMAIL")
    if email:
        params["mailto"] = email
    data = _http.get_json(BASE, params)
    out: List[Article] = []
    for rec in data.get("results", []):
        doi = (rec.get("doi") or "").replace("https://doi.org/", "").strip()
        authors = [(a.get("author") or {}).get("display_name")
                   for a in rec.get("authorships", [])]
        authors = [a for a in authors if a]
        loc = rec.get("primary_location") or {}
        journal = ((loc.get("source") or {}) or {}).get("display_name") or ""
        oa = (rec.get("open_access") or {}).get("is_oa", False)
        out.append(Article(
            pmid=_pmid(rec.get("ids") or {}),
            title=rec.get("title") or rec.get("display_name") or "",
            abstract=_abstract(rec.get("abstract_inverted_index")),
            journal=journal,
            year=rec.get("publication_year"),
            authors=authors,
            publication_types=_pub_types(rec),
            doi=doi,
            source="openalex",
            has_full_text=bool(oa),
        ))
    return out
