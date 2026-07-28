# Corpus

What is actually available, what it costs to get, and what is off limits.

**Read this caveat first.** The build specification asked me to investigate the
sources before writing a fetcher. I did, but not by crawling: every government
host the corpus needs is blocked at this environment's egress proxy, which
answers `403` to `CONNECT` for `hhs.gov`, `ecfr.gov`, and `cms.gov`, through
both `curl` and the harness fetch tool. Details are in `BLOCKED.md`.

So the findings below come from published documentation and from search, not
from hitting the endpoints. Everything stated as fact is sourced. Anything I
could not confirm is marked **unverified** rather than asserted, and each
unverified item names the single command that will settle it once egress exists.
The fetchers are written against these findings and are structured so that a
wrong guess about a URL shape is a small change in one adapter.

---

## 1. HHS Departmental Appeals Board: Medicare Appeals Council decisions

**This is the corpus that matters.** Council decisions are the published record
of Medicare coverage disputes, and they are what the product's legal assertions
cite.

### What exists

Three distinct bodies publish under the DAB umbrella, and they are not
interchangeable:

| Body | What it decides | Relevance |
| --- | --- | --- |
| **Medicare Appeals Council** | Level 4 appeals of OMHA ALJ decisions, on coverage and payment | **Primary target.** This is where post-acute coverage disputes land. |
| **DAB Appellate Division** ("Board decisions") | Provider enrolment, CMPs, exclusions, grant disputes | Mostly not coverage. Occasional relevance. |
| **DAB Civil Remedies Division ALJs** | First instance for enforcement matters | Not coverage. |

Index pages:

- Council decisions and the DAB decision index:
  `https://www.hhs.gov/about/agencies/dab/decisions/` with the Board decisions
  index at `https://www.hhs.gov/about/agencies/dab/decisions/board-decisions/index.html`.
  Indexes are organised by year.
- Individual decisions are served as PDF under paths of the shape
  `https://www.hhs.gov/dab/decisions/dabdecisions/dab<number>.pdf`, which is
  confirmed by a live search result for `dab2400.pdf`. **Unverified:** whether
  Council decisions share that path shape or use a separate prefix.
  Settle it with: `curl -sI https://www.hhs.gov/about/agencies/dab/decisions/ | head`
  followed by one index fetch.

### The better route: the bulk dataset

Council decisions are also published as a structured dataset rather than only as
a website to scrape:

- Data.gov: `https://catalog.data.gov/dataset/medicare-appeals-council-decisions`
- HealthData.gov, Socrata dataset id `b8ey-rqrx`:
  `https://healthdata.gov/dataset/Medicare-Appeals-Council-Decisions/b8ey-rqrx`

Socrata exposes a documented JSON API at
`https://healthdata.gov/resource/b8ey-rqrx.json` with `$limit`, `$offset`,
`$where`, and `$order`, and no API key is needed for modest volumes.

**This is the fetcher I built for the DAB source**, because it is better than
crawling in every respect: it is paginated, it is filterable by date, it is
stable, and it does not put load on a public website. The HTML index is
implemented as a fallback for the same reason you keep a spare.

**Unverified:** the exact column names, the record count, and the date coverage.
One command settles all three:

```
curl -s 'https://healthdata.gov/resource/b8ey-rqrx.json?$limit=1' | jq .
curl -s 'https://healthdata.gov/resource/b8ey-rqrx.json?$select=count(1)' | jq .
```

### Volume, and whether the plan survives it

The specification's M5 acceptance criterion is 200 real decisions with verified
holdings. I could not measure the corpus size from here, so I cannot promise
that number is met, and I will not pretend otherwise.

What I can say about the shape of the risk:

- Council decisions run to thousands over the covered period, so 200 total
  documents is not the binding constraint.
- The binding constraint is 200 decisions **relevant to Medicare Advantage
  denials of skilled nursing and inpatient rehabilitation**. That is a much
  narrower slice, and it may well be under 200.

This is question 3 of the specification's section 19. My answer, with the caveat
that it rests on structure rather than a count:

**Keep the initial focus, and widen the retrieval filter rather than the corpus
target.** The strongest argument in this domain, that 42 CFR 422.101(b) forbids
a Medicare Advantage plan from applying criteria more restrictive than
Traditional Medicare, does not depend on the prior decision having involved
skilled nursing. A Council decision holding that a plan may not substitute
proprietary criteria is authority for that proposition whatever service it
arose from. So the ingestion should take all Council decisions, and the
retrieval should score service type as one signal among several rather than
treat it as a hard filter. That is how `lib/corpus/retrieve.ts` is written.

If the count of genuinely on-point decisions turns out to be small, the
honest move is not to change denial type but to say so on the operator console,
which is why corpus health reports holdings by service type and denial basis
rather than one total.

---

## 2. OMHA ALJ decisions

**Confirmed: these are not published, and no fetcher was built.**

OMHA issues Level 3 decisions in very large numbers. They are individualised
claim determinations, they contain beneficiary medical information, and they
carry no precedential force outside the appeal they decide. HHS has never
maintained anything like PACER for them.

The narrow exception: since the 2017 appeals rule, the Council may designate
selected decisions as **precedential**. Those are published in the Federal
Register and posted on an HHS site, and they bind CMS, its contractors, OMHA
adjudicators, and the Council itself.

**What this means for the build.** No OMHA fetcher exists, which is the correct
outcome rather than a gap. Precedential Council decisions are strictly more
valuable than ordinary ones and arrive through the Council source in section 1,
so they are covered. Worth adding later: a flag on `source_document` marking a
decision as precedential, so retrieval can weight it above an ordinary one.

Sources: HHS OMHA glossary; the Federal Register rule at
`https://www.federalregister.gov/documents/2017/01/17/2016-32058/`.

---

## 3. eCFR: Title 42

**Confirmed available, documented, no licence encumbrance, and the right source
for the controlling regulation.**

- Developer resources: `https://www.ecfr.gov/reader-aids/ecfr-developer-resources`
- API documentation: `https://www.ecfr.gov/developers/documentation/api/v1`

Two families of endpoint matter here:

```
GET /api/versioner/v1/titles.json
GET /api/versioner/v1/full/{date}/title-{n}.xml?part={part}&section={section}
GET /api/versioner/v1/structure/{date}/title-{n}.json
```

Requests can be made for an entire title, which returns a downloadable XML
document, or at part level and below, which returns processed XML. The
structure endpoint gives the hierarchy, which is what populates `heading_path`
on each span.

The provisions the product needs:

| Citation | What it establishes |
| --- | --- |
| **42 CFR 422.101(b)** | Medicare Advantage plans must comply with Traditional Medicare coverage rules and may not apply more restrictive criteria. The core argument. |
| 42 CFR 422.566 | Organisation determinations. |
| 42 CFR 422.578 to 422.590 | The MA appeals ladder. |
| 42 CFR 409.30 to 409.36 | Skilled nursing facility coverage requirements. |
| 42 CFR 412.622(a)(3) | Inpatient rehabilitation facility coverage criteria. |

No API key, no registration, no licence acknowledgement. Government works, not
subject to copyright.

**Unverified:** the exact current parameter spelling on the `full` endpoint.
Settle it with `curl -s https://www.ecfr.gov/api/versioner/v1/titles.json | jq '.titles[] | select(.number==42)'`.

---

## 4. CMS Internet-Only Manuals

**Available, free, no licence, but PDF only and structurally awkward.**

The relevant manual is the **Medicare Benefit Policy Manual, Publication
100-02**, and specifically:

- **Chapter 8**, coverage of extended care (skilled nursing facility) services.
  This is the operative text for the largest slice of target denials: what
  counts as skilled nursing, what counts as skilled rehabilitation, the daily
  basis requirement, and the practical matter requirement.
- **Chapter 1**, inpatient hospital services, for inpatient rehabilitation.

Served from `https://www.cms.gov/regulations-and-guidance/guidance/manuals/`
as chapter PDFs. **Unverified:** the current per-chapter filenames, which CMS
has reorganised more than once.

Why this source is worth the awkwardness: the manual is what the Council
actually applies when it decides a skilled nursing coverage case, so an appeal
that quotes the regulation without the manual section is arguing at the wrong
altitude.

Handling: the PDF parser in `lib/corpus/parse.ts` extracts text with page
numbers, so a manual citation resolves to a page rather than to a document. That
is the granularity a reviewer needs to check it.

---

## 5. CMS Medicare Coverage Database (LCDs and NCDs)

**Encumbered. Deliberately not built.**

The MCD holds Local and National Coverage Determinations. The obstacle is not
technical:

> To access the Downloads Page, users must first agree to the AMA/ADA license
> agreement, because the Local Coverage data sets contain CPT/HCPCS coding
> information.

CPT codes and descriptions are copyrighted by the American Medical Association.
Access is gated behind a click-through licence, and there is no public
programmatic API for the full database: the documented route is a manual
download after accepting that agreement.

Per section 18 of the specification, a legally restricted source is not to be
built around. So:

- **No MCD fetcher exists.** The `lcd` and `ncd` values remain in the
  `source_type` enum, because the schema should not have to change on the day a
  licence is signed, but nothing populates them.
- The click-through licence is **not** accepted programmatically. Doing so would
  be a person at this company agreeing to AMA terms on behalf of the company
  without having read them, which is not a decision for a build script.

**To unblock:** someone with authority reads the AMA licence and decides whether
its terms are compatible with redistributing quoted coverage criteria inside
customer appeal letters. That is a legal question, not an engineering one.
Recorded in `BLOCKED.md`.

A useful consolation: the **Part C and Part D Appeals Decision Search** at
`https://www.cms.gov/medicare/appeals-grievances/appeals-decision-search-part-c-d`
covers Medicare Advantage appeal decisions specifically, which is exactly the
product's target population. **Unverified:** whether it offers bulk or
programmatic access. Worth checking first once egress exists, because if it
does, it is a better fit than the general Council corpus.

---

## 6. Crawling rules, as implemented

Every rule from section 9 of the specification is enforced in
`lib/corpus/fetch.ts`, not left to the individual adapters:

- **robots.txt** is fetched once per host, cached, and obeyed. A disallowed path
  is skipped and recorded, never fetched anyway.
- **One request per two seconds per domain**, with jitter, and exponential
  backoff on `429` or `5xx`. The limiter is keyed by host, so two sources on
  different hosts do not serialise behind each other.
- **User-Agent** identifies the crawler and carries a contact address from
  `CRAWLER_CONTACT`. The fetcher refuses to run if that variable is unset, so
  nobody can crawl anonymously by forgetting to configure it.
- **Raw bytes are stored before processing and never mutated.** Parsing reads
  from stored bytes, so a parser change is a reparse rather than a recrawl.
- **Content is hashed.** An unchanged document is skipped, which is what makes
  re-running the pipeline idempotent.

---

## 7. Stages

Each runs independently and resumes from where it stopped, because a crawl that
has to start over is a crawl that never finishes.

```
pnpm corpus:fetch    --source=dab        # or --source=ecfr, --source=manual
pnpm corpus:parse    --unparsed
pnpm corpus:extract  --unextracted
pnpm corpus:verify   --unverified
pnpm corpus:embed    --unembedded
pnpm corpus:status
```

Checkpointing is by database state rather than by a progress file: `parsed_at`,
`extracted_at`, and `verified_at` on the rows themselves. Interrupting any stage
and re-running it picks up exactly the unfinished work.

---

## 8. Current state

**The corpus is empty.** Nothing has been ingested, because nothing can be
reached from this environment. The pipeline is written, typechecked, and
unit tested against fixtures; it has never made a live request.

To populate it, in an environment with egress:

```
pnpm corpus:fetch --source=ecfr        # regulations first: smallest and cleanest
pnpm corpus:fetch --source=dab
pnpm corpus:parse --unparsed
pnpm corpus:extract --unextracted      # requires ANTHROPIC_API_KEY
pnpm corpus:verify --unverified
pnpm corpus:embed --unembedded
pnpm corpus:status
```

`corpus:status` prints documents by source, holdings by service type and denial
basis, the verification failure rate, and embedding coverage. The same figures
appear on the operator console under Corpus. If the verification failure rate
comes back above 5 percent, the extraction prompt is wrong and needs fixing
rather than the threshold being raised.
