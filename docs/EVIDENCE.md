# How Strata grades evidence

Every rule here is a transparent heuristic applied to a paper's abstract and its
PubMed metadata. It is a reading aid, not an appraisal by a human, and it is
certainly not medical advice. What follows is the complete set of rules, so you
can decide whether you agree with them.

## The pyramid

| Level | Design | GRADE starting certainty |
|--:|---|---|
| 1 | Systematic review / meta-analysis | high |
| 2 | Randomised controlled trial | high |
| 3 | Cohort study | low |
| 4 | Case-control / cross-sectional | low |
| 5 | Case report / series | very low |
| 6 | Narrative review / editorial / opinion | very low |
| 7 | Preclinical (animal / in vitro) | very low |

Two departures from the textbook pyramid, both deliberate:

**Level 7 exists.** A mouse study is not weak clinical evidence — it is not
clinical evidence. Folding it into "expert opinion" loses a distinction that
matters when someone is deciding whether a mechanism has ever been tested in
people.

**Guidelines are a flag, not a level.** A practice guideline's authority comes
from the evidence beneath it, and guidelines vary enormously in how much of that
there is. Strata marks them and grades them on their own reported methods.

## How a paper is classified

1. **A decisive PubMed publication type wins, always.** `Meta-Analysis`,
   `Systematic Review`, `Randomized Controlled Trial`, `Controlled Clinical
   Trial`, `Case Reports` and their relatives are assigned by NLM indexers who
   read the full text. The network has no information they lacked.
2. **Then title patterns** — "a systematic review of…", "…: a cohort study",
   "in a murine model".
3. **Then the design network**, but only where PubMed is silent or merely
   suggestive (`Review`, `Observational Study`), and only when the network is
   confident (≥ 55% and a ≥ 0.15 margin over the runner-up).
4. **Otherwise the rule's answer stands**, at reduced confidence.

Every grade records which route decided it, in `grade.classified_by`. On the
adversarial probes the design network gets 18 of 22 — the errors cluster where
the designs genuinely overlap, mostly case-control versus cross-sectional.

## Moving the certainty

Certainty starts where the design puts it and moves. Every step is recorded as a
`Domain` with its reason, and both the terminal and web views show them.

### Downgrades

**Risk of bias**
- A trial (level 2) that describes no blinding or masking → −1
- An observational study (levels 3–4) with no adjustment for confounding → −1
- A review (level 1) with no prospective protocol registration → −1

**Imprecision** (levels 1–4 only)
- Fewer than 100 participants → −1
- No sample size reported at all → −1
- A confidence interval that includes no effect → −1

**Indirectness**
- Preclinical work is recorded as very serious indirectness. It does not
  subtract further, because level 7 already starts at the floor.

**Retraction**
- A retracted paper goes straight to "very low", regardless of design.

### Upgrades

GRADE permits raising certainty for observational evidence when the effect is
large. Strata applies this to levels 3–4 when the measure is a ratio, the
interval excludes no effect, and the estimate is ≤ 0.5 or ≥ 2.0 → +1. This is how
a large, well-adjusted cohort earns back the step its design cost it.

## Whether the safeguards are there

Six methodological safeguards are read out of the methods text by a small
network: random allocation, blinding, prospective registration, intention-to-treat
analysis, an a priori power calculation, and adjustment for confounding.

Each has its own decision threshold, fitted on held-out data by maximising
**F-0.5** rather than F1 and floored at 0.35. Precision is weighted above recall
because Strata renders a safeguard as a positive claim about a paper — "✓
blinded" — and crediting a study with rigour it never reported is a worse error
than staying quiet about rigour it did.

On the adversarial probes this reads at precision 0.81 / recall 0.88.

## The body of evidence

The verdict for the answer as a whole starts from the **best available design**
and its post-GRADE certainty, then drops again for what only becomes visible
across several papers:

- **A single study at the top level** → −1. One trial is not a literature.
- **Genuine disagreement** (disagreement index ≥ 0.5) → −1.
- **Considerable heterogeneity** (I² ≥ 75% among poolable studies) → −1.

Each triggered rule appears as a caveat in the output. Retracted papers among the
results are always reported as a caveat, whether or not they changed the grade.

## Consensus

A count of papers is not a consensus. Six case reports pointing one way and one
large trial pointing the other is not "six to one". Each paper's vote is weighted:

```
weight = level_weight × certainty_weight × (0.55 + 0.45 × stance_confidence)
```

| Level | Weight | | Certainty | Weight |
|--:|--:|---|---|--:|
| 1 | 1.00 | | high | 1.00 |
| 2 | 0.90 | | moderate | 0.65 |
| 3 | 0.55 | | low | 0.35 |
| 4 | 0.40 | | very low | 0.15 |
| 5 | 0.15 | | | |
| 6 | 0.10 | | | |
| 7 | 0.08 | | | |

A retracted paper weighs **zero** — it does not get a vote. A paper whose
direction cannot be read confidently abstains entirely rather than voting weakly.

Direction comes from `strata/stance.py`, which is rules plus the confidence
interval, not a network. On the adversarial probes it covers 45% of papers at
90% precision; the stance network it replaced labelled every paper and got 36%
right. For a consensus meter, precision dominates — a wrong vote corrupts the
direction shown to a clinician, an abstention only shrinks the sample. Roughly
half of abstracts therefore do not vote, which is why the consensus count is
smaller than the source count.

Two sources feed it. The **conclusion** supplies direction, because only the
prose knows whether a lower number is good news. The **interval** supplies a
veto: an estimate whose 95% CI spans the null is a null result however the
conclusion is worded, and `RR 0.94 (95% CI 0.87 to 1.01)` is recorded as "no
effect" even when the abstract says "significantly reduced".

Agreement is measured across the **directional** claims only — "supports" versus
"against". A study that found no effect is not disagreeing with one that found
benefit in the way a study finding harm is, and averaging all four categories
together understates real conflict.

When substantial weight sits on both sides (agreement < 68% with more than 0.08
weight opposing), the direction is reported as **mixed** and the conflicting
studies are named. Disagreement is a finding, not noise to be averaged away.

## Pooling

Where three or more retrieved papers report the same measure with a confidence
interval, Strata computes a DerSimonian-Laird random-effects estimate, with I²,
tau², Cochran's Q and its p-value.

Four rules keep this honest:

1. **Only stated intervals.** Nothing is imputed from a p-value or a bare
   percentage. A paper without an interval contributes to the picture but not to
   the pool.
2. **One measure at a time.** Risk ratios are never blended with odds ratios or
   hazard ratios. The most common measure in the result set wins; the rest are
   excluded, not averaged in.
3. **Retracted papers are excluded** from the arithmetic, while remaining visible
   on the forest plot, marked.
4. **It is labelled "indicative pooling" everywhere.** Papers found by one
   keyword search are not a systematic review: no protocol, no duplicate
   screening, no grey literature, no assessment of publication bias. It is an
   orientation aid.

Random effects rather than fixed, because retrieved papers differ in population,
dose and follow-up, and assuming they share one true effect is indefensible.

## Direction is about the null, not about benefit

An effect size's `direction` says whether the estimate is above, below or at the
null — never whether that is good news. Whether a risk ratio below 1 is a benefit
depends on whether the outcome is death or recovery, and nothing in the number
says which. Benefit and harm come from the stance network, which reads the
conclusion. Conflating the two is how a tool ends up reporting that a drug
prevents the disease it causes.

## What this does not do

- It reads abstracts, not full texts. A trial whose abstract omits its blinding
  will be marked down for it.
- It does not assess publication bias, allocation-concealment adequacy, or
  selective outcome reporting — these need the protocol and the full paper.
- It does not weigh a study's applicability to your patient.
- It is not a systematic review and does not substitute for one.
- It does not give medical advice.

The grading is transparent so that you can disagree with it. When you do, the
paper is one click away.
