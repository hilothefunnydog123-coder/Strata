# Strata — the verification layer for medical AI

*The canonical strategy. It refines the earlier "evidence engine" framing ([`vision.md`](vision.md))
into something sharper, more B2B, and genuinely in whitespace: don't build an AI medical
research assistant — build the layer that verifies what every other medical AI says.*

## The one-line thesis

**The future will have more medical AI than humans can manually verify. Every medical AI
system will need an independent way to answer one question: "Why should anyone trust this
claim?"** If Strata becomes the default answer, it isn't another medical chatbot — it's the
trust infrastructure of AI-powered medicine.

## The simple explanation (for anyone)

Strata checks whether an AI's medical claims are actually supported by science.

- Antivirus checks whether software is dangerous. **Strata checks whether medical AI claims
  are supported by evidence.**
- Stripe processes payments. **Strata processes medical evidence.**

## The whitespace

Medicine is about to run thousands of AI systems — AI doctors, radiologists, drug-discovery
agents, trial assistants, scribes, patient bots, research agents. All of them emit claims
like *"this treatment is effective for this population."* And the obvious question — **who
verifies that claim?** — has no owner.

Today companies build **AI → answer**. The future needs **AI → answer → independent evidence
verification.** The incumbents don't fill this: reference tools are human-curated and not
living; systematic-review software stops at a static document; the LLM wave answers fluently
but can't be audited. Nobody owns *continuously-graded, always-current, claim-level
verification*. That is the category to create — **medical evidence infrastructure** — and its
categories (AI medical search, medical chatbot, research assistant, SLR software) are all
crowded while this one is empty.

## Reverse the product

The current instinct is: a human asks Strata a question. **Reverse it.** The primary customer
is *another medical AI company*. Their system generates a claim; Strata returns a structured
verdict:

```
Claim:  "Drug X reduces hospitalization in patients with heart failure."

Evidence status:     Supported
Evidence strength:   Moderate
Supporting:          7 studies      Contradicting: 2 studies
Highest-quality:     1 meta-analysis, 1 RCT
Last evidence change: 14 days ago
Key limitation:      Evidence does not generalize to patients over 80.
Citations:           every claim traceable to a paper.
```

The AI company can then show: *"independently evidence-verified by Strata."* That is the
product — sold as an API, not a chatbot.

## Three layers

1. **Strata Verify — the API.** Medical AI in → claim → evidence graph → support / contradiction
   / certainty → verified answer out. The highest-margin product: software, usage-priced
   ($0.01–$1 per verified claim), no human in the loop per customer, potentially enormous scale.
2. **Strata Monitor — the dashboard.** For pharma, hospitals, payers, CROs, and AI companies
   watching thousands of claims about their products. It answers *"what changed in the evidence
   about our products?"* — new papers, new trials, contradictions, safety signals, quality
   shifts, guideline changes. Enterprise: $100k–$1M+ per therapeutic area per year.
3. **Strata Seal — the trust mark.** An embeddable *"Evidence Verified by Strata"* badge — not
   "this is true" but "the evidence behind this claim has been independently checked and graded."
   Like SSL, SOC 2, or "Verified by Visa." The dream: buyers start asking *"Is it
   Strata-verified?"* — which is how you become infrastructure.

## The Evidence Receipt

Every check yields a standardized, portable receipt: claim, status, strength, supporting vs.
contradicting counts, the strongest study, the key limitation, citations, last-checked, and
whether the evidence changed. Simple surface, sophisticated backend — a person reads it, a
hospital sees the value, an AI company embeds it.

## The obsession: *what changed*

An AI answer is only as good as its freshness. Most systems answer "what's true now?"; the
valuable question is **"tell me the moment it changes."** Monday: moderate evidence. A new
Phase III trial lands Thursday. Friday, Strata pushes: *certainty upgraded, moderate → high* —
or *downgraded* when a study contradicts. Watching the world's medical knowledge for the
changes that matter is what turns a report into living infrastructure, and it's hard to build
well — which is the point.

## The moat: a claim-level medical evidence graph

Not a generic knowledge graph — a graph at **claim-level granularity**:

```
CLAIM → DISEASE → TREATMENT → POPULATION → OUTCOME → STUDY → EVIDENCE QUALITY → CONTRADICTIONS → TIME
```

Not "this paper is relevant" but "*this exact claim* is supported by *these exact* pieces of
evidence, in *these* populations, measured on *these* outcomes, at *this* quality, and here is
how the conclusion changed over time." That specificity is the compounding asset.

## Why the margins are enormous

The core is software and automated computation. Usage-priced API for AI companies; six- to
seven-figure enterprise monitoring for pharma/hospitals; seven-figure org-wide platform deals.
Gross margins are software margins minus inference and (eventually) licensed full text.

## What to emphasize — and drop

**Emphasize:** every claim traceable; every claim carries an evidence strength; contradictions
explicitly surfaced; changes continuously monitored; the whole reasoning chain auditable;
other AI systems call it through an API.

**De-emphasize** (nice demos, not the identity): the 3-D anatomy view, a consumer chatbot,
"we use PubMed" (an input, not a moat), "AI that answers from papers" (too generic), and the
evidence pyramid as the *entire* grading story (the real world is more nuanced).

## The long-term picture

Every medical AI output carries a structured evidence layer: the AI creates the answer; Strata
determines how much the answer deserves to be trusted. Own that, and you own the trust
infrastructure of AI-powered medicine.

## What's built toward this (see the repo)

- **Strata Verify** — `strata verify "<claim>"` and `POST /v1/verify` return a real Evidence
  Receipt: claim traced, studies graded and classified support/contradict/neutral, status +
  strength aggregated, key limitation surfaced, citations attached.
- **Strata Monitor** — register a claim, re-check, and get a real "what changed" feed
  (upgraded / downgraded / conflict / new study).
- **Strata Seal** — a public `GET /v1/seal/<id>.svg` badge.
- **API + SDKs** (Python, JS) + **self-host** (Docker / wheel), API-key auth, non-device by
  construction (public literature only, no PHI, no diagnosis).

It is a working prototype, honestly labeled: the classification is heuristic, full-text
licensing and the claim-level graph at scale are ahead, and the space is competitive. The
architecture and the category, though, are the ones worth pursuing.
