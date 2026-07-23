"""Federated retrieval across every source, with per-source accounting.

One question goes out to several databases at once, the results are merged and
de-duplicated, and what came back from where is recorded rather than blurred.

Three design decisions worth stating, because each is the opposite of what a
naive federation does:

**Each source gets its own query, built from the same parse.** PubMed and
Europe PMC do not share a field vocabulary. Translating one query string into the
other produces something that parses and retrieves the wrong set. Both are built
from the parsed PICO instead, and both strings are kept verbatim — PRISMA 2020
item 7 requires a systematic review to publish the exact search run against each
database, and "we searched PubMed and Europe PMC" is not that.

**A source that fails does not fail the search.** Europe PMC being down is not a
reason to refuse to answer from PubMed. The failure is recorded on the source's
own report and surfaced in the result, because a search that silently covered
three databases instead of four is a search whose coverage claim is false.

**Merging is subtraction, not addition.** PubMed and Europe PMC overlap almost
entirely for journal articles. The union is not more evidence; the union with
duplicates removed is the same evidence with better metadata. Every merge is
counted so the PRISMA flow can report it.
"""
from __future__ import annotations

import concurrent.futures
import time
from dataclasses import dataclass, field

from .. import pico as pico_mod
from .. import ranking as rank_mod
from ..pico import PICO
from . import europepmc, trials
from .linkage import ReportingAudit, link

#: Sources that return papers. openFDA is deliberately absent: labels and adverse
#: event reports are a different kind of evidence with a different shape, and
#: folding them into a ranked list of studies would misrepresent both.
LITERATURE_SOURCES = ("pubmed", "europepmc")

#: Everything a federated search can draw on.
ALL_SOURCES = LITERATURE_SOURCES + ("trials",)

DEFAULT_SOURCES = ("pubmed", "europepmc", "trials")


@dataclass
class SourceReport:
    """What one database contributed, and what it cost."""
    name: str
    query: str = ""
    total_hits: int = 0            # what the source says exists
    retrieved: int = 0             # what was actually pulled back
    elapsed: float = 0.0
    error: str = ""

    @property
    def ok(self) -> bool:
        return not self.error

    def as_dict(self) -> dict:
        d = {"source": self.name, "query": self.query,
             "total_hits": self.total_hits, "retrieved": self.retrieved,
             "elapsed": round(self.elapsed, 2), "ok": self.ok}
        if self.error:
            d["error"] = self.error
        return d


@dataclass
class Federation:
    """The merged result set, with full provenance for every step."""
    articles: list = field(default_factory=list)
    reports: list[SourceReport] = field(default_factory=list)
    trials: list = field(default_factory=list)
    audit: ReportingAudit | None = None
    duplicates_removed: int = 0
    duplicate_groups: list = field(default_factory=list)
    records_before_merge: int = 0

    @property
    def sources_searched(self) -> list[str]:
        return [r.name for r in self.reports if r.ok]

    @property
    def sources_failed(self) -> list[str]:
        return [r.name for r in self.reports if not r.ok]

    @property
    def preprints(self) -> int:
        return sum(1 for a in self.articles if getattr(a, "is_preprint", False))

    def coverage_note(self) -> str | None:
        """A sentence when the search did not cover what it set out to."""
        failed = [r for r in self.reports if not r.ok]
        if not failed:
            return None
        names = ", ".join(f"{r.name} ({r.error})" for r in failed)
        return (f"Incomplete coverage: {names}. The results below come from the "
                f"remaining sources only.")

    def as_dict(self) -> dict:
        return {"sources": [r.as_dict() for r in self.reports],
                "records_before_merge": self.records_before_merge,
                "duplicates_removed": self.duplicates_removed,
                "records_after_merge": len(self.articles),
                "preprints": self.preprints,
                "sources_failed": self.sources_failed,
                "coverage_note": self.coverage_note(),
                "trial_audit": self.audit.as_dict() if self.audit else None}


# ---------------------------------------------------------------- the searches

def _search_pubmed(parsed: PICO, retmax: int, design, years,
                   search_fn) -> tuple[SourceReport, list]:
    report = SourceReport(name="pubmed")
    started = time.time()
    query = pico_mod.build_query(parsed, design=design, years=years)
    report.query = query
    try:
        articles, total, _translation = search_fn(query, retmax)
        report.total_hits, report.retrieved = total, len(articles)
    except Exception as exc:
        report.error = str(exc)
        articles = []
    report.elapsed = time.time() - started
    return report, articles


def _search_europepmc(parsed: PICO, retmax: int, design, years,
                      include_preprints: bool) -> tuple[SourceReport, list]:
    report = SourceReport(name="europepmc")
    started = time.time()
    query = europepmc.build_query(parsed, design=design, years=years,
                                  include_preprints=include_preprints)
    report.query = query
    try:
        articles, total = europepmc.search(query, retmax)
        report.total_hits, report.retrieved = total, len(articles)
    except Exception as exc:
        report.error = str(exc)
        articles = []
    report.elapsed = time.time() - started
    return report, articles


def _search_trials(parsed: PICO, page_size: int) -> tuple[SourceReport, list]:
    report = SourceReport(name="trials")
    started = time.time()
    condition = parsed.population or parsed.outcome
    intervention = parsed.intervention
    term = "" if (condition or intervention) else parsed.question
    report.query = " / ".join(x for x in (f"cond={condition}" if condition else "",
                                          f"intr={intervention}" if intervention else "",
                                          f"term={term}" if term else "") if x)
    try:
        found = trials.search(condition=condition, intervention=intervention,
                              term=term, page_size=page_size)
        report.total_hits, report.retrieved = found.total, len(found.trials)
        records = found.trials
    except Exception as exc:
        report.error = str(exc)
        records = []
    report.elapsed = time.time() - started
    return report, records


def search(parsed: PICO, *, retmax: int = 40, sources=DEFAULT_SOURCES,
           design: str | None = None, years: int | None = None,
           include_preprints: bool = True, search_fn=None,
           trial_page_size: int = 50) -> Federation:
    """Run every requested source concurrently and merge what comes back.

    Concurrent because the sources are independent and each is a network round
    trip: serially this is the sum of four latencies, in parallel it is the
    slowest one. The thread pool is small and short-lived — the per-host rate
    limiters in :mod:`strata.net` are what actually protect the upstreams, and
    they are shared across these threads.
    """
    from ..pubmed import search_with_total
    search_fn = search_fn or search_with_total
    wanted = [s for s in sources if s in ALL_SOURCES]

    jobs = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(wanted))) as pool:
        if "pubmed" in wanted:
            jobs["pubmed"] = pool.submit(_search_pubmed, parsed, retmax, design,
                                         years, search_fn)
        if "europepmc" in wanted:
            jobs["europepmc"] = pool.submit(_search_europepmc, parsed, retmax,
                                            design, years, include_preprints)
        if "trials" in wanted:
            jobs["trials"] = pool.submit(_search_trials, parsed, trial_page_size)

        results = {}
        for name, future in jobs.items():
            try:
                results[name] = future.result()
            except Exception as exc:      # a bug in a source must not lose the rest
                results[name] = (SourceReport(name=name, error=str(exc)), [])

    # Order matters for the merge: PubMed records come first so that when a
    # duplicate is found, the richer record is the incumbent. _keep_rank makes
    # that explicit rather than relying on order, but ordering it correctly
    # keeps the retained indices stable and the PRISMA counts legible.
    reports, articles, trial_records = [], [], []
    for name in ("pubmed", "europepmc", "trials"):
        if name not in results:
            continue
        report, payload = results[name]
        reports.append(report)
        if name == "trials":
            trial_records = payload
        else:
            articles.extend(payload)

    before = len(articles)
    merged, groups = rank_mod.deduplicate(articles)
    audit = link(merged, trial_records) if trial_records else None

    return Federation(
        articles=merged, reports=reports, trials=trial_records, audit=audit,
        duplicates_removed=sum(len(g.dropped) for g in groups),
        duplicate_groups=groups, records_before_merge=before)
