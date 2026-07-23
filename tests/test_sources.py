"""Tests for source adapters — parsing only, no network.

``_http.get_json`` is monkeypatched with realistic fixture payloads shaped like
the real Europe PMC and OpenAlex responses. Run: python tests/test_sources.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strata.sources import europepmc, openalex               # noqa: E402
from strata.sources import _http                              # noqa: E402


def test_europepmc_parsing():
    fixture = {"resultList": {"result": [{
        "pmid": "12345", "doi": "10.1/abc", "title": "RCT of Drug X",
        "abstractText": "In 1,000 patients, Drug X reduced events.",
        "pubYear": "2023", "isOpenAccess": "Y",
        "journalInfo": {"journal": {"title": "NEJM"}},
        "pubTypeList": {"pubType": ["Randomized Controlled Trial", "Journal Article"]},
        "authorList": {"author": [{"fullName": "Smith J"}, {"fullName": "Doe A"}]},
    }]}}
    orig = _http.get_json
    _http.get_json = lambda url, params=None, **kw: fixture
    try:
        arts = europepmc.search("drug x", 10)
    finally:
        _http.get_json = orig
    a = arts[0]
    assert a.pmid == "12345" and a.doi == "10.1/abc" and a.year == 2023
    assert a.journal == "NEJM" and a.has_full_text is True
    assert "Randomized Controlled Trial" in a.publication_types and a.source == "europepmc"
    assert a.authors == ["Smith J", "Doe A"]
    print("ok  europepmc adapter maps core fields, full-text flag, and pub types")


def test_openalex_abstract_reconstruction():
    fixture = {"results": [{
        "id": "https://openalex.org/W1", "doi": "https://doi.org/10.1/xyz",
        "title": "Cohort study of Drug Y", "publication_year": 2021,
        "type": "article",
        "abstract_inverted_index": {"Drug": [0], "Y": [1], "reduced": [2], "mortality": [3]},
        "authorships": [{"author": {"display_name": "Lee K"}}],
        "primary_location": {"source": {"display_name": "Circulation"}},
        "open_access": {"is_oa": True},
        "ids": {"pmid": "https://pubmed.ncbi.nlm.nih.gov/999/"},
    }]}
    orig = _http.get_json
    _http.get_json = lambda url, params=None, **kw: fixture
    try:
        arts = openalex.search("drug y", 10)
    finally:
        _http.get_json = orig
    a = arts[0]
    assert a.abstract == "Drug Y reduced mortality"        # inverted index reconstructed in order
    assert a.doi == "10.1/xyz" and a.pmid == "999" and a.year == 2021
    assert a.journal == "Circulation" and a.has_full_text is True and a.source == "openalex"
    print("ok  openalex adapter reconstructs abstracts and normalizes ids")


def test_openalex_empty_abstract():
    fixture = {"results": [{"title": "No abstract paper", "publication_year": 2020,
                            "type": "article", "abstract_inverted_index": None,
                            "authorships": [], "ids": {}}]}
    orig = _http.get_json
    _http.get_json = lambda url, params=None, **kw: fixture
    try:
        arts = openalex.search("x", 5)
    finally:
        _http.get_json = orig
    assert arts[0].abstract == ""                          # honest: no abstract, not invented
    print("ok  a missing abstract stays empty, never fabricated")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nall source tests passed")
