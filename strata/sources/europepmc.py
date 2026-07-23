"""Europe PMC — a real, free biomedical source (no key required).

Europe PMC mirrors PubMed/MEDLINE and adds preprints, agricola, patents and a
large open-access full-text corpus. The ``core`` result type returns the
abstract, author list, publication types and open-access flags in one call.

    https://europepmc.org/RestfulWebService
"""
from __future__ import annotations

from typing import List

from ..pubmed import Article
from . import _http

BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"


def _authors(rec: dict) -> List[str]:
    al = (rec.get("authorList") or {}).get("author") or []
    names = [a.get("fullName") or f"{a.get('lastName','')} {a.get('initials','')}".strip()
             for a in al]
    names = [n for n in names if n]
    if names:
        return names
    s = rec.get("authorString") or ""
    return [p.strip() for p in s.split(",") if p.strip()]


def _year(rec: dict):
    for key in ("pubYear",):
        v = rec.get(key)
        if v and str(v)[:4].isdigit():
            return int(str(v)[:4])
    ji = rec.get("journalInfo") or {}
    y = ji.get("yearOfPublication")
    return int(y) if y else None


def search(query: str, retmax: int = 25) -> List[Article]:
    data = _http.get_json(BASE, {
        "query": query, "format": "json", "pageSize": min(retmax, 100),
        "resultType": "core", "sort": "relevance",
    })
    out: List[Article] = []
    for rec in (data.get("resultList") or {}).get("result", []):
        pub_types = (rec.get("pubTypeList") or {}).get("pubType") or []
        ji = rec.get("journalInfo") or {}
        journal = ((ji.get("journal") or {}).get("title")
                   or rec.get("bookOrReportDetails", {}).get("publisher") or "")
        has_ft = (rec.get("isOpenAccess") == "Y"
                  or bool((rec.get("fullTextUrlList") or {}).get("fullTextUrl")))
        out.append(Article(
            pmid=str(rec.get("pmid") or ""),
            title=rec.get("title") or "",
            abstract=rec.get("abstractText") or "",
            journal=journal,
            year=_year(rec),
            authors=_authors(rec),
            publication_types=[p for p in pub_types if p],
            doi=(rec.get("doi") or "").strip(),
            source="europepmc",
            has_full_text=has_ft,
        ))
    return out
