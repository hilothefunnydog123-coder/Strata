"""The evidence sources Strata reads.

Four public APIs, no keys required, no patient data anywhere near any of them:

``pubmed``        The curated biomedical literature. Lives in
                  :mod:`strata.pubmed` — the oldest module here, and still the
                  backbone: NLM's human-assigned publication types and MeSH
                  headings are the closest thing to ground truth Strata has.
``europepmc``     Preprints, open-access full text and citation counts. Overlaps
                  PubMed heavily for journal articles, which is why merging is
                  handled centrally.
``trials``        ClinicalTrials.gov. The trials that *exist*, as opposed to the
                  ones that published — the difference is publication bias, and
                  it is measurable rather than merely inferable.
``openfda``       Approved labels and the FAERS adverse event database. A
                  different kind of evidence with a different shape, and kept out
                  of the ranked literature list on purpose.

:mod:`registry` federates the literature sources and the register into one
merged, de-duplicated result set with per-source accounting.
:mod:`linkage` matches registrations to papers and measures what was never
reported.
"""
from .linkage import ReportingAudit, TrialLink, link
from .registry import (ALL_SOURCES, DEFAULT_SOURCES, LITERATURE_SOURCES,
                       Federation, SourceReport, search)
from .trials import TrialRecord, registry_ids

__all__ = [
    "search", "Federation", "SourceReport",
    "ALL_SOURCES", "DEFAULT_SOURCES", "LITERATURE_SOURCES",
    "link", "ReportingAudit", "TrialLink",
    "TrialRecord", "registry_ids",
]
