# Fixtures — committed raw snapshots for offline dev

`PIPELINE_MODE=fixture` (the default) runs the entire pipeline against these files
with **zero network calls** (PROMPT §10). The ingest fetchers read from here
instead of the live sources.

## Important: these are faithful *reconstructions*, not verbatim copies

This build runs in an environment with no crawl access to payer sites, and several
commercial payers' Terms of Use restrict reproduction of their policy text. So the
HTML here is **original prose written in the real structural style** of each
source (MolDX LCD, Aetna CPB, CMS NCD, commercial medical policies) — same section
skeletons, same evidence language, realistic codes and effective dates — but not a
copy of any real document. CMS material is modeled on public-domain government works.

This lets the pipeline, the golden set, and the evals run deterministically offline.
In `PIPELINE_MODE=live` the same fetchers retrieve the **real** documents (robots-
respecting, rate-limited) and everything downstream is unchanged. See `docs/STATUS.md`.

## Layout

- `manifest.json` — every document: payer, external id, version, title, url, effective
  date, file, `supersedesFile`, and the codes it covers/excludes/mentions.
- `payers.json`, `covered-lives.json` — the 8 v0 payers and hand-curated covered
  lives (each row with a `source_url`), used for lives weighting.
- `codes.json` — CPT/PLA/HCPCS codes referenced by the corpus.
- `<source>/*.html` — the raw snapshots. `moldx/L38045-v1` and `-v2` are two
  versions of one LCD, for the diff/versioning tests.

## Scaling the corpus

The 9 curated documents are the *quality* set (rich enough to hand-label 50 golden
spans across 5+ payers). `pnpm ingest --generate-scale=N` synthesizes additional
structurally-real documents to reach corpus scale for search/versioning tests; those
are clearly marked `synthetic-scale` and never enter the golden set.
