# Golden sets (PROMPT §9)

Hand-labeled ground truth, authored against the parsed spans so every
`verbatimQuote` is an exact substring (it verifies).

- **`extraction.json`** — for spans across all 8 payers: the criteria that SHOULD
  be extracted (kind, subject, minimal verbatim quote, evidence facets) and the
  coverage stances, plus explicit negative examples (background/definition spans
  labeled with empty `criteria`) to test that the extractor does not over-extract.
  This file doubles as the offline model provider: in `PIPELINE_MODE=fixture` the
  extractor returns these labels and runs them through the SAME verify step a live
  model response would take, so the citation invariant is exercised identically.

- **`diff.json`** — the tightened/loosened/clarified labels for the L38045 v1→v2
  revision (added/removed are structural). Used by the diff classifier's own golden set.

`pnpm eval` scores extraction (precision/recall/F1, kind accuracy, citation pass
rate, hallucination rate — which must be 0) and the diff classifier against these.
