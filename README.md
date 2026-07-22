# Strata

**A medical evidence engine that grades the strength of its own answers.**

Ask a clinical question. Strata searches real PubMed literature, places every
source on the evidence pyramid, appraises it against the GRADE domains, and gives
you an answer with an honest verdict on how strong the backing actually is. The
thing that makes AI dangerous in medicine is confident hallucination; Strata is
built to be the opposite. It never invents a fact — the answer comes only from
retrieved papers — and it tells you plainly when the evidence is weak, when the
papers disagree, and when one of them has been retracted.

```bash
pip install strata-evidence
strata ask "Does vitamin D supplementation prevent respiratory infections?"
```

```
Q  Does vitamin D supplementation prevent respiratory infections?
   [MODERATE CERTAINTY]
   1,284 PubMed hits · 24 appraised · 2 duplicates merged · 3.1s

Evidence verdict: moderate-certainty evidence — the strongest available is
systematic review / meta-analysis (3× randomised controlled trial, 2× systematic
review / meta-analysis, 1× cohort study).
  ! 1 retrieved paper has been retracted

Consensus: The weighted evidence consistently supports a benefit, across 8
graded papers.

Indicative pooling: RR 0.91 (95% CI 0.86–0.97) from 4 studies, I² = 34%,
excluding no effect.
  Not a systematic review — these are the papers one search returned, pooled
  for orientation only.

[1] Systematic review / meta-analysis · high certainty · 2021
    Vitamin D supplementation to prevent acute respiratory infections
    RR 0.92 (95% CI 0.86–0.99), p = 0.02 · n = 11,321 · reports prospective
    registration
    https://pubmed.ncbi.nlm.nih.gov/…

[2] Randomised controlled trial · moderate certainty · 2022
    ↓ risk of bias: no blinding or masking is described
    ...
```

Plus an evidence pyramid, a weighted consensus meter, and a forest plot — in the
terminal and in the browser.

---

## Why it's different

Most "medical AI" is a chatbot that will answer anything, confidently, from a
blur of training data. Strata inverts that:

- **Real sources only.** Every answer is anchored to specific PubMed papers with
  PMIDs and links. No paper, no claim.
- **Graded, not just cited.** A citation isn't evidence — a *good* citation is.
  Strata classifies each paper's design, places it on the pyramid, and applies
  the GRADE domains, so a single case report never gets to sound like settled
  science. Each adjustment is shown with its reason.
- **Honest about strength.** Every answer carries a computed certainty verdict,
  and the caveats that produced it: a body resting on one study, papers that
  contradict each other, heterogeneity too high to pool through.
- **Retraction-aware.** A retracted paper still has a readable abstract. Strata
  reads PubMed's retraction notices, drives those papers to the bottom, excludes
  them from every pooled estimate, and marks them — rather than quietly citing a
  withdrawn trial or quietly deleting it.
- **Disagreement is a finding.** When the literature conflicts, Strata says
  "mixed" and names the conflicting studies instead of averaging them into a
  reassuring sentence.

## The web app

```bash
strata serve      # http://127.0.0.1:8600
```

Ask in the browser and Strata renders the certainty verdict, the evidence
pyramid, a weighted consensus meter, an SVG forest plot of the reported effect
estimates, and the graded sources — strongest first, each showing what raised or
lowered its certainty and why. Progress streams as it works, because a real
question takes a few seconds and a silent spinner reads as a hang.

Light and dark, keyboard-driven (`/` to search), deep-linkable, and exportable to
Markdown, BibTeX or JSON. Standard library only; nothing is stored.

## Two answer modes

**Grounded digest (default — no model, no API key).** A structured summary built
only from the retrieved abstracts: verdict, consensus, indicative pooling, then
each source with its grade, its key finding and its GRADE adjustments.

**Synthesised narrative (bring your own model).** Pass any text-in/text-out
function as `generate`. Strata builds a prompt containing *only* the retrieved,
graded abstracts, tells the model what it already computed, and instructs it to
cite inline and admit uncertainty. If the model returns an answer with no
citations, or cites a source that was never provided, Strata says so above the
answer instead of passing it through.

```python
from strata import ask

r = ask("Does metformin reduce cardiovascular mortality in type 2 diabetes?")
r.body.overall_strength   # "moderate"
r.consensus.direction     # "supports" | "mixed" | "no_effect" | ...
r.pooled.format()         # "RR 0.88 (95% CI 0.79–0.98) from 5 studies, I² = 41%"
r.answer                  # grounded, cited digest

r = ask("…", generate=my_model)     # cited narrative, anchored to the same papers
```

## How the grading works

Papers are placed on a seven-level pyramid:

| Level | Design | GRADE starting certainty |
|--:|---|---|
| 1 | Systematic review / meta-analysis | high |
| 2 | Randomised controlled trial | high |
| 3 | Cohort study | low |
| 4 | Case-control / cross-sectional | low |
| 5 | Case report / series | very low |
| 6 | Narrative review / editorial / opinion | very low |
| 7 | Preclinical (animal / in vitro) | very low |

Level 7 is not part of the classical pyramid and is deliberate: a mouse study is
not weak clinical evidence, it is *not clinical evidence*, and folding it into
"expert opinion" loses that. Practice guidelines are a cross-cutting flag rather
than a level, since a guideline's authority comes from the evidence beneath it.

Certainty then moves, following GRADE, with every step recorded:

- **↓ risk of bias** — a trial that reports no blinding; an observational study
  with no adjustment for confounding; a review with no registered protocol
- **↓ imprecision** — a small sample, no sample size at all, or an interval that
  includes no effect
- **↑ large effect** — an observational study may earn a step back when the
  effect is large (ratio ≤ 0.5 or ≥ 2.0) and the interval excludes no effect
- **↓ retraction** — straight to the floor

At the level of the whole body of evidence, certainty drops again for resting on
a single study, for genuine disagreement between papers, and for heterogeneity
above I² = 75%.

## The neural layer

Two small networks read each abstract. They are written from scratch — forward
and backward passes by hand, Adam by hand, int8-quantised weights in the repo —
because Strata has no third-party dependencies. Two more were trained and
retired; the measurements that retired them are below, and their code is still
in the repository.

| Network | Task | Output |
|---|---|---|
| `design` | What kind of study is this? | 8 classes, calibrated confidence |
| `rigour` | Which safeguards are reported? | 6 independent labels |

Both share one architecture: hashed n-grams → embedding → attention pool ‖
mean pool → layer norm → MLP. The attention pool means **every prediction can
point at the words that produced it** — `strata ask --explain` and the web view
both quote them. Strata does not show a label it cannot justify.

```bash
strata nn predict "Participants were assigned by a computer-generated sequence…"
strata nn info            # what's trained, on what, and how well
strata nn eval --probes   # score the adversarial probe set
```

### Measured against the probes, not the corpus

| | Seed corpus (held out) | Adversarial probes |
|---|--:|--:|
| `design` | 1.000 macro-F1 | **82%** (18/22) |
| `rigour` | 0.995 macro-F1 | **F1 0.85** (P 0.81 / R 0.88) |
| stance *(retired)* | 0.94 macro-F1 | **36%** — see below |

The networks are an **upgrade to the rule-based grader, never a replacement.**
Where PubMed has tagged a paper's publication type — those tags are assigned by
NLM indexers — the rule wins, always. The network is consulted where PubMed is
silent, and only when it is confident. With no weights on disk, or with
`STRATA_NO_NN=1`, the whole pipeline still works.

### About the shipped weights — read this

The checkpoints committed to this repository are trained on a **synthetic seed
corpus**: abstracts composed from the reporting language the major guidelines
prescribe (CONSORT, PRISMA, STROBE, CARE, ARRIVE). It exists so a fresh clone
trains and runs without a network round-trip.

Their held-out scores are high — design reaches 1.000 macro-F1 — and **that
number describes the corpus, not PubMed.** Held out by topic, method template and
safeguard phrasing, it still measures a generator against itself. Treat it as a
sanity check that training works, not as a claim about real-world accuracy.

The honest signal is `strata nn eval --probes`: two dozen hand-written passages
where the surface vocabulary points at the wrong answer — a cohort study that
says "randomised" three times, a narrative review that discusses four RCTs, a
trial that never uses the word "randomised" at all.

For real supervision, retrain on PubMed's own indexer-assigned labels:

```bash
strata nn harvest --per-class 400     # real records, real PublicationType labels
strata nn train --source pubmed
```

Study design gets genuine supervision this way. Stance has no equivalent tag, so
harvested abstracts are weakly labelled by a conservative rule set that abstains
rather than guessing, and the network generalises past the rules' vocabulary —
that is the point of training one.

### The stance network that didn't survive measurement

Direction-of-finding drives the consensus meter, and it was originally a third
network. On held-out seed data it reached 0.94 macro-F1. On the adversarial
probes it scored **36%** — four classes, so barely above the 25% chance line. It
had learned the generator's phrasing, not the skill.

The rule set it was meant to replace scored **100% on the probes it fired on**,
and fired on only 3 of 22. Precise but nearly blind — and coverage is something
you fix by writing more patterns, whereas a model that has memorised a corpus is
not. So the rules were widened, given the reported confidence interval as a
second source, and measured again:

| Strategy | Coverage | Precision |
|---|--:|--:|
| rules only (original) | 14% | 100% |
| **rules + interval (shipped)** | **45%** | **90%** |
| rules + interval + network | 86% | 63% |
| network alone | 100% | 36% |

For a consensus meter, precision dominates: a wrong vote corrupts the direction
shown to a clinician, while an abstention only shrinks the sample — and Strata
already reports "insufficient evidence to judge a direction" honestly. So the
network was dropped and `strata/stance.py` ships instead. A paper whose direction
cannot be read confidently abstains, which is why the consensus count is usually
smaller than the number of sources.

The interval also gets a veto: `RR 0.94 (95% CI 0.87 to 1.01)` is a null result
however enthusiastically the conclusion is worded.

### What else isn't shipped, and why

A fourth model — a contrastive bi-encoder for question–abstract relevance — is
implemented, gradient-checked and left in the codebase, with **no trained
checkpoint**. On the seed corpus it overfits decisively: training loss reaches
~0.0005 while held-out recall@1 sits near chance. Relevance, for a
bag-of-n-grams model, is lexical overlap, and the embedding rows for a topic it
has never seen are still at their initialisation. Forty synthetic topics cannot
fix that.

Strata scores relevance with BM25 instead — no training, no failure mode that
depends on subject matter. The class and its docstring stay in the repo because
a negative result you can read is worth more than one you quietly delete.

Two of the four models Strata trained did not earn their place. Both are still
in the source with the measurements that retired them.

## Command line

```bash
strata ask "…"                       # graded answer, pyramid, consensus, forest plot
strata ask "…" --explain             # + the phrases the networks attended to
strata ask "…" --show-query          # + the parsed PICO and the PubMed query
strata ask "…" --design rct          # restrict to one level of the pyramid
strata ask "…" --years 5             # recent literature only
strata ask "…" --no-nn               # rule-based grading, for comparison
strata ask "…" --json | --markdown | --bibtex
strata ask "…" --model mypkg:generate

strata compare metformin sulfonylurea --outcome "cardiovascular mortality"
strata serve
strata cache info | prune | clear
```

`compare` reports which intervention has the stronger *evidence base*. It
deliberately does not produce a head-to-head effect estimate: comparing one set
of trials against a different set is an indirect comparison, and doing it naively
concludes that whichever drug was studied in sicker patients is the worse drug.

## How a question becomes a search

A question sent verbatim to PubMed matches "does" as hard as "metformin". Strata
parses it into PICO and builds a real boolean query with field tags and a curated
synonym expansion:

```
Does metformin reduce cardiovascular mortality in type 2 diabetes?
  → P: type 2 diabetes · I: metformin · O: cardiovascular mortality
  → ("metformin"[tiab]) AND ("cardiovascular mortality"[tiab] OR "death"[tiab]
     OR "survival"[tiab]) AND (("type 2 diabetes"[tiab] OR
     "diabetes mellitus"[tiab])) AND hasabstract
```

If the precise query comes back thin, Strata broadens once and says so — an empty
result caused by an over-specific query and an empty result caused by an empty
literature look identical to a user and mean completely different things.

## Behind a school or corporate network?

If you see `CERTIFICATE_VERIFY_FAILED`, your network is intercepting HTTPS with
its own certificate. Strata already trusts the operating-system certificate
store, which usually fixes it. If it persists:

- run it on a normal network (home Wi-Fi or a phone hotspot), **or**
- point it at your network's certificate: `set STRATA_CA_BUNDLE=C:\path\to\ca.pem`, **or**
- as a last resort on a network you trust, `set STRATA_INSECURE=1` to skip
  verification. It only reads public data — but it is off by default for a
  reason, and it applies to certificate errors only.

## Configuration

| Variable | Effect |
|---|---|
| `NCBI_API_KEY` | Raises the rate limit from 3 to 10 requests/second |
| `NCBI_EMAIL` | Sent with requests, per NCBI's guidance for heavy use |
| `STRATA_CACHE_DIR` | Where PubMed responses are cached |
| `STRATA_NO_CACHE=1` | Disable the cache |
| `STRATA_OFFLINE=1` | Cache only; never touch the network |
| `STRATA_NO_NN=1` | Rule-based grading only |
| `STRATA_CA_BUNDLE` | Explicit CA bundle for TLS |
| `STRATA_INSECURE=1` | Skip TLS verification (certificate errors only) |
| `STRATA_DEBUG=1` | Full tracebacks instead of one-line errors |

## Data & privacy

Strata reads the public [NCBI E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/)
API — open bibliographic data. It handles **no patient data**, keeps no query
log, and needs no account. The only thing written to disk is a cache of PubMed
responses, which you can inspect or delete with `strata cache`.

The web server binds to loopback and has no authentication; it refuses to bind
any other address without `--allow-remote`.

It is a research and reference tool for professionals. It does not diagnose,
treat, or give personalised medical advice.

## Development

```bash
python tests/test_nn.py        # gradient checks against finite differences
python tests/test_strata.py    # the pipeline, with PubMed mocked
python tests/test_stats.py     # effect extraction and meta-analysis
strata nn eval --probes        # the adversarial probe set
```

No dependencies, no build step, no network needed for the tests. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit together
and [`docs/EVIDENCE.md`](docs/EVIDENCE.md) for the grading rules in full.

## License

MIT © 2026 Neil Gilani
