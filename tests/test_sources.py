"""Tests for the multi-source layer + keys + cohort. Run: python tests/test_sources.py

Offline: each source parser is exercised against a sample payload (no network), then dedupe,
search_all (with injected fetchers), API keys, cohort profiling, and compare.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["STRATA_HOME"] = tempfile.mkdtemp(prefix="strata-src-")

from strata import sources, keys, cohort, verify        # noqa: E402
from strata.pubmed import Article                        # noqa: E402


def test_parse_europepmc():
    data = {"resultList": {"result": [{
        "pmid": "111", "doi": "10.1/x", "title": "Meta-analysis of X.",
        "abstractText": "RR 0.80 (95% CI 0.72 to 0.90).", "pubYear": "2022",
        "authorString": "A B, C D", "journalTitle": "Lancet", "citedByCount": 140,
        "pubTypeList": {"pubType": ["Meta-Analysis"]}, "id": "111", "source": "MED"}]}}
    a = sources.parse_europepmc(data)[0]
    assert a.pmid == "111" and a.doi == "10.1/x" and a.cited_by == 140
    assert a.source == "europepmc" and "Meta-Analysis" in a.publication_types
    print("ok  Europe PMC parses (pmid, doi, citations, pub types)")


def test_parse_openalex_abstract_reconstruct():
    data = {"results": [{"title": "Cohort of Y", "publication_year": 2021,
            "abstract_inverted_index": {"Large": [0], "cohort": [1], "study": [2]},
            "authorships": [{"author": {"display_name": "E F"}}], "type": "article",
            "doi": "https://doi.org/10.2/y", "ids": {"pmid": "https://pubmed.ncbi.nlm.nih.gov/222"},
            "cited_by_count": 55, "primary_location": {"source": {"display_name": "BMJ"}},
            "open_access": {"oa_url": "http://oa/y"}}]}
    a = sources.parse_openalex(data)[0]
    assert a.abstract == "Large cohort study" and a.pmid == "222" and a.doi == "10.2/y"
    assert a.cited_by == 55 and a.full_text_url == "http://oa/y"
    print("ok  OpenAlex parses + reconstructs inverted-index abstract")


def test_parse_ctgov_and_crossref():
    ct = {"studies": [{"protocolSection": {
        "identificationModule": {"nctId": "NCT01", "briefTitle": "RCT of Z"},
        "descriptionModule": {"briefSummary": "A randomized trial."},
        "designModule": {"phases": ["PHASE3"], "designInfo": {"allocation": "RANDOMIZED"}},
        "statusModule": {"startDateStruct": {"date": "2021-01"}}}}]}
    a = sources.parse_ctgov(ct)[0]
    assert a.source == "clinicaltrials" and a.year == 2021
    assert "Randomized Controlled Trial" in a.publication_types and "NCT01" in a.url
    cr = {"message": {"items": [{"title": ["Trial of W"], "abstract": "<jats:p>Big <b>effect</b>.</jats:p>",
          "issued": {"date-parts": [[2020]]}, "author": [{"given": "G", "family": "H"}],
          "type": "journal-article", "DOI": "10.3/w", "is-referenced-by-count": 12,
          "container-title": ["NEJM"]}]}}
    b = sources.parse_crossref(cr)[0]
    assert b.abstract == "Big effect." and b.doi == "10.3/w" and b.cited_by == 12
    print("ok  ClinicalTrials.gov + Crossref parse (incl. JATS strip)")


def test_dedupe_merges_by_doi():
    a = Article("", "Meta of X", "abstract long enough here", "J", 2022, ["A"],
                ["Meta-Analysis"], source="europepmc", doi="10.1/X", cited_by=140)
    b = Article("999", "Meta of X", "", "J", 2022, ["A"], ["review"],
                source="openalex", doi="10.1/x", cited_by=150)
    merged = sources.dedupe([a, b])
    assert len(merged) == 1
    m = merged[0]
    assert m.cited_by == 150 and m.pmid == "999"        # merged best fields
    print("ok  dedupe merges duplicates by DOI, keeps best metadata")


def test_search_all_injected():
    def f1(q, n):
        return [Article("1", "Meta of X", "RR 0.8 (95% CI 0.7 to 0.9).", "J", 2022, ["A"],
                        ["Meta-Analysis"], source="pubmed", cited_by=200, doi="10.1/x")]

    def f2(q, n):
        return [Article("", "Meta of X", "dup", "J", 2022, ["A"], ["review"],
                        source="openalex", cited_by=250, doi="10.1/x"),
                Article("2", "RCT of X", "HR 0.7.", "J", 2021, ["A"],
                        ["Randomized Controlled Trial"], source="europepmc", cited_by=90)]

    def boom(q, n):
        raise RuntimeError("source down")

    res = sources.search_all("x", _fetchers=[f1, f2, boom])   # one source down != failure
    assert len(res) == 2 and res[0].cited_by == 250          # deduped + citation-sorted
    assert sources.source_breakdown(res).get("pubmed") == 1
    print("ok  search_all fans out, dedupes, sorts, and fails soft per source")


def test_api_keys():
    raw, rec = keys.generate("prod")
    assert raw.startswith("sk_live_") and keys.validate(raw)["label"] == "prod"
    assert keys.validate("sk_live_nope") is None
    assert keys.validate(raw)["requests"] == 2                # usage tracked
    assert any(k["id"] == rec["id"] for k in keys.list_keys())
    assert keys.revoke(rec["id"]) and keys.validate(raw) is None
    print("ok  API keys generate, validate, track usage, and revoke")


def test_cohort_profile_and_note():
    rows = [{"age": 82, "medications": "metformin, aspirin", "conditions": "diabetes"},
            {"age": 85, "meds": "metformin"}, {"age": 40, "drugs": "statin"}]
    prof = cohort.profile_from_rows(rows)
    assert prof["age_median"] == 82 and prof["age_bands"]["frail_elderly"] > 0.6
    assert prof["top_medications"][0]["name"] == "metformin"
    rec = cohort.import_cohort("Clinic A", rows)
    assert cohort.get(rec["id"])["profile"]["n"] == 3
    note = cohort.population_note(prof, [{"snippet": "adults only, excluded over 80", "title": "t"}])
    assert note and "80+" in note
    print("ok  cohort profiles rows to aggregates + a generalizability note")


def test_compare():
    STRONG = [Article("1", "Meta: A cuts mortality", "HR 0.80 (95% CI 0.72 to 0.90).", "J",
                      2022, ["A"], ["Meta-Analysis"], cited_by=300),
              Article("2", "RCT: A cuts mortality", "HR 0.78 (95% CI 0.66 to 0.92).", "J",
                      2021, ["A"], ["Randomized Controlled Trial"], cited_by=120)]
    WEAK = [Article("3", "Case report on B", "One patient.", "J", 2020, ["A"], ["Case Reports"])]
    cmp = verify.compare_claims(
        "Aspirin cuts mortality", "Betamed cuts mortality", now="2026-01-01T00:00:00+00:00",
        _search=lambda q, retmax=40: STRONG if "aspirin" in q.lower() else WEAK)
    assert cmp["winner"] == "a" and cmp["a"]["status"] == "Supported"
    print("ok  compare picks the claim with the stronger evidence base")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nall sources + keys + cohort tests passed")
