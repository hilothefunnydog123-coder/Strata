"""PubMed access via the public NCBI E-utilities API.

Standard library only. ``esearch`` turns a query into PMIDs, ``efetch`` turns
PMIDs into full records. This is open bibliographic data: no patient data, no
account needed. Setting ``NCBI_API_KEY`` raises the rate limit from 3 to 10
requests a second and is the only configuration that matters.

The record parsed here is deliberately richer than a title and an abstract,
because several of the things Strata most needs to tell a clinician live in the
metadata rather than the prose:

*Retractions.* A retracted paper still has a perfectly readable abstract. PubMed
records the retraction as a publication type and as a linked correction, and
Strata reads both — citing a withdrawn trial without saying so is the single
worst thing an evidence tool can do.

*Conflicts and funding.* Journals have deposited structured conflict-of-interest
statements since 2017. Industry funding does not invalidate a trial, but it is
part of appraising one, so it is surfaced rather than hidden.

*MeSH terms.* Human-assigned subject headings, far cleaner than anything
inferable from the title, used to sharpen relevance ranking.
"""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from . import cache, net

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

#: How many PMIDs to request per efetch. NCBI's guidance is to POST above ~200;
#: Strata stays well under that so a single GET is always correct.
FETCH_CHUNK = 100

_RETRACTION_TYPES = {"retracted publication", "retraction of publication"}
_CORRECTION_REFTYPES = {"RetractionIn", "ErratumIn", "ExpressionOfConcernIn",
                        "RepublishedIn", "CorrectedandRepublishedIn"}


@dataclass
class Correction:
    """A linked retraction, erratum or expression of concern."""
    kind: str                      # RetractionIn | ErratumIn | ...
    pmid: str = ""
    note: str = ""

    @property
    def is_retraction(self) -> bool:
        return self.kind in ("RetractionIn",)

    @property
    def is_concern(self) -> bool:
        return self.kind == "ExpressionOfConcernIn"

    @property
    def label(self) -> str:
        return {"RetractionIn": "Retracted",
                "ErratumIn": "Erratum issued",
                "ExpressionOfConcernIn": "Expression of concern",
                "RepublishedIn": "Republished",
                "CorrectedandRepublishedIn": "Corrected and republished",
                }.get(self.kind, self.kind)


@dataclass
class Article:
    pmid: str
    title: str
    abstract: str
    journal: str
    year: int | None
    authors: list[str]
    publication_types: list[str] = field(default_factory=list)
    mesh_terms: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    doi: str = ""
    language: str = ""
    coi_statement: str = ""
    funding: list[str] = field(default_factory=list)
    corrections: list[Correction] = field(default_factory=list)
    volume: str = ""
    issue: str = ""
    pages: str = ""

    # ------------------------------------------------------------- properties
    @property
    def url(self) -> str:
        return f"https://pubmed.ncbi.nlm.nih.gov/{self.pmid}/"

    @property
    def doi_url(self) -> str:
        return f"https://doi.org/{self.doi}" if self.doi else ""

    @property
    def citation(self) -> str:
        first = self.authors[0] if self.authors else "Anon"
        etal = " et al." if len(self.authors) > 1 else ""
        yr = self.year or "n.d."
        bits = f"{first}{etal} ({yr}). {self.title} {self.journal}"
        if self.volume:
            bits += f";{self.volume}"
            if self.issue:
                bits += f"({self.issue})"
        if self.pages:
            bits += f":{self.pages}"
        return bits + f". PMID {self.pmid}"

    @property
    def is_retracted(self) -> bool:
        """True when PubMed marks this paper as retracted, by either route."""
        if any(p.lower() in _RETRACTION_TYPES for p in self.publication_types):
            return True
        return any(c.is_retraction for c in self.corrections)

    @property
    def has_expression_of_concern(self) -> bool:
        return any(c.is_concern for c in self.corrections)

    @property
    def has_erratum(self) -> bool:
        return any(c.kind == "ErratumIn" for c in self.corrections)

    @property
    def is_guideline(self) -> bool:
        return any("guideline" in p.lower() for p in self.publication_types)

    @property
    def industry_funded(self) -> bool | None:
        """Whether the conflict statement names a commercial relationship.

        ``None`` when the paper declares nothing at all — which is not the same
        as declaring no conflict, and is shown differently.
        """
        if not self.coi_statement:
            return None
        s = self.coi_statement.lower()
        if re.search(r"\b(no (?:competing|conflicts?|potential conflicts?)|"
                     r"nothing to disclose|declare none|no disclosures)\b", s):
            return False
        return bool(re.search(
            r"\b(grants?|personal fees|honorari|consult|advisory board|speaker|"
            r"employee of|stock|equity|patent|funded by|supported by)\b", s))

    def text(self) -> str:
        """Title plus abstract — what the networks and the ranker read."""
        return f"{self.title} {self.abstract}".strip()

    def as_dict(self) -> dict:
        return {"pmid": self.pmid, "title": self.title, "journal": self.journal,
                "year": self.year, "url": self.url, "doi": self.doi,
                "authors": self.authors[:6],
                "publication_types": self.publication_types,
                "mesh_terms": self.mesh_terms[:12],
                "retracted": self.is_retracted,
                "expression_of_concern": self.has_expression_of_concern,
                "erratum": self.has_erratum}


# ------------------------------------------------------------------- fetching

def _get(endpoint: str, params: dict, *, ttl: int = cache.DEFAULT_TTL) -> bytes:
    url = net.build_url(EUTILS, endpoint, params)
    hit = cache.get(url, ttl=ttl)
    if hit is not None:
        return hit
    body = net.get(url)
    cache.put(url, body)
    return body


@dataclass
class SearchResult:
    pmids: list[str]
    total: int
    query_translation: str = ""


def esearch(query: str, retmax: int = 25, *, sort: str = "relevance",
            mindate: int | None = None) -> SearchResult:
    """PMIDs for a query, most relevant first, plus PubMed's own total.

    The total matters: twelve hits out of twelve is a different situation from
    twelve out of four thousand, and Strata says which.
    """
    params = {"db": "pubmed", "term": query, "retmax": max(1, min(retmax, 200)),
              "retmode": "json", "sort": sort}
    if mindate:
        params.update({"mindate": mindate, "maxdate": 3000, "datetype": "pdat"})
    raw = _get("esearch.fcgi", params)
    try:
        payload = json.loads(raw)["esearchresult"]
    except (ValueError, KeyError) as exc:
        raise net.NetworkError("PubMed returned an unreadable search response") from exc
    if "ERROR" in payload:
        raise net.NetworkError(f"PubMed rejected the query: {payload['ERROR']}")
    return SearchResult(pmids=payload.get("idlist", []),
                        total=int(payload.get("count", 0) or 0),
                        query_translation=payload.get("querytranslation", ""))


def efetch(pmids: list[str]) -> list[Article]:
    """Full records for a list of PMIDs, in the order given."""
    if not pmids:
        return []
    out: list[Article] = []
    for i in range(0, len(pmids), FETCH_CHUNK):
        chunk = pmids[i:i + FETCH_CHUNK]
        raw = _get("efetch.fcgi", {"db": "pubmed", "id": ",".join(chunk),
                                   "retmode": "xml"})
        out.extend(parse_articles(raw))
    order = {p: i for i, p in enumerate(pmids)}
    out.sort(key=lambda a: order.get(a.pmid, 1 << 30))
    return out


def search_articles(query: str, retmax: int = 25, *,
                    sort: str = "relevance") -> list[Article]:
    """Search and fetch in one call — the common path."""
    return efetch(esearch(query, retmax=retmax, sort=sort).pmids)


def search_with_total(query: str, retmax: int = 25) -> tuple[list[Article], int, str]:
    """Like :func:`search_articles` but also returns PubMed's hit count and
    its interpretation of the query, both of which Strata shows the user."""
    result = esearch(query, retmax=retmax)
    return efetch(result.pmids), result.total, result.query_translation


# -------------------------------------------------------------------- parsing

def _text(node, path: str, default: str = "") -> str:
    el = node.find(path)
    return " ".join("".join(el.itertext()).split()) if el is not None else default


def _abstract(article) -> str:
    """Join a structured abstract, keeping its section labels.

    The labels are worth preserving: METHODS and CONCLUSIONS read very
    differently, and both the design network and the stance network use that.
    """
    parts = []
    for s in article.findall(".//Abstract/AbstractText"):
        body = " ".join("".join(s.itertext()).split())
        if not body:
            continue
        label = (s.get("Label") or "").strip()
        parts.append(f"{label.upper()}: {body}" if label else body)
    return " ".join(parts).strip()


def _year(article) -> int | None:
    for path in (".//JournalIssue/PubDate/Year", ".//ArticleDate/Year"):
        v = _text(article, path)
        if v[:4].isdigit():
            return int(v[:4])
    medline = _text(article, ".//JournalIssue/PubDate/MedlineDate")
    m = re.search(r"\d{4}", medline)
    return int(m.group(0)) if m else None


def parse_articles(xml_bytes: bytes) -> list[Article]:
    """Parse an efetch ``PubmedArticleSet`` into :class:`Article` records.

    Tolerant by design: a record missing a field is returned without it rather
    than dropped, because a paper with no abstract still counts toward what the
    literature does and does not contain.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []

    out: list[Article] = []
    for entry in root.findall(".//PubmedArticle"):
        medline = entry.find(".//MedlineCitation")
        if medline is None:
            continue
        article = medline.find("Article")
        if article is None:
            continue

        pmid = _text(medline, "PMID")
        authors = []
        for a in article.findall(".//AuthorList/Author"):
            last, initials = _text(a, "LastName"), _text(a, "Initials")
            if last:
                authors.append(f"{last} {initials}".strip())
            elif _text(a, "CollectiveName"):
                authors.append(_text(a, "CollectiveName"))

        doi = ""
        for eid in entry.findall(".//ArticleIdList/ArticleId"):
            if eid.get("IdType") == "doi" and eid.text:
                doi = eid.text.strip()
                break
        if not doi:
            for eid in article.findall(".//ELocationID"):
                if eid.get("EIdType") == "doi" and eid.text:
                    doi = eid.text.strip()
                    break

        corrections = []
        for cc in medline.findall(".//CommentsCorrectionsList/CommentsCorrections"):
            ref = cc.get("RefType", "")
            if ref in _CORRECTION_REFTYPES:
                corrections.append(Correction(
                    kind=ref, pmid=_text(cc, "PMID"), note=_text(cc, "RefSource")))

        mesh = [_text(m, "DescriptorName")
                for m in medline.findall(".//MeshHeadingList/MeshHeading")]
        funding = []
        for g in article.findall(".//GrantList/Grant"):
            agency = _text(g, "Agency")
            if agency and agency not in funding:
                funding.append(agency)

        out.append(Article(
            pmid=pmid,
            title=_text(article, "ArticleTitle"),
            abstract=_abstract(article),
            journal=(_text(article, ".//Journal/ISOAbbreviation")
                     or _text(article, ".//Journal/Title")),
            year=_year(article),
            authors=authors,
            publication_types=[p.text.strip() for p in article.findall(
                ".//PublicationTypeList/PublicationType") if p.text],
            mesh_terms=[m for m in mesh if m],
            keywords=[" ".join("".join(k.itertext()).split())
                      for k in medline.findall(".//KeywordList/Keyword")
                      if "".join(k.itertext()).strip()],
            doi=doi,
            language=_text(article, ".//Language"),
            coi_statement=_text(medline, "CoiStatement"),
            funding=funding,
            corrections=corrections,
            volume=_text(article, ".//JournalIssue/Volume"),
            issue=_text(article, ".//JournalIssue/Issue"),
            pages=_text(article, ".//Pagination/MedlinePgn"),
        ))
    return out
