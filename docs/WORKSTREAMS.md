# Workstreams

Directory-level ownership for parallel sessions. One owner per path. If your
task needs a file outside your paths, stop and report it instead of editing.

Status as of the current working tree, which has ~47 uncommitted new files from
a session that is still running.

---

## Claimed — do not touch

### W1 · Appraisal engine
**Owns** `strata/appraisal/`, `strata/appraise/`, `strata/appraisal.py`,
`strata/rob.py`
**State** In flight, actively being written. Four competing implementations of
the same four instruments (RoB 2, ROBINS-I, AMSTAR-2, QUADAS-2) currently exist
across these paths. `appraisal.py` is already shadowed by `appraisal/` and is
dead code.
**First job on resume** Collapse to one package. Keep the implementation with
the best evidence-quoting and the honest "no information" default; delete the
rest in a single commit that says which was kept and why.

### W2 · Service layer
**Owns** `strata/api/`
**State** In flight. `auth`, `errors`, `jobs`, `ratelimit`, `store`, `webhooks`
exist; no router or OpenAPI document yet.

### W3 · Reporting
**Owns** `strata/reporting/`, `strata/reporting.py`, `strata/report.py`,
`strata/sof.py`, `strata/profile.py`, `strata/prisma.py`, `strata/ui.py`,
`strata/server.py`
**State** In flight. `reporting.py` is shadowed by `reporting/`. `sof.py` and
`profile.py` are two takes on the GRADE evidence profile.

### W4 · Meta-analysis
**Owns** `strata/meta/`, `strata/meta.py`, `strata/metaanalysis.py`,
`strata/stats.py`, `strata/distributions.py`
**State** Written, not currently active. Three implementations: `meta.py` (30 KB,
shadowed and dead), `meta/` (7 modules), `metaanalysis.py` (70 KB). The `meta/`
package is the only one that can be imported under its own name.

### W5 · External sources
**Owns** `strata/sources/`
**State** Written, not currently active. ClinicalTrials.gov, Europe PMC, openFDA,
registry linkage.

### W6 · Provenance
**Owns** `strata/provenance.py`, `strata/audit.py`, `strata/fhir.py`,
`strata/surveillance.py`, `strata/screening.py`
**State** Written, not currently active.

---

## Unclaimed — safe to start now

These touch no path above. They can run concurrently with everything else and
with each other, today, without a collision.

### W7 · Validation harness and gold-standard corpus
**Owns** `benchmarks/` (new), `tests/test_validation.py`
**Depends on** nothing — it consumes the appraisal API through a thin adapter it
owns, so churn in W1 cannot break it.

The single highest-value unclaimed item. Every claim this repo makes about
appraisal accuracy is currently unmeasured: the README's honest reporting of the
`design` and `rigour` networks against adversarial probes is exactly the right
pattern, and the risk-of-bias instruments have no equivalent.

Build:
1. `benchmarks/corpus/rob2.jsonl` — hand-labelled abstracts with a reference
   judgement per domain, each label carrying the quoted span that justifies it
   and the initials of who assigned it. Start at 40 and grow. Include the hard
   cases deliberately: a cohort study that says "randomised" three times, a
   registry study with impeccable adjustment, an RCT whose abstract omits every
   method, a retracted trial.
2. `benchmarks/run.py` — score any appraisal implementation against it. Report
   per-domain agreement, Cohen's κ against the reference labels, and the
   confusion between "no information" and a real judgement, which is the error
   that matters most here.
3. A results table in `docs/VALIDATION.md`, written in the README's voice:
   report what the measurement says even when it is unflattering, as the stance
   network's retirement was reported.

κ against human dual review is the number a buyer's methodologist asks for
first. Nothing else on this list changes the commercial position as much.

### W8 · Offline fixtures and deterministic replay
**Owns** `tests/fixtures/` (new), `tests/test_replay.py`
Capture real E-utilities XML responses for a fixed set of ~20 clinical questions
and replay them through `ask()` with the network disabled, asserting the full
result is byte-identical. This is what makes every other test trustworthy and
what makes a regression in ranking or grading visible instead of silent. The
existing suite mocks PubMed per-test; this fixes a corpus once and pins the
whole pipeline against it.

### W9 · Methods specification
**Owns** `docs/METHODS.md`, `docs/EVIDENCE.md`
Write the specification a methodologist would review before signing off: every
grading rule, every threshold and where it comes from, every place the
implementation departs from the published instrument and why. `docs/EVIDENCE.md`
covers the GRADE rules already — extend rather than replace it. Cite the primary
sources (Sterne 2019, Sterne 2016, Shea 2017, Whiting 2011, the GRADE handbook)
with enough precision that a reader can check a rule against its origin.

No code. Read `strata/evidence.py`, `strata/stance.py`, `strata/ranking.py` and
describe what is actually implemented — not what the docstrings aspire to.

### W10 · Neural layer supervision
**Owns** `strata/nn/`
Currently trained on a synthetic seed corpus, which the README is candid about:
1.000 macro-F1 on held-out seed data, 82% on adversarial probes. Harvest real
PubMed records with indexer-assigned `PublicationType` labels, retrain `design`
on genuine supervision, and report both numbers. Extend the probe set — 22 items
is too few to distinguish 82% from 70%.

Self-contained: nothing outside `strata/nn/` needs to change.

---

## Sequencing

W7, W8, W9 and W10 can start immediately and in parallel.

W1–W6 each need their duplicate cluster collapsed before anything is built on
top. That reconciliation is the owner's first commit, not a separate workstream —
splitting it out would mean two sessions editing one tree, which is the problem
rather than the fix.
