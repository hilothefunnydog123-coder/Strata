# Pre-build analysis (PROMPT §12)

Resolved before writing pipeline code. This is the outside-in reconnaissance the
prompt requires: source structure, crawl posture, the criterion taxonomy, and the
design plan with its own genericness critique.

---

## 1. Structured data / API vs. scraper, per source

| Source | Access | Notes |
|---|---|---|
| **CMS — NCD + LCD** | **Structured (API + bulk export)** | The Medicare Coverage Database (MCD) publishes NCDs and LCDs with stable document IDs (`NCDxx.x`, `Lxxxxx`), effective dates, and revision history, and exposes both a **downloadable relational export** and a **REST API** (`/api/…`). Prefer the export → API → scrape, in that order. Because it is versioned at the source with explicit `revision_history`, CMS is the reference implementation for our immutable-version model. |
| **MolDX / Palmetto GBA** | **Structured via MCD, + article scrape** | MolDX is administered by MACs (Palmetto GBA, Noridian, WPS, CGS). Its *coverage* is expressed as **LCDs and Billing & Coding Articles in the MCD**, so the LCD body comes through the CMS path. The MolDX **Technical Assessment** framework and DEX registry live on `palmettogba.com` as HTML articles and need a thin scraper. The AV/CV/CU triad (§3 below) is authored here. |
| **Aetna (CVS Health)** | **Scraper (HTML)** | Clinical Policy Bulletins (CPBs) are numbered HTML pages (`cpb/medical/data/NNN/NNNN.html`) with a consistent section skeleton (Policy / Background / References). No API. Highly structured DOM → high-quality span extraction. |
| **Cigna** | **Scraper (PDF)** | Coverage Policies are PDFs behind a policy index. Needs the PDF span pipeline (page numbers matter for citation). |
| **UnitedHealthcare** | **Scraper (PDF)** | Commercial + Community medical policies as PDFs behind an index; dated revision tables inside each doc. |
| **Elevance (Anthem)** | **Scraper (HTML + PDF)** | Clinical UM Guidelines and Medical Policies; mixed HTML/PDF. |
| **BCBS Michigan** | **Scraper (HTML)** | Medical Policy index with per-policy HTML and effective dates. |
| **Humana** | **Scraper (HTML + PDF)** | Medical Coverage Policies behind a searchable index. |

**Conclusion:** 2 of 8 (CMS, and MolDX's coverage half) are structured; the 6 commercial
payers require scrapers, split HTML vs PDF. The ingest interface therefore abstracts
`fetch → raw bytes` and lets each module choose export/API/HTML/PDF. Parsing is where
HTML and PDF converge onto one span model.

## 2. Crawl posture (robots.txt / ToS)

We do **not** hard-code any site's robots contents here — they change, and a stale copy in
a markdown file is worse than no copy. Instead the crawl rules are **enforced in code at
runtime** (`packages/ingest/src/robots.ts`, `rate-limit.ts`):

- Every fetcher fetches and parses the live `robots.txt` for its host and **honors
  `Disallow` for our User-Agent before any content request**. A disallowed path is skipped
  and logged, never fetched.
- One request per **2s per domain** with jittered exponential backoff (PROMPT §6).
- A descriptive `User-Agent` naming the crawler and a contact address (`ASSENT_CRAWLER_CONTACT`).
- Raw bytes are stored **before** any processing and never mutated; unchanged content
  (by `content_hash`) creates **no** new version.

**Flagged for legal review before enabling `live` mode on that source:** several commercial
payers' Terms of Use restrict automated access and/or bulk reproduction of policy text even
though the pages are public. The defensible posture — and the one this repo ships in — is:
CMS/MolDX (public-domain government works) are safe to ingest broadly; for the six commercial
payers, ingest is **gated behind a per-source `allow` flag** that a human sets only after
confirming that source's ToS permits it, or after a licensing conversation. Until then those
sources run **from committed fixtures only**. The code makes the safe path the default: with
`PIPELINE_MODE=fixture` (the default) nothing is fetched at all.

## 3. Criterion taxonomy (refined from real policies)

The §4 hypothesis is close but conflates two axes: **what kind of thing the requirement is
about** vs. **the logical role it plays**. Reading representative MolDX LCDs (e.g. the DEX Z-code /
Technical Assessment framing) and Aetna CPBs (Policy vs. Background structure) makes three things clear:

1. **The diagnostics-defining axis is the AV/CV/CU triad**, and MolDX treats these as
   *distinct, separately-adjudicated evidence bars*. They are the highest-weight kinds and must
   be first-class: `analytical_validity`, `clinical_validity`, `clinical_utility`.
2. **"evidence_standard", "study_design", and "endpoint" are not peers of the triad** — they
   are *modifiers* that describe how a validity/utility bar must be met (e.g. "clinical utility
   must be shown in a **prospective** study with an **outcomes** endpoint"). Keeping them as
   separate kinds fragments one requirement into several and breaks clustering. We fold them into
   structured **facets** on the criterion (`evidence.study_design`, `evidence.endpoint`,
   `evidence.comparator`) rather than their own `kind` rows.
3. **A "stance" is not a criterion.** Coverage/non-coverage/investigational is captured by
   `CoverageStance`, not `Criterion` — otherwise the union math double-counts.

**Shipped taxonomy** (`Criterion.kind`, see `packages/core/src/criterion.ts`):

`clinical_indication`, `prior_therapy`, `analytical_validity`, `clinical_validity`,
`clinical_utility`, `test_specific_requirement`, `population`, `frequency_limit`,
`site_of_service`, `ordering_provider`, `documentation`, `exclusion`.

Changes from the §4 hypothesis, with rationale:
- **Dropped** `evidence_standard`, `study_design`, `endpoint`, `comparator` as kinds → moved to
  the `evidence` facet on the criterion. They describe a bar; they aren't bars themselves.
- **Added** `test_specific_requirement` (MolDX DEX registration / Z-code identity / specific
  assay named as a precondition) and `ordering_provider` (specialty/attestation limits), both
  recurrent in real policies and not representable in the original list.
- **Kept** the triad, `clinical_indication`, `prior_therapy`, `population`, `frequency_limit`,
  `site_of_service`, `documentation`, `exclusion`.

The taxonomy lives in exactly one place (`CRITERION_KINDS`) so it can evolve as the corpus grows.

## 4. Design plan + genericness critique

Full plan and named palette: **`docs/DESIGN.md`**. Summary:

- **Palette** — a "policy paper" neutral base (warm off-white `#FBFAF7`, ink `#1A1A17`), a
  single reserved-meaning coverage scale (covered→silent) and a separate reserved diff scale
  (tightened/loosened), and **one** accent (`#2B5F8A`, "citation blue") used *only* for the
  citation-highlight signature moment. Coverage and diff hues appear nowhere else.
- **Type** — a serif for document reading surfaces (documents look like documents), a grotesque
  sans for chrome, and a monospace for every code / date / LCD number / identifier.
- **Signature element** — the citation highlight: clicking a requirement scrolls the source
  document and illuminates the exact supporting span. Boldness is spent here and nowhere else.

**Genericness critique of the first pass** (done before any CSS): the first instinct — indigo
primary, slate-gray sidebars, rounded cards, a stat hero — is indistinguishable from every B2B
SaaS dashboard and actively wrong for a legal-research instrument. Rejected specifically:
(a) card grids (replaced by dense tables and a document reading pane); (b) a decorative accent
used on buttons *and* links *and* charts (color is now load-bearing and rationed); (c) a hero
built around a big number and gradient (replaced by live policy prose being marked up); (d) generous
whitespace (replaced by high information density — this is an 8-hours-a-day terminal). The one place
we allow expressiveness is the marketing hero and the citation animation; everything else stays quiet.

---

### What "done" means in this environment (honesty note)

This repo is built and **verified offline**. `PIPELINE_MODE=fixture` runs ingest→parse→extract→
verify→diff→blueprint with committed real-shaped snapshots and a committed LLM cache, so the whole
thing runs with no network and no API key. Where an acceptance test needs external resources not
present here — live scraping of 8 payer sites, a paid LLM key at corpus scale, macOS/Windows Tauri
notarized builds — the code is wired to do the real thing when those exist, and the *logic* is
proven here against fixtures and unit tests. Every such boundary is called out in `docs/STATUS.md`.
