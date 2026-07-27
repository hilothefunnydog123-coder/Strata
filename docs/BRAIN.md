# The brain — extraction without a language model

Assent extracts requirements with a **locally-trained neural network**, not an LLM.
No API key, no network call, no per-document inference cost. `packages/brain`.

## Why this is the right architecture here, not just the cheaper one

The product's hard promise is that **no claim exists without a verbatim source quote**.

A generative model *writes* text, so it can emit a quote that is not in the document.
That is why the LLM design needed `verifyQuote()` as a gate afterwards, and why the
hallucination rate had to be watched like a hawk.

This classifier never writes anything. It **scores candidate clauses that were cut out
of the stored document**, so the quote is literally `span.text.slice(start, end)`.

> Fabrication is not filtered. It is **structurally impossible**.

The worst thing the model can do is surface a sentence that is not actually binding —
visible to the user in one click, and harmless. It can never assert a requirement that
exists in no document. For a $40M trial decision that is a materially better failure mode,
and it is the reason a small model beats a large one for this specific job.

Medicine mostly does not run on LLMs for exactly this reason: an auditable model whose
errors are bounded and inspectable beats a fluent one whose errors are unbounded.

## The pipeline

```
document span
  → segment()     clause-level candidates, exact char offsets, list stems dropped
  → featurize()   512 hashed lexical dims  +  60 engineered domain features
  → Mlp           572 → 96 → 48 → 13   (ReLU, dropout 0.25, softmax)
  → threshold     abstain below the calibrated confidence floor
  → Criterion     verbatimQuote = span.text.slice(start, end)
```

**The network** (`src/nn.ts`) is written from scratch: dense layers with He init, ReLU,
inverted dropout, softmax + cross-entropy, backpropagation, and Adam with decoupled L2.
It is deterministic given a seed and ships as a ~1.2 MB JSON weight file.

**The features** (`src/features.ts`) are where the domain lives: deontic cues (*must*,
*shall*, *is required*), coverage-positive and coverage-negative formulas, evidence and
study-design vocabulary, the AV/CV/CU triad, frequency/ordering/documentation/exclusion
cues, section-heading priors (text under *Background* is almost never a requirement),
and structural signals. Policy prose is highly conventionalized, which is exactly why a
compact feature-based classifier can do this well.

**Precision-first** (`src/train.ts`): the product tolerates a missed requirement far
better than an invented one, so the confidence floor is chosen as the lowest threshold
that still meets a precision target, and the model abstains below it.

## Honest evaluation

Training data is **annotated policy sentences** (`data/training.json` + hard negatives).
The corpus documents are the **test set** and no corpus sentence appears in training.

The threshold is calibrated on **two payers**, and metrics are reported on the **six
payers the model has never seen in training or calibration**:

| Held-out (6 unseen payers) | |
|---|---|
| detection precision | **85.7%** |
| detection recall | **100%** |
| kind accuracy | **88.9%** |

Against the full hand-labeled golden set (`pnpm eval`):

| | |
|---|---|
| precision / recall / F1 | 74.1% / 84.3% / 78.9% |
| kind accuracy | 93.0% |
| **hallucination rate** | **0%** (structural) |
| citation pass rate | 100% |
| quote tightness | 53.6% |

**Quote tightness** is the honest weak spot: the classifier returns the whole clause it
scored, which averages about twice the length of the minimal hand-picked quote. The
citation is always correct and always real — it is just wider than it needs to be.
Tightening it is a bounded, well-understood piece of work (score sub-spans within the
winning clause).

### A leak I found and removed

An earlier version of the hard negatives copied sentences near-verbatim from corpus
documents, **including test payers**. That is training on the test set, and it inflates
every number. The file was rewritten so each entry teaches the *pattern* — scope
lead-ins, list stems, qualifier sentences, and payer stance sentences — using different
services, diseases and payers than anything in `fixtures/`. The rule is recorded in the
data file itself so the next annotator does not reintroduce it.

## Also not an LLM

- **Stance detection** (`src/stance.ts`) — high-precision rules over the closed set of
  formulas payers use ("considers X medically necessary", "experimental and
  investigational"), returning exact offsets. A stance is a `CoverageStance`, never a
  `Criterion`, and the classifier is trained to label those sentences `none` so the two
  never double-count.
- **Diff classification** (`packages/extract/src/diff.ts`) — a transparent
  restrictiveness score. Numeric thresholds are compared directly; otherwise weighted
  cues for obligation, evidence strength, permission and sufficiency decide
  tightened / loosened / clarified, and the rationale names the cues that moved it, so a
  reviewer can audit the call against the two quotes. It scores 100% on the hand-labeled
  diff golden set.

## Retraining

```bash
pnpm --filter @assent/brain train
```

Reports validation, calibration and held-out metrics, then writes `model/model.json`.
Add annotated sentences to `data/training.json` and re-run — more labeled data is exactly
what this architecture wants, and it is the cheapest lever on quality.
