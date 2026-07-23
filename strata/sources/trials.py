"""ClinicalTrials.gov — the trials that exist, not just the ones that published.

Every other part of Strata reads the *published* literature. This module reads
the register, and the difference between those two sets is the single most
important number in evidence synthesis.

A trial is registered before it starts. If it finishes and its result is
unwelcome, it may simply never be written up — and a literature search cannot see
what was never published. Pooling only the published trials then produces an
estimate biased toward whatever the sponsors were willing to print. Funnel plots
and Egger's test try to *infer* that gap from the shape of the published data;
the register lets you **measure** it directly:

    12 completed trials matched this question, enrolling 8,410 participants.
    7 published (n = 5,120). 5 have posted no results and no publication
    (n = 3,290, 39% of enrolled participants unaccounted for).

That paragraph is what an HTA submission, a regulatory dossier and an honest
meta-analysis all need, and no amount of reading PubMed harder will produce it.

What else the register gives that a paper cannot:

**Prospective registration, checked rather than claimed.** A paper says "the trial
was registered". The register knows *when*. Registration after the first patient
was enrolled means the outcomes could have been chosen once the data were in, and
:mod:`strata.appraisal.rob2` treats that as a selective-reporting signal.

**Enrollment as planned versus as achieved.** A trial that targeted 900 and
enrolled 210 was stopped or failed to recruit; either way its precision is not
what the protocol promised.

**Masking from the protocol.** ``QUADRUPLE`` masking is a structured field, not a
sentence in an abstract that the reader has to interpret.

**Results without a paper.** Since FDAAA 801 an applicable trial must post
summary results to the register within a year of completion. Those results are
evidence. They are invisible to PubMed.

Public data, no key, no account. The API is ClinicalTrials.gov v2 (JSON).
"""
from __future__ import annotations

import datetime as _dt
import json
import re
from dataclasses import dataclass, field

from .. import cache, net

API = "https://clinicaltrials.gov/api/v2"
SERVICE = "ClinicalTrials.gov"

#: FDAAA 801 requires summary results within 12 months of primary completion for
#: an applicable clinical trial. A trial past that with nothing posted and nothing
#: published is overdue — a fact, not an accusation: some trials are exempt.
REPORTING_DEADLINE_DAYS = 365

#: The register's own status vocabulary, grouped by what it means for evidence.
FINISHED = {"COMPLETED", "TERMINATED", "WITHDRAWN", "SUSPENDED"}
ONGOING = {"RECRUITING", "ACTIVE_NOT_RECRUITING", "ENROLLING_BY_INVITATION",
           "NOT_YET_RECRUITING"}

_NCT_RE = re.compile(r"\bNCT\d{8}\b", re.I)
_ISRCTN_RE = re.compile(r"\bISRCTN\d{8}\b", re.I)
_EUDRACT_RE = re.compile(r"\b\d{4}-\d{6}-\d{2}\b")


def _dig(obj, *path, default=None):
    """Walk a nested dict, returning ``default`` the moment the path breaks.

    The register's JSON is deeply nested and every module is optional — an
    observational study has no ``armsInterventionsModule`` at all. Traversing
    with ``.get()`` chains would be unreadable and traversing with ``[]`` would
    make a missing optional field crash a search.
    """
    cur = obj
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
        if cur is None:
            return default
    return cur


def _date(value: str | None) -> _dt.date | None:
    """Parse a register date, which may be ``2021``, ``2021-06`` or ``2021-06-15``.

    A month-precision date is normalised to the first of the month. That is a
    real approximation and it is the conservative direction: it can only make a
    trial look *less* overdue than it is, never more.
    """
    if not value:
        return None
    text = str(value).strip()
    for fmt, pad in (("%Y-%m-%d", None), ("%Y-%m", "-01"), ("%Y", "-01-01")):
        try:
            return _dt.datetime.strptime(text + (pad or ""), "%Y-%m-%d").date()
        except ValueError:
            continue
    return None


@dataclass
class TrialRecord:
    """One registered study, as the register describes it."""
    nct_id: str
    title: str
    brief_summary: str = ""
    status: str = ""
    study_type: str = ""              # INTERVENTIONAL | OBSERVATIONAL | EXPANDED_ACCESS
    phases: list[str] = field(default_factory=list)
    allocation: str = ""              # RANDOMIZED | NON_RANDOMIZED | NA
    masking: str = ""                 # NONE | SINGLE | DOUBLE | TRIPLE | QUADRUPLE
    who_masked: list[str] = field(default_factory=list)
    primary_purpose: str = ""
    enrollment: int | None = None
    enrollment_type: str = ""         # ACTUAL | ESTIMATED
    conditions: list[str] = field(default_factory=list)
    interventions: list[str] = field(default_factory=list)
    primary_outcomes: list[str] = field(default_factory=list)
    secondary_outcomes: list[str] = field(default_factory=list)
    sponsor: str = ""
    sponsor_class: str = ""           # INDUSTRY | NIH | FED | OTHER | ...
    start_date: _dt.date | None = None
    primary_completion_date: _dt.date | None = None
    completion_date: _dt.date | None = None
    first_submitted: _dt.date | None = None
    results_posted_date: _dt.date | None = None
    has_results: bool = False
    linked_pmids: list[str] = field(default_factory=list)
    result_pmids: list[str] = field(default_factory=list)
    secondary_ids: list[str] = field(default_factory=list)
    why_stopped: str = ""

    # ------------------------------------------------------------- properties
    @property
    def url(self) -> str:
        return f"https://clinicaltrials.gov/study/{self.nct_id}"

    @property
    def is_randomised(self) -> bool:
        return self.allocation.upper() == "RANDOMIZED"

    @property
    def is_finished(self) -> bool:
        return self.status.upper() in FINISHED

    @property
    def is_industry_funded(self) -> bool:
        return self.sponsor_class.upper() == "INDUSTRY"

    @property
    def year(self) -> int | None:
        d = self.start_date or self.first_submitted
        return d.year if d else None

    @property
    def prospectively_registered(self) -> bool | None:
        """Whether registration preceded the first participant.

        ``None`` when either date is missing — which is not the same as "no", and
        is reported differently. A trial registered in the same month it started
        is given the benefit of the doubt, because month-precision dates cannot
        resolve the order within a month.
        """
        if not self.first_submitted or not self.start_date:
            return None
        if (self.first_submitted.year, self.first_submitted.month) == \
                (self.start_date.year, self.start_date.month):
            return True
        return self.first_submitted <= self.start_date

    @property
    def registration_lag_days(self) -> int | None:
        """Days between the trial starting and being registered. Negative is good."""
        if not self.first_submitted or not self.start_date:
            return None
        return (self.first_submitted - self.start_date).days

    def reporting_status(self, today: _dt.date | None = None) -> str:
        """One of: published, results-posted, ongoing, overdue, awaiting, unknown.

        The order matters. A trial with a linked publication is reported however
        empty its results section is; a trial with posted summary results is
        reported even though PubMed has never heard of it. Only what is finished,
        past the deadline and silent on both counts is called overdue.
        """
        today = today or _dt.date.today()
        if self.result_pmids or self.linked_pmids:
            return "published"
        if self.has_results:
            return "results-posted"
        if self.status.upper() in ONGOING:
            return "ongoing"
        if self.status.upper() == "WITHDRAWN":
            return "withdrawn"          # never enrolled anyone; not a missing result
        done = self.primary_completion_date or self.completion_date
        if done is None:
            return "unknown"
        if (today - done).days > REPORTING_DEADLINE_DAYS:
            return "overdue"
        return "awaiting"

    @property
    def masking_strength(self) -> int:
        """0-4, how many parties were masked. Feeds the RoB 2 blinding domain."""
        return {"NONE": 0, "SINGLE": 1, "DOUBLE": 2, "TRIPLE": 3,
                "QUADRUPLE": 4}.get(self.masking.upper(), 0)

    def text(self) -> str:
        return f"{self.title} {self.brief_summary}".strip()

    def as_dict(self) -> dict:
        return {
            "nct_id": self.nct_id, "title": self.title, "url": self.url,
            "status": self.status, "study_type": self.study_type,
            "phases": self.phases, "allocation": self.allocation,
            "masking": self.masking, "randomised": self.is_randomised,
            "enrollment": self.enrollment, "enrollment_type": self.enrollment_type,
            "conditions": self.conditions, "interventions": self.interventions,
            "primary_outcomes": self.primary_outcomes,
            "sponsor": self.sponsor, "sponsor_class": self.sponsor_class,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "completion_date": (self.primary_completion_date.isoformat()
                                if self.primary_completion_date else None),
            "first_submitted": (self.first_submitted.isoformat()
                                if self.first_submitted else None),
            "prospectively_registered": self.prospectively_registered,
            "registration_lag_days": self.registration_lag_days,
            "has_results": self.has_results,
            "linked_pmids": self.linked_pmids,
            "reporting_status": self.reporting_status(),
            "why_stopped": self.why_stopped,
        }


# --------------------------------------------------------------------- parsing

def parse_study(raw: dict) -> TrialRecord | None:
    """One study object from the v2 API into a :class:`TrialRecord`.

    Tolerant on purpose: a study missing half its optional modules is still a
    registered trial and still counts toward what was and was not reported.
    """
    protocol = raw.get("protocolSection") or {}
    nct = _dig(protocol, "identificationModule", "nctId", default="")
    if not nct:
        return None

    ident = protocol.get("identificationModule") or {}
    status_mod = protocol.get("statusModule") or {}
    design = protocol.get("designModule") or {}
    design_info = design.get("designInfo") or {}

    linked, results = [], []
    for ref in _dig(protocol, "referencesModule", "references", default=[]) or []:
        pmid = str(ref.get("pmid") or "").strip()
        if not pmid:
            continue
        # The register distinguishes a paper *about* the trial from one merely
        # cited as background. Only the former counts as this trial reporting.
        if (ref.get("type") or "").upper() in ("RESULT", "DERIVED"):
            results.append(pmid)
        linked.append(pmid)

    secondary = [s.get("id", "") for s in ident.get("secondaryIdInfos") or []
                 if s.get("id")]

    return TrialRecord(
        nct_id=nct,
        title=(ident.get("briefTitle") or ident.get("officialTitle") or "").strip(),
        brief_summary=(_dig(protocol, "descriptionModule", "briefSummary",
                            default="") or "").strip(),
        status=status_mod.get("overallStatus") or "",
        study_type=design.get("studyType") or "",
        phases=design.get("phases") or [],
        allocation=design_info.get("allocation") or "",
        masking=_dig(design_info, "maskingInfo", "masking", default="") or "",
        who_masked=_dig(design_info, "maskingInfo", "whoMasked", default=[]) or [],
        primary_purpose=design_info.get("primaryPurpose") or "",
        enrollment=_dig(design, "enrollmentInfo", "count"),
        enrollment_type=_dig(design, "enrollmentInfo", "type", default="") or "",
        conditions=_dig(protocol, "conditionsModule", "conditions", default=[]) or [],
        interventions=[i.get("name", "") for i in
                       _dig(protocol, "armsInterventionsModule", "interventions",
                            default=[]) or [] if i.get("name")],
        primary_outcomes=[o.get("measure", "") for o in
                          _dig(protocol, "outcomesModule", "primaryOutcomes",
                               default=[]) or [] if o.get("measure")],
        secondary_outcomes=[o.get("measure", "") for o in
                            _dig(protocol, "outcomesModule", "secondaryOutcomes",
                                 default=[]) or [] if o.get("measure")],
        sponsor=_dig(protocol, "sponsorCollaboratorsModule", "leadSponsor", "name",
                     default="") or "",
        sponsor_class=_dig(protocol, "sponsorCollaboratorsModule", "leadSponsor",
                           "class", default="") or "",
        start_date=_date(_dig(status_mod, "startDateStruct", "date")),
        primary_completion_date=_date(
            _dig(status_mod, "primaryCompletionDateStruct", "date")),
        completion_date=_date(_dig(status_mod, "completionDateStruct", "date")),
        first_submitted=_date(status_mod.get("studyFirstSubmitDate")),
        results_posted_date=_date(
            _dig(status_mod, "resultsFirstPostDateStruct", "date")),
        has_results=bool(raw.get("hasResults")),
        linked_pmids=linked,
        result_pmids=results,
        secondary_ids=secondary,
        why_stopped=(status_mod.get("whyStopped") or "").strip(),
    )


# -------------------------------------------------------------------- fetching

def _get(params: dict, *, ttl: int = cache.DEFAULT_TTL) -> dict:
    url = net.plain_url(API, "studies", params)
    hit = cache.get(url, ttl=ttl)
    if hit is None:
        hit = net.get(url, service=SERVICE, accept="application/json")
        cache.put(url, hit)
    try:
        return json.loads(hit)
    except ValueError as exc:
        raise net.NetworkError(
            f"{SERVICE} returned an unreadable response") from exc


@dataclass
class TrialSearch:
    trials: list[TrialRecord]
    total: int
    query: str


def search(condition: str = "", intervention: str = "", *, term: str = "",
           page_size: int = 50, status: list[str] | None = None,
           study_type: str = "", max_pages: int = 2) -> TrialSearch:
    """Search the register. Any of condition, intervention or free term.

    Paged rather than capped at one request, because the interesting question —
    "how many completed trials are there and how many reported?" — is answered
    wrongly by the first fifty. ``max_pages`` bounds it so a broad query cannot
    turn into a hundred round trips.
    """
    params = {
        "format": "json",
        "pageSize": max(1, min(page_size, 1000)),
        "countTotal": "true",
    }
    if condition:
        params["query.cond"] = condition
    if intervention:
        params["query.intr"] = intervention
    if term:
        params["query.term"] = term
    if status:
        params["filter.overallStatus"] = "|".join(status)
    if study_type:
        params["query.term"] = (params.get("query.term", "") +
                                f" AREA[StudyType]{study_type}").strip()

    trials: list[TrialRecord] = []
    total = 0
    token = None
    for _ in range(max(1, max_pages)):
        page = dict(params)
        if token:
            page["pageToken"] = token
        payload = _get(page)
        total = int(payload.get("totalCount") or total or 0)
        for raw in payload.get("studies") or []:
            record = parse_study(raw)
            if record is not None:
                trials.append(record)
        token = payload.get("nextPageToken")
        if not token:
            break

    described = " / ".join(x for x in (condition, intervention, term) if x)
    return TrialSearch(trials=trials, total=total or len(trials), query=described)


def fetch(nct_id: str) -> TrialRecord | None:
    """One trial by registration number."""
    nct = nct_id.strip().upper()
    if not _NCT_RE.fullmatch(nct):
        raise ValueError(f"not a ClinicalTrials.gov identifier: {nct_id!r}")
    url = net.plain_url(API, f"studies/{nct}", {"format": "json"})
    hit = cache.get(url, ttl=cache.DEFAULT_TTL)
    if hit is None:
        try:
            hit = net.get(url, service=SERVICE, accept="application/json")
        except net.NetworkError:
            return None
        cache.put(url, hit)
    try:
        return parse_study(json.loads(hit))
    except ValueError:
        return None


# --------------------------------------------------------- identifiers in text

def registry_ids(text: str) -> dict[str, list[str]]:
    """Registration numbers mentioned anywhere in a piece of text.

    Journals require the registration number in the abstract, so this recovers
    the trial↔paper link from the paper's side even when the register has not
    recorded the publication from its side. The two directions disagree often
    enough that using only one loses real links.
    """
    body = text or ""
    return {
        "nct": sorted({m.group(0).upper() for m in _NCT_RE.finditer(body)}),
        "isrctn": sorted({m.group(0).upper() for m in _ISRCTN_RE.finditer(body)}),
        "eudract": sorted({m.group(0) for m in _EUDRACT_RE.finditer(body)}),
    }
