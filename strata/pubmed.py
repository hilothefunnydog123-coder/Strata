"""PubMed access via the public NCBI E-utilities API.

Standard library only. Two calls: ``esearch`` turns a query into a list of PMIDs,
``efetch`` turns PMIDs into full article records. This is open bibliographic data
— no patient data, no API key required (set ``NCBI_API_KEY`` to raise the rate
limit from 3 to 10 requests/second).
"""
from __future__ import annotations

import os
import ssl
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
UA = {"User-Agent": "Strata/0.1 (evidence engine; research use)"}


def _ssl_context() -> ssl.SSLContext:
    """A verifying context that also trusts the operating-system certificate
    store. On managed Windows/macOS machines this picks up the corporate or
    school root certificate that a network proxy uses to intercept HTTPS — the
    usual cause of 'CERTIFICATE_VERIFY_FAILED'. An explicit bundle can be given
    via STRATA_CA_BUNDLE."""
    bundle = os.environ.get("STRATA_CA_BUNDLE")
    ctx = ssl.create_default_context(cafile=bundle) if bundle else ssl.create_default_context()
    try:
        ctx.load_default_certs(ssl.Purpose.SERVER_AUTH)   # OS trust store (Windows ROOT/CA)
    except Exception:
        pass
    return ctx


@dataclass
class Article:
    pmid: str
    title: str
    abstract: str
    journal: str
    year: int | None
    authors: list[str]
    publication_types: list[str] = field(default_factory=list)

    @property
    def citation(self) -> str:
        first = self.authors[0] if self.authors else "Anon"
        etal = " et al." if len(self.authors) > 1 else ""
        yr = self.year or "n.d."
        return f"{first}{etal} ({yr}). {self.journal}. PMID {self.pmid}"

    @property
    def url(self) -> str:
        return f"https://pubmed.ncbi.nlm.nih.gov/{self.pmid}/"


def _get(endpoint: str, params: dict) -> bytes:
    key = os.environ.get("NCBI_API_KEY")
    if key:
        params["api_key"] = key
    url = f"{EUTILS}/{endpoint}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30, context=_ssl_context()) as r:
            return r.read()
    except urllib.error.URLError as exc:
        # On a network that intercepts HTTPS (school/corporate proxy) whose root
        # cert isn't installed, allow an explicit opt-out. STRATA_INSECURE=1 skips
        # verification — fine for this read-only public data on a network you
        # trust, never a default.
        if isinstance(getattr(exc, "reason", None), ssl.SSLCertVerificationError) \
                and os.environ.get("STRATA_INSECURE") == "1":
            print("strata: STRATA_INSECURE=1 set — skipping TLS verification "
                  "(only safe on a network you trust).", file=sys.stderr)
            unverified = ssl.create_default_context()
            unverified.check_hostname = False
            unverified.verify_mode = ssl.CERT_NONE
            with urllib.request.urlopen(req, timeout=30, context=unverified) as r:
                return r.read()
        raise


def esearch(query: str, retmax: int = 20) -> list[str]:
    """Return PMIDs for a query, most relevant first."""
    import json
    raw = _get("esearch.fcgi", {"db": "pubmed", "term": query, "retmax": retmax,
                                "retmode": "json", "sort": "relevance"})
    return json.loads(raw)["esearchresult"].get("idlist", [])


def _text(node, path, default="") -> str:
    el = node.find(path)
    return "".join(el.itertext()).strip() if el is not None else default


def parse_articles(xml_bytes: bytes) -> list[Article]:
    """Parse an efetch PubmedArticleSet into Article records."""
    root = ET.fromstring(xml_bytes)
    out = []
    for art in root.findall(".//PubmedArticle"):
        medline = art.find(".//MedlineCitation")
        if medline is None:
            continue
        pmid = _text(medline, "PMID")
        article = medline.find("Article")
        if article is None:
            continue
        title = _text(article, "ArticleTitle")
        # abstracts can be split into labelled sections
        abstract = " ".join(
            (("" if s.get("Label") in (None, "") else s.get("Label") + ": ")
             + "".join(s.itertext()).strip())
            for s in article.findall(".//Abstract/AbstractText")
        ).strip()
        journal = _text(article, ".//Journal/ISOAbbreviation") or _text(article, ".//Journal/Title")
        year = _text(article, ".//JournalIssue/PubDate/Year")
        if not year:
            md = _text(article, ".//JournalIssue/PubDate/MedlineDate")
            year = md[:4] if md[:4].isdigit() else ""
        authors = []
        for a in article.findall(".//AuthorList/Author"):
            last, initials = _text(a, "LastName"), _text(a, "Initials")
            if last:
                authors.append(f"{last} {initials}".strip())
        ptypes = [pt.text for pt in article.findall(".//PublicationTypeList/PublicationType") if pt.text]
        out.append(Article(pmid=pmid, title=title, abstract=abstract, journal=journal,
                           year=int(year) if year.isdigit() else None,
                           authors=authors, publication_types=ptypes))
    return out


def efetch(pmids: list[str]) -> list[Article]:
    if not pmids:
        return []
    raw = _get("efetch.fcgi", {"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"})
    return parse_articles(raw)


def search_articles(query: str, retmax: int = 20) -> list[Article]:
    """Search PubMed and return full article records in relevance order."""
    pmids = esearch(query, retmax=retmax)
    articles = efetch(pmids)
    order = {p: i for i, p in enumerate(pmids)}
    articles.sort(key=lambda a: order.get(a.pmid, 1e9))
    return articles
