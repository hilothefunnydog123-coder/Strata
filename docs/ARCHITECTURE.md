# Architecture

Strata is a pipeline, not a model. A question goes in, a graded and appraised
body of evidence comes out, and every stage records enough about what it did that
the answer can be taken apart afterwards.

```
question
   │
   ├─ pico.parse ─────────── PICO parts + a real boolean PubMed query
   │
   ├─ pubmed.search ──────── esearch → efetch, through cache + rate limiter
   │      └─ retry once with pico.broaden if the result came back thin
   │
   ├─ ranking.deduplicate ── same DOI, or near-identical text
   │
   ├─ evidence.grade ─────── per paper:
   │      ├─ classify        rules (PubMed publication types) ▸ design network
   │      ├─ sample_size     largest plausible participant count
   │      ├─ stats.extract   effect size, interval, p-value
   │      ├─ nn.rigour       which safeguards the methods report
   │      ├─ stance.infer    direction of the finding (rules + interval, abstains)
   │      └─ GRADE domains   risk of bias, imprecision, indirectness, upgrades
   │
   ├─ query.rank ─────────── evidence ‖ BM25 relevance ‖ recency ‖ rigour
   │
   ├─ consensus.assess ───── quality-weighted vote, conflict detection
   ├─ stats.pool ─────────── DerSimonian-Laird, excluding retracted papers
   ├─ evidence.summarize ─── body-level certainty and its caveats
   │
   └─ synthesize ────────── digest (no model) or narrative (your model)
```

## Modules

| Module | Responsibility |
|---|---|
| `pico.py` | Question → PICO → boolean query, with curated synonym expansion |
| `net.py` | HTTP: rate limiting, retries with backoff, TLS on managed networks |
| `cache.py` | On-disk cache of PubMed responses; atomic writes, TTL |
| `pubmed.py` | E-utilities client and the XML parser (MeSH, DOI, retractions, COI) |
| `stats.py` | Effect-size extraction, random-effects meta-analysis, chi-square tail |
| `ranking.py` | BM25, near-duplicate detection, the composite score |
| `evidence.py` | The pyramid, GRADE domains, per-paper and body-level grading |
| `stance.py` | Direction of a finding: conclusion cues + interval veto |
| `consensus.py` | Quality-weighted agreement, conflict detection, timeline |
| `synthesize.py` | The grounded digest and the model prompt |
| `query.py` | The pipeline itself, plus `compare` |
| `report.py` | Terminal rendering, including the ASCII forest plot |
| `ui.py` / `server.py` | The single-page app and its routes |
| `nn/` | The neural layer (see below) |

Dependency direction is strictly downward: `query` knows about `evidence`,
`evidence` knows about `stats`, and nothing knows about `report` or `server`.
The neural layer is imported lazily and behind `try/except` everywhere, so a
missing or corrupt checkpoint degrades to rule-based grading rather than
breaking a clinical question.

## The neural layer

```
nn/
  linalg.py    dense primitives; no broadcasting, no autograd
  text.py      tokenizer, stable CRC32 hashing, span tracking
  modules.py   Embedding, AttentionPool, MeanPool, LayerNorm, Linear, GELU, Dropout
  losses.py    cross-entropy (+smoothing, class weights), BCE, InfoNCE
  optim.py     Adam with per-row sparse state, clipping, warmup-cosine
  model.py     TextClassifier, MultiLabelClassifier, BiEncoder, calibration
  store.py     row-wise int8 quantisation → zlib → base64 → JSON
  corpus.py    the seed generator and the PubMed harvester
  train.py     training loops, metrics, threshold fitting
  probes.py    hand-written adversarial cases
  build.py     orchestration for `strata nn train`
```

### Why it's written from scratch

Strata has no third-party dependencies, and that constraint is worth keeping: a
tool a clinician can `pip install` on a locked-down hospital machine, with no
compiled wheels and no supply chain, is more useful than one that needs a 300 MB
tensor library to decide whether an abstract describes a cohort study.

The models are small enough that this is reasonable. Each is ~267k parameters,
trains in two to four minutes on one CPU core, and ships as a 378 KB checkpoint.

### The shared trunk

```
hashed n-grams ─→ Embedding(8192 × 32)
                     │
                     ├─→ AttentionPool  ─┐
                     │                    ├─→ concat(64) → LayerNorm → head
                     └─→ MeanPool       ─┘
```

Attention pooling gives the *focus*; mean pooling gives the *impression of the
whole document*. Attention alone failed on a specific case: one phrase like "we
randomly assigned" would swamp an abstract that is otherwise plainly a
retrospective chart review, because nothing in the pooled vector remembered the
rest of the text.

The attention weights are the explanation. Every feature carries the character
span it came from, so a prediction can be turned back into quoted phrases —
`strata ask --explain`, and the "network attended to" line in the web view.

### No autograd

Each module implements `forward` and `backward` by hand. A scalar-graph
autodiff in pure Python would be roughly two orders of magnitude slower, and the
handful of derivations fit in one readable file. The contract is `tests/test_nn.py`, which
checks every parameter of every module against central finite differences.

### Three things the trainer does that a quick script would not

**Topic-, template- and phrasing-disjoint validation.** Validation holds out
whole clinical topics, whole method templates, *and* whole safeguard phrasings.
The first version used a random split, reported 1.000, and the number meant
nothing.

**Calibration after fitting.** Weights are frozen, then one temperature is fitted
on the validation logits by golden-section search on NLL. Strata prints
confidence to a clinician; an uncalibrated softmax peak is not a probability.

**Quantised evaluation.** Final metrics are computed after the int8 round-trip
that `store.py` performs on save, so the numbers in a checkpoint's metadata
describe the file that actually ships.

## Two models were retired by measurement

`nn/model.py` still contains `BiEncoder`, and `strata nn train --only stance`
still trains a stance classifier. Neither ships, and neither is called.

| | Held-out corpus | Adversarial probes | Replaced by |
|---|--:|--:|---|
| stance classifier | 0.94 macro-F1 | 36% | `stance.py` rules — 90% precision |
| relevance bi-encoder | loss → 0.0005 | recall@1 ≈ chance | BM25 in `ranking.py` |

Both are kept in the source with the numbers that retired them, because a
negative result you can read is worth more than one quietly deleted — and
because `--source pubmed` may change the picture for either.

## Two evaluations, and why both exist

`strata nn eval` scores the checkpoints on freshly generated held-out seed data.
It answers "did training work?" and the numbers are high.

`strata nn eval --probes` scores them on two dozen hand-written passages where
the surface vocabulary points at the wrong answer. It answers "does this
generalise?" and the numbers are considerably lower — which is the useful
information. The gap between the two is the honest measure of how much the seed
corpus flatters the models.

## Failure behaviour

Every stage is written so that failing produces a worse answer rather than no
answer:

- No weights on disk, or `STRATA_NO_NN=1` → rule-based grading, full pipeline
- A direction that cannot be read → the paper abstains from the consensus vote
- Too few studies, or mixed measures → `pool()` returns `None` rather than an estimate
- No interval reported → the paper is listed but not drawn on the forest plot
- A thin search → broadened once, and the fact is reported
- A model that returns no citations → flagged above the answer
- A model that raises → the grounded digest, with the failure stated
- Network unreachable → one sentence explaining what to do, not a traceback

## Threading

`strata serve` uses `ThreadingHTTPServer`. The PubMed rate limiter is
process-wide and lock-guarded, so four browser tabs cannot between them exceed
NCBI's limit. The SSE endpoint runs the pipeline on a worker thread and streams
stage events through a `queue.Queue`; a client that navigates away leaves a
daemon thread to finish and be collected.

Nothing is stored beyond the response cache, and no query is logged.
