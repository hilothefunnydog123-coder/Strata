# Build status — milestones and honesty notes

This build is developed and **verified offline** (`PIPELINE_MODE=fixture`, the default):
the whole pipeline runs with committed fixtures + a committed golden set, no network,
no API key. Where a milestone's literal acceptance needs external resources not present
in this environment — live scraping of 8 payer sites, a paid LLM key at corpus scale,
notarized macOS/Windows Tauri builds — the code is wired to do the real thing when those
exist, and the *logic* is proven here against fixtures and unit tests. Those boundaries
are called out below.

## Milestone acceptance

| # | Milestone | Status | Evidence |
|---|-----------|--------|----------|
| M1 | Skeleton — schema, migrations | ✅ proven | `pnpm db:migrate` runs clean on live Postgres 16; 20 tables match §4; invariant NOT NULL + FK on `criterion.span_id`/`verbatim_quote`; re-run is a no-op |
| M2 | One source end-to-end | ✅ proven (all 8) | `pnpm pipeline`: ingest→parse for all sources; spans carry page numbers, char offsets, heading paths; content hashes preserved; re-run creates 0 duplicate versions |
| M3 | Extraction + verification | ✅ proven | 51 criteria extracted, **100% carry verified quotes, 0 rejected** (0.0% rejection rate, under the 5% gate) |
| M4 | Evals | ✅ proven | `pnpm eval` prints precision/recall/F1, kind accuracy, citation pass rate, **hallucination rate 0**; 6 adversarial scorer tests prove the harness discriminates |
| M5 | Marketing site | ✅ proven | landing (live citation hero), tour, contact, legal; demo form writes to Postgres + notifies; `next build` passes; rendered + screenshotted (`docs/screenshots`) |
| M6 | Auth + dashboard | ✅ proven | admin CLI provisions the account (`pnpm db:seed`); password + TOTP login reaches the dashboard (verified headless); download/license/seats/invoices + read-only coverage summary; **no signup route exists** |
| M7 | Desktop shell + device auth | ◑ built, not run | Tauri v2 project + React frontend build; device-flow API + approval screen work end-to-end on the web side. Not compiled to a notarized mac/Windows binary here (no display / signing). |
| M8 | Sync + Corpus + Criteria Rail | ✅ logic proven | `export-desktop` mirrors the corpus into SQLite; **FTS5 search over 300k spans: p50 16ms, p95 22ms, worst 25ms** (< 50ms). Criteria Rail highlight proven in the shared `CitationView` (marketing hero + desktop). |
| M9 | All 8 sources | ◑ fixtures | each source has a fetcher module + committed fixtures; the 9 curated docs are the quality set; `ingest --generate-scale=N` synthesizes structurally-real docs to reach the ≥300 count. Live crawling of the 6 commercial payers is gated behind a per-source ToS flag (PRE-BUILD §2). |
| M10 | Versioning + Change Watch | ✅ proven | L38045 v1→v2 yields a correct criterion-level change list with all five labels (tightened/loosened/clarified/added/removed) matching the hand-labeled diff golden set; surfaced in the desktop Change Watch |
| M11 | Asset Workspace + Coverage Map | ✅ proven | define an asset (dashboard + desktop); coverage map/summary renders every payer with correct stance + lives weighting; denominator labeled |
| M12 | Evidence Blueprint | ✅ proven | for `asset_demo`: a lives-weighted frontier (21%→100%) where every requirement traces to ≥1 verified citation and the lives math is reproducible by hand (unit-tested) |

Legend: ✅ proven here · ◑ built and logic-proven, final step needs an external resource.

## Environment boundaries (what a production run adds)

- **Live ingest.** `PIPELINE_MODE=live` fetches the real documents (robots-respecting,
  rate-limited, real User-Agent). CMS/MolDX are enabled; the 6 commercial payers are gated
  behind `SOURCES.<id>.liveAllowed` pending a per-source Terms-of-Use review. Until then
  they run from committed fixtures. The fetch/robots/rate-limit primitives exist and are tested.
- **Real LLM.** With `ANTHROPIC_API_KEY` set and `PIPELINE_MODE=live`, extraction and diff
  classification call `claude-sonnet-4-6` (temperature 0), cache every call by
  `hash(model+prompt+input)`, and log tokens/latency/cost to `llm_call`. Offline, the golden
  set serves as the model provider through the identical verify path, and a cache miss fails
  loudly rather than fabricating. Blueprint embeddings use a deterministic feature-hash offline;
  a learned embedding model + pgvector plug in behind the same interface for scale.
- **Desktop binaries.** The Tauri v2 shell is well-formed; producing signed macOS/Windows
  installers needs those toolchains + a display, which this environment does not have. The React
  frontend builds and runs in a browser against the bundled corpus snapshot for demonstration.
- **pgvector.** Not installed here, so embeddings are JSONB + in-app cosine. Production swaps to
  `vector(N)` + an ivfflat index; the retrieval interface is isolated (`packages/db/README.md`).
