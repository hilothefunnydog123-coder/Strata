"""Multi-source evidence retrieval. Standard library only, all sources free + keyless.

One query fans out across the open research world and merges the results:

* **PubMed** (NCBI E-utilities)        biomedical abstracts
* **Europe PMC**                        abstracts + preprints + open-access full text + citation counts
* **ClinicalTrials.gov** (API v2)       registered trials
* **OpenAlex**                          250M+ works, citation counts, open access
* **Crossref**                          scholarly metadata across publishers

Records are normalised to :class:`~strata.pubmed.Article`, de-duplicated by DOI / PMID /
title, and enriched with citation counts and source provenance. Each fetcher fails soft:
one source being down never breaks the search. Parsing is split from fetching so it is unit
tested offline against sample payloads.
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request

from .pubmed import Article, UA, _ssl_context, search_articles

CONTACT = os.environ.get("STRATA_CONTACT_EMAIL", "strata-evidence@users.noreply.github.com")


def _get_json(url: str, timeout: int = 20) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as r:
        return json.loads(r.read())


# --------------------------------------------------------------------- Europe PMC
def parse_europepmc(data: dict) -> list[Article]:
    out = []
    for r in data.get("resultList", {}).get("result", []):
        pts = []
        ptl = (r.get("pubTypeList") or {}).get("pubType")
        if isinstance(ptl, list):
            pts += ptl
        elif ptl:
            pts.append(ptl)
        if r.get("pubType"):
            pts.append(r["pubType"])
        yr = str(r.get("pubYear") or "")
        authors = [a.strip() for a in (r.get("authorString") or "").split(",") if a.strip()][:8]
        eid, esrc = r.get("id"), r.get("source")
        out.append(Article(
            pmid=(r.get("pmid") or ""), title=(r.get("title") or "").rstrip("."),
            abstract=(r.get("abstractText") or ""),
            journal=(r.get("journalTitle") or r.get("source") or ""),
            year=int(yr) if yr.isdigit() else None, authors=authors,
            publication_types=[p for p in dict.fromkeys(pts) if p], source="europepmc",
            doi=(r.get("doi") or None), cited_by=r.get("citedByCount"),
            full_text_url=(f"https://europepmc.org/article/{esrc}/{eid}" if eid and esrc else None)))
    return out


def _europepmc_fetch(query: str, n: int) -> list[Article]:
    url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + urllib.parse.urlencode({
        "query": query, "format": "json", "pageSize": min(n, 100),
        "resultType": "core", "sort": "CITED desc"})
    return parse_europepmc(_get_json(url))


# ----------------------------------------------------------------- ClinicalTrials.gov
def parse_ctgov(data: dict) -> list[Article]:
    out = []
    for s in data.get("studies", []):
        ps = s.get("protocolSection", {})
        idm, desc = ps.get("identificationModule", {}), ps.get("descriptionModule", {})
        design, status = ps.get("designModule", {}), ps.get("statusModule", {})
        nct = idm.get("nctId", "")
        title = idm.get("briefTitle") or idm.get("officialTitle") or ""
        yr = str((status.get("startDateStruct", {}) or {}).get("date", ""))[:4]
        pts = ["Clinical Trial (registry)"]
        phases = design.get("phases") or []
        if phases:
            pts.append(" ".join(phases))
        if (design.get("designInfo", {}) or {}).get("allocation", "").upper().startswith("RANDOM"):
            pts.append("Randomized Controlled Trial")
        out.append(Article(
            pmid="", title=title, abstract=(desc.get("briefSummary") or ""),
            journal="ClinicalTrials.gov", year=int(yr) if yr.isdigit() else None,
            authors=[], publication_types=pts, source="clinicaltrials", doi=None,
            full_text_url=f"https://clinicaltrials.gov/study/{nct}"))
    return out


def _ctgov_fetch(query: str, n: int) -> list[Article]:
    url = "https://clinicaltrials.gov/api/v2/studies?" + urllib.parse.urlencode({
        "query.term": query, "pageSize": min(n, 50), "format": "json"})
    return parse_ctgov(_get_json(url))


# --------------------------------------------------------------------- OpenAlex
def _openalex_abstract(inv) -> str:
    if not inv:
        return ""
    pos = {}
    for word, places in inv.items():
        for p in places:
            pos[p] = word
    return " ".join(pos[i] for i in sorted(pos))


def parse_openalex(data: dict) -> list[Article]:
    out = []
    for w in data.get("results", []):
        ids = w.get("ids") or {}
        pmid = (ids.get("pmid") or "").rstrip("/").split("/")[-1] if ids.get("pmid") else ""
        loc = w.get("primary_location") or {}
        journal = ((loc.get("source") or {}) or {}).get("display_name") or ""
        authors = [(a.get("author") or {}).get("display_name", "")
                   for a in (w.get("authorships") or [])][:8]
        yr = w.get("publication_year")
        out.append(Article(
            pmid=pmid, title=(w.get("title") or w.get("display_name") or ""),
            abstract=_openalex_abstract(w.get("abstract_inverted_index")), journal=journal,
            year=yr if isinstance(yr, int) else None, authors=[a for a in authors if a],
            publication_types=[w.get("type")] if w.get("type") else [], source="openalex",
            doi=((w.get("doi") or "").replace("https://doi.org/", "") or None),
            cited_by=w.get("cited_by_count"),
            full_text_url=(w.get("open_access") or {}).get("oa_url")))
    return out


def _openalex_fetch(query: str, n: int) -> list[Article]:
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode({
        "search": query, "per_page": min(n, 50), "mailto": CONTACT,
        "sort": "cited_by_count:desc"})
    return parse_openalex(_get_json(url))


# --------------------------------------------------------------------- Crossref
def _strip_jats(s: str) -> str:
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()
    return re.sub(r"\s+([.,;:)])", r"\1", text)          # no space before punctuation


def parse_crossref(data: dict) -> list[Article]:
    out = []
    for it in data.get("message", {}).get("items", []):
        issued = (it.get("issued", {}) or {}).get("date-parts", [[None]])
        yr = issued[0][0] if issued and issued[0] else None
        authors = [" ".join(filter(None, [a.get("given"), a.get("family")]))
                   for a in (it.get("author") or [])][:8]
        out.append(Article(
            pmid="", title=(it.get("title") or [""])[0],
            abstract=_strip_jats(it.get("abstract", "")),
            journal=(it.get("container-title") or [""])[0],
            year=yr if isinstance(yr, int) else None, authors=[a for a in authors if a],
            publication_types=[it.get("type")] if it.get("type") else [], source="crossref",
            doi=it.get("DOI"), cited_by=it.get("is-referenced-by-count")))
    return out


def _crossref_fetch(query: str, n: int) -> list[Article]:
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode({
        "query": query, "rows": min(n, 40), "mailto": CONTACT,
        "select": "title,abstract,issued,author,type,DOI,is-referenced-by-count,container-title"})
    return parse_crossref(_get_json(url))


# --------------------------------------------------------------------- merge
def _merge(a: Article, b: Article) -> Article:
    keep = a if len(a.abstract or "") >= len(b.abstract or "") else b
    other = b if keep is a else a
    keep.pmid = keep.pmid or other.pmid
    keep.doi = keep.doi or other.doi
    keep.full_text_url = keep.full_text_url or other.full_text_url
    cbs = [x for x in (a.cited_by, b.cited_by) if x is not None]
    keep.cited_by = max(cbs) if cbs else None
    keep.publication_types = list(dict.fromkeys((keep.publication_types or []) + (other.publication_types or [])))
    return keep


def dedupe(articles: list[Article]) -> list[Article]:
    best: dict[str, Article] = {}
    for a in articles:
        k = a.dedupe_key
        best[k] = _merge(best[k], a) if k in best else a
    return list(best.values())


def source_breakdown(articles: list[Article]) -> dict:
    counts: dict[str, int] = {}
    for a in articles:
        counts[a.source] = counts.get(a.source, 0) + 1
    return counts


_SOURCES = {
    "pubmed": lambda q, n: search_articles(q, retmax=n),
    "europepmc": _europepmc_fetch,
    "clinicaltrials": _ctgov_fetch,
    "openalex": _openalex_fetch,
    "crossref": _crossref_fetch,
}


def enabled_sources() -> list[str]:
    env = os.environ.get("STRATA_SOURCES")
    if env:
        return [s.strip() for s in env.split(",") if s.strip() in _SOURCES]
    return ["pubmed", "europepmc", "clinicaltrials", "openalex"]


def search_all(query: str, retmax: int = 40, *, sources=None, per_source=None,
               _fetchers=None) -> list[Article]:
    """Query every enabled source, merge, and rank. Fails soft per source."""
    srcs = sources or enabled_sources()
    per = per_source or max(10, (retmax // max(len(srcs), 1)) + 4)
    fetchers = _fetchers if _fetchers is not None else [_SOURCES[s] for s in srcs]
    gathered: list[Article] = []
    for f in fetchers:
        try:
            gathered += f(query, per) or []
        except Exception:
            continue
    merged = dedupe(gathered)
    merged.sort(key=lambda a: (-(1 if a.abstract else 0), -(a.cited_by or 0), -(a.year or 0)))
    return merged[:retmax]
