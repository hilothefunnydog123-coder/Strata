"""Europe PMC — the literature PubMed does not index, and the papers that are not papers yet.

PubMed is the best-curated biomedical index in existence and it is not complete.
Europe PMC adds three things that matter to an evidence synthesis:

**Preprints.** medRxiv and bioRxiv are where a large share of clinical research
appears first, sometimes by a year, sometimes forever. A preprint is real
evidence and it has not been peer reviewed, and those two facts have to be held
at once. Strata retrieves them, marks every one, and — in
:mod:`strata.evidence` — takes a certainty step off for the missing review. What
it will not do is pretend they do not exist, because "we searched only
peer-reviewed sources" is a defensible protocol decision and a silent omission is
not.

**Full text.** Europe PMC knows which articles have open-access full text and
where. An abstract states the effect estimate; the full text states the
pre-specified outcome, the protocol deviation and the funding. Strata records the
link so a reviewer can go and read it.

**Citation counts.** Not a quality measure — a retracted paper can be cited for
years, and often is — but a useful signal of whether a finding stood alone or was
taken up.

The one thing to keep in mind: Europe PMC's index overlaps PubMed almost
entirely for journal articles. Retrieving both and treating the union as "more
evidence" would double-count every trial. :mod:`strata.sources.registry` merges
them on PMID, DOI and title before anything downstream sees them.

Public REST API, no key, no account.
"""
from __future__ import annotations

import json
import re

from .. import cache, net
from ..pico import PICO, content_words, expand
from ..pubmed import Article, Correction

API = "https://www.ebi.ac.uk/europepmc/webservices/rest"
SERVICE = "Europe PMC"

#: Europe PMC source codes. ``PPR`` is the one Strata exists to notice.
PREPRINT_SOURCES = {"PPR"}

_NCT_RE = re.compile(r"NCT\d{8}", re.I)

#: Its own correction vocabulary, mapped onto the PubMed one so the rest of
#: Strata — which already knows how to demote a retracted paper — needs no
#: special case for where the record came from.
_COMMENT_KINDS = {
    "retraction": "RetractionIn",
    "retraction in": "RetractionIn",
    "erratum": "ErratumIn",
    "erratum in": "ErratumIn",
    "expression of concern": "ExpressionOfConcernIn",
    "expression of concern in": "ExpressionOfConcernIn",
}


def build_query(pico: PICO, *, design: str | None = None,
                years: int | None = None, include_preprints: bool = True,
                peer_reviewed_only: bool = False) -> str:
    """A Europe PMC query from the same parsed question PubMed gets.

    Deliberately not a translation of the PubMed string. The two engines have
    different field vocabularies — ``[tiab]`` against ``TITLE_ABS``, ``[pt]``
    against ``PUB_TYPE`` — and mechanically rewriting one into the other produces
    a query that parses and retrieves the wrong thing. Building both from the
    parsed PICO keeps them answering the same question in each engine's own terms,
    and :mod:`strata.review.prisma` records both strings verbatim, because a
    systematic review has to state the exact search run against each database.
    """
    clauses = []
    for part in (pico.intervention, pico.comparator, pico.outcome):
        clause = _clause(part)
        if clause:
            clauses.append(clause)
    if pico.population and len(pico.population.split()) <= 6:
        clause = _clause(pico.population)
        if clause:
            clauses.append(clause)

    if not clauses:
        terms = pico.keywords[:6] or content_words(pico.question)[:6]
        if not terms:
            return "MED"
        query = "(" + " OR ".join(f'TITLE_ABS:"{t}"' for t in terms) + ")"
    else:
        query = " AND ".join(clauses[:2]) if len(clauses) > 1 else clauses[0]
        if len(clauses) > 2:
            query += " AND (" + " OR ".join(clauses[2:]) + ")"

    if design == "systematic_review":
        query += ' AND (PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Systematic Review")'
    elif design in ("rct", "trials"):
        query += ' AND PUB_TYPE:"Randomized Controlled Trial"'
    elif design == "guideline":
        query += ' AND PUB_TYPE:"Guideline"'

    if years:
        query += f" AND (FIRST_PDATE:[{_years_ago(years)} TO 3000-12-31])"
    if peer_reviewed_only or not include_preprints:
        query += " AND NOT SRC:PPR"
    return query + " AND HAS_ABSTRACT:Y"


def _years_ago(years: int) -> str:
    import datetime as _dt
    today = _dt.date.today()
    try:
        return today.replace(year=today.year - years).isoformat()
    except ValueError:                       # 29 February
        return today.replace(year=today.year - years, day=28).isoformat()


def _clause(term: str) -> str:
    """One OR-group across a term and its curated synonyms.

    Same reasoning as the PubMed builder: a phrase over three words is matched
    word by word rather than as a literal string, because
    ``TITLE_ABS:"cardiovascular mortality in type 2 diabetes"`` is a phrase search
    that appears in essentially no abstract and silently empties the result set.
    """
    parts = []
    for value in expand(term):
        words = value.split()
        if len(words) <= 3:
            parts.append(f'TITLE_ABS:"{value}"')
        else:
            content = content_words(value)[:4]
            if content:
                parts.append("(" + " AND ".join(
                    f'TITLE_ABS:"{w}"' for w in content) + ")")
    return "(" + " OR ".join(parts) + ")" if parts else ""


# -------------------------------------------------------------------- fetching

def _get(params: dict) -> dict:
    url = net.plain_url(API, "search", params)
    hit = cache.get(url, ttl=cache.DEFAULT_TTL)
    if hit is None:
        hit = net.get(url, service=SERVICE, accept="application/json")
        cache.put(url, hit)
    try:
        return json.loads(hit)
    except ValueError as exc:
        raise net.NetworkError(f"{SERVICE} returned an unreadable response") from exc


def search(query: str, retmax: int = 25) -> tuple[list[Article], int]:
    """Records for a query, plus Europe PMC's own hit count.

    ``resultType=core`` is requested because the lite response omits the abstract,
    and an article without an abstract cannot be graded — it would arrive looking
    like a paper that failed to report anything.
    """
    payload = _get({"query": query, "format": "json", "resultType": "core",
                    "pageSize": max(1, min(retmax, 100)), "cursorMark": "*"})
    result = payload.get("resultList") or {}
    articles = []
    for raw in result.get("result") or []:
        parsed = parse_record(raw)
        if parsed is not None:
            articles.append(parsed)
    return articles, int(payload.get("hitCount") or len(articles))


def parse_record(raw: dict) -> Article | None:
    """One Europe PMC result into the common :class:`Article` shape."""
    source = (raw.get("source") or "").upper()
    ident = str(raw.get("id") or "").strip()
    pmid = str(raw.get("pmid") or "").strip()
    if not ident and not pmid:
        return None

    year = None
    for key in ("pubYear", "firstPublicationDate"):
        value = str(raw.get(key) or "")
        if value[:4].isdigit():
            year = int(value[:4])
            break

    authors = [a.strip() for a in (raw.get("authorString") or "").split(",")
               if a.strip()]
    pub_types = [p for p in
                 ((raw.get("pubTypeList") or {}).get("pubType") or []) if p]

    mesh = [h.get("descriptorName", "") for h in
            ((raw.get("meshHeadingList") or {}).get("meshHeading") or [])
            if h.get("descriptorName")]
    keywords = [k for k in
                ((raw.get("keywordList") or {}).get("keyword") or []) if k]

    corrections = []
    for c in ((raw.get("commentCorrectionList") or {}).get("commentCorrection")
              or []):
        kind = _COMMENT_KINDS.get((c.get("type") or "").strip().lower())
        if kind:
            corrections.append(Correction(kind=kind, pmid=str(c.get("id") or ""),
                                          note=(c.get("note") or "").strip()))

    full_text = ""
    for url_entry in ((raw.get("fullTextUrlList") or {}).get("fullTextUrl") or []):
        if url_entry.get("url"):
            full_text = url_entry["url"]
            if (url_entry.get("documentStyle") or "") == "html":
                break

    is_preprint = source in PREPRINT_SOURCES or \
        any("preprint" in p.lower() for p in pub_types)
    abstract = (raw.get("abstractText") or "").strip()
    title = (raw.get("title") or "").strip().rstrip(".")

    return Article(
        pmid=pmid,
        title=title,
        abstract=abstract,
        journal=(raw.get("journalTitle") or
                 ("Preprint" if is_preprint else "")).strip(),
        year=year,
        authors=authors,
        publication_types=pub_types,
        mesh_terms=mesh,
        keywords=keywords,
        doi=(raw.get("doi") or "").strip(),
        language=(raw.get("language") or "").strip(),
        corrections=corrections,
        source="europepmc",
        source_id=f"{source}/{ident}" if source else ident,
        is_preprint=is_preprint,
        cited_by=(int(raw["citedByCount"])
                  if str(raw.get("citedByCount") or "").isdigit() else None),
        open_access=(raw.get("isOpenAccess") or "N").upper() == "Y",
        full_text_url=full_text,
        nct_ids=sorted({m.group(0).upper()
                        for m in _NCT_RE.finditer(f"{title} {abstract}")}),
    )
