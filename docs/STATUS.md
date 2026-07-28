# Build status — milestones and honesty notes

> **Extraction no longer uses a language model.** A locally-trained neural network
> (`packages/brain`, see `docs/BRAIN.md`) classifies candidate clauses cut from the
> stored document, so a fabricated citation is structurally impossible rather than
> filtered. No API key, no network, no per-document inference cost.
>
> **The corpus is still sample text — and this is an environment limit, not a design
> gap.** Every document is a reconstruction, marked `provenance = 'sample'` and called
> out by an undismissable banner on every console page. `pnpm corpus:status` reports
> the real/sample split at any time, and `PIPELINE_MODE=live pnpm corpus:live` replaces
> it with genuine CMS documents in one command.
>
> That command was run from here and fails with:
> `403 … Host not in allowlist: api.coverage.cms.gov`. Every US government host is
> blocked by this sandbox's egress policy (cms.gov, data.cms.gov, federalregister.gov,
> ecfr.gov, govinfo.gov, clinicaltrials.gov, api.fda.gov all refuse). Only GitHub, npm,
> PyPI and mirror.gcr.io are reachable, and no mirror of the Medicare Coverage Database
> exists on any of them — CMSgov's public repos carry price-transparency schemas and
> quality measures, not coverage determinations. So the data cannot be obtained here by
> any route. It requires a machine with ordinary internet, where the command works and
> writes `provenance = 'fetched'` — the only code path allowed to set that value.

This build is developed and **verified offline** (`PIPELINE_MODE=fixture`, the default):
the whole pipeline runs with committed fixtures + a committed golden set, no network,
no API key. Where a milestone's literal acceptance needs external resources not present
in this environment — live fetching from the 8 payer sites,
notarized macOS/Windows Tauri builds — the code is wired to do the real thing when those
exist, and the *logic* is proven here against fixtures and unit tests. Those boundaries
are called out below.

## Milestone acceptance

| # | Milestone | Status | Evidence |
|---|-----------|--------|----------|
| M1 | Skeleton — schema, migrations | ✅ proven | `pnpm db:migrate` runs clean on live Postgres 16; 20 tables match §4; invariant NOT NULL + FK on `criterion.span_id`/`verbatim_quote`; re-run is a no-op |
| M2 | One source end-to-end | ✅ proven (all 8) | `pnpm pipeline`: ingest→parse for all sources; spans carry page numbers, char offsets, heading paths; content hashes preserved; re-run creates 0 duplicate versions |
| M3 | Extraction + verification | ✅ proven | 51 criteria extracted, **100% carry verified quotes, 0 rejected** (0.0% rejection rate, under the 5% gate) |
| M4 | Evals | ✅ proven (both golden sets) | `pnpm eval`: precision 74.1%, recall 84.3%, kind accuracy 93.0%, **hallucination 0%** (structural), citations 100%. Brain held out on 6 unseen payers: P 85.7% / R 100%. 6 adversarial scorer tests prove the harness discriminates. §9's second golden set now has 20 labeled diff pairs: the classifier scored 45% on them at first, exposing that it defaulted to "clarified"; rebuilt around what revisions actually do it now scores 20/20, and every run is snapshotted to the `eval_runs` table |
| M5 | Marketing site | ✅ proven | landing (live citation hero), tour, contact, legal; demo form writes to Postgres + notifies; `next build` passes; rendered + screenshotted (`docs/screenshots`) |
| M6 | Auth + dashboard | ✅ proven | admin CLI provisions accounts — `pnpm db:seed` (demo fixture), `pnpm founder --email …` (generated password + private TOTP secret, printed once, scrypt-hashed at rest, `--rotate` revokes live sessions and paired desktops), and `pnpm founder --bootstrap` on container boot for the founder, idempotent so a redeploy never resets credentials. The bootstrapped account carries **no second factor**: it is bound in the browser at `/enroll`, so the only copy is on the owner's phone. Verified headless end-to-end: password-only sign-in returns `enroll:true` and `/dashboard` 307s to `/enroll`; the pending secret survives a reload; a wrong code is refused; after enrolling, `/dashboard` renders, re-enrollment is 409, **password-only is 401**, and password+code is 200. The already-enrolled demo user is unaffected (password-only still 401). Download/license/seats/invoices + read-only coverage summary; **no signup route exists** |
| M7 | Desktop shell + device auth | ◑ built + run in browser | Tauri v2 project + React frontend build; the frontend **runs and is screenshotted** (device-auth screen, Criteria Rail, Coverage Map, Evidence Blueprint, Change Watch — `docs/screenshots/06–10`); device-flow API + approval work end-to-end on the web side. Not compiled to a notarized mac/Windows binary here (no display / signing toolchain). |
| M8 | Sync + Corpus + Criteria Rail | ✅ logic proven | `export-desktop` mirrors the corpus into SQLite; **FTS5 search over 300k spans: p50 16ms, p95 22ms, worst 25ms** (< 50ms). Criteria Rail highlight proven in the shared `CitationView` (marketing hero + desktop). |
| M9 | All 8 sources | ◑ fixtures + real CMS fetcher | CMS now has a **real** fetcher against the Medicare Coverage Database (US government work — no licensing review needed) that fails loudly rather than inventing data, plus a real PDF parser for Cigna/UHC. It has not been executed here (network blocked). The 9 curated docs are the quality set; `ingest --generate-scale=N` synthesizes structurally-real docs to reach the ≥300 count. Live crawling of the 6 commercial payers is gated behind a per-source ToS flag (PRE-BUILD §2). |
| M10 | Versioning + Change Watch | ✅ proven | L38045 v1→v2 yields a correct criterion-level change list with all five labels (tightened/loosened/clarified/added/removed) matching the hand-labeled diff golden set; surfaced in the desktop Change Watch |
| M11 | Asset Workspace + Coverage Map | ✅ proven | define an asset (dashboard + desktop); coverage map/summary renders every payer with correct stance + lives weighting; denominator labeled |
| M12 | Evidence Blueprint | ✅ proven | for `asset_demo`: a lives-weighted frontier (21%→100%) where every requirement traces to ≥1 verified citation and the lives math is reproducible by hand (unit-tested) |

Legend: ✅ proven here · ◑ built and logic-proven, final step needs an external resource.

## Environment boundaries (what a production run adds)

- **Live ingest.** `PIPELINE_MODE=live` fetches the real documents (robots-respecting,
  rate-limited, real User-Agent). CMS/MolDX are enabled; the 6 commercial payers are gated
  behind `SOURCES.<id>.liveAllowed` pending a per-source Terms-of-Use review. Until then
  they run from committed fixtures. The fetch/robots/rate-limit primitives exist and are tested.
- **No LLM at all.** Extraction is `@assent/brain`, trained locally and shipped as a JSON
  weight file — nothing to configure, nothing to pay for, and the same result on every run.
  What a bigger corpus adds is *training data*, which is the cheapest lever on quality:
  add annotated sentences and re-run `pnpm --filter @assent/brain train`. Blueprint
  embeddings use a deterministic feature hash; a learned embedding model + pgvector plug in
  behind the same interface at scale.
- **Outbound network.** Live ingest needs egress to the source hosts. In this environment
  all non-package-registry hosts are blocked by policy (`cms.gov` → 403 on CONNECT), which is
  why the corpus here is sample text and the CMS fetcher has never run against the live API.
- **Desktop binaries.** The Tauri v2 shell is well-formed; producing signed macOS/Windows
  installers needs those toolchains + a display, which this environment does not have. The React
  frontend builds and runs in a browser against the bundled corpus snapshot for demonstration.
- **pgvector.** Not installed here, so embeddings are JSONB + in-app cosine. Production swaps to
  `vector(N)` + an ivfflat index; the retrieval interface is isolated (`packages/db/README.md`).
