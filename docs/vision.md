# Strata — from evidence engine to a category-defining medical-AI company

*How a small, honest tool becomes a billion-dollar company: the plan, the wedge, the moat, and the honest risks.*

This document is written in the spirit of the product itself — grounded, graded, and
honest about how strong the case actually is. Nothing here is a promise. It is a
thesis with its confidence stated, the way Strata states the confidence of an answer.

---

## TL;DR — the thesis in five lines

1. **Medicine runs on evidence, and evidence has become unmanageable.** Millions of new
   papers a year, systematic reviews that take a year and cost six figures, and clinicians
   who get minutes to decide. The bottleneck is no longer *finding* text — it is *trusting*
   the synthesis.
2. **The first wave of medical AI failed on exactly the axis that matters: trust.** A
   chatbot that answers everything confidently and cites nothing is unusable in a regulated,
   liable, life-and-death setting.
3. **Strata's core is the thing everyone else bolted on last: calibrated honesty.** It
   grades the strength of its own answers and never invents a fact. In medicine, that is not
   a feature — it *is* the product.
4. **Sell trust, not answers.** The wedge is the buyer who is legally and commercially
   obsessed with defensibility: life-sciences evidence and medical-affairs teams. Land there,
   expand to payers and point-of-care, then become the grounding-and-grading layer the rest
   of health AI is built on.
5. **The moat is a compounding, expert-graded evidence graph plus regulated-workflow
   lock-in** — not the retrieval, which is commoditizing. Get the graph and the calibration
   loop turning and it is very hard to catch.

---

## 1. The problem worth a billion dollars

Every medical and scientific decision is, underneath, an evidence-retrieval-and-appraisal
problem:

- **Point of care.** A clinician has a specific patient and a specific question and a few
  minutes. "Best available evidence" is real but practically unreachable at that speed.
- **Life sciences.** A systematic literature review — the backbone of an HEOR dossier, a
  regulatory submission, a payer value story, a guideline — routinely takes **6–12 months
  and tens to hundreds of thousands of dollars**, and is out of date the day it ships.
- **Medical information.** Medical-affairs teams field enormous volumes of unsolicited HCP
  questions that must be answered with cited, fair-balanced, on-label, auditable evidence.
- **Coverage & policy.** Payers and health-technology assessors write medical policy that
  must survive appeal, litigation, and scrutiny — every claim traceable to a source.

The common failure across all of these is the same: **the work of turning a pile of papers
into a trustworthy, graded, cited answer is manual, slow, and doesn't scale — and the AI
that promised to fix it lies with a straight face.**

That is a large, budgeted, recurring pain. It is not a vitamin.

## 2. The insight — sell trust, not answers

Generating fluent medical text is now free. That is precisely why it is worthless on its
own: when the marginal cost of a confident wrong answer is zero, the scarce, valuable thing
is a *trustable* one — grounded in real sources, graded for strength, cited line by line,
and auditable after the fact.

Strata was built inside-out for this:

- **Grounded** — the answer comes only from retrieved papers; no paper, no claim.
- **Graded** — every source is placed on the evidence pyramid (meta-analysis → RCT → cohort
  → case report) and the *body* of evidence gets a computed verdict: strong / moderate /
  weak / very weak.
- **Honest** — when the literature doesn't settle the question, it says so instead of
  filling the gap.

The strategic reframing: **most health-AI companies are racing to answer more questions.
Strata wins by being the one you can defend in front of a regulator, a medical director, or
a court.** Honesty is the differentiator that competitors cannot copy without rebuilding
their product around it — and it happens to be the exact property that unlocks the highest-
value, most regulated buyers first.

## 3. Beachhead — who pays first, and why

Do **not** start at the clinician. Point-of-care is the biggest prize and the worst first
market: fragmented buyers, EHR-integration tax, long trust cycles, and reimbursement
politics. Start where the pain is budgeted and the obsession with defensibility is already
the culture.

**Beachhead: Life-sciences evidence & medical-affairs teams** (pharma, biotech, med-device,
and the CROs and agencies serving them).

- They already pay six figures per systematic review and staff whole teams on literature
  surveillance, medical information, and evidence generation.
- They cannot use an un-auditable tool — which is exactly why the "chatbot" wave bounced off
  them, and exactly where Strata's graded, cited, grounded design is a native fit.
- Contracts are large (five-to-seven-figure ACV), annual, and expand by team and therapeutic
  area.

**First three wedge products, all the same engine pointed at a workflow:**

1. **Living systematic reviews / evidence surveillance.** Turn a 9-month SLR into a
   continuously-updated, graded, exportable evidence base with a full citation audit trail.
2. **Medical-information response drafting.** Draft cited, graded, fair-balanced answers to
   HCP questions for human review — with every sentence traceable to a source.
3. **Evidence dossiers & value narratives** (HEOR / market access): assemble and grade the
   supporting literature, flag where the evidence is weak *before* a payer does.

## 4. Product roadmap — engine → graph → platform

The open-source engine is the seed. The company is three layers above it.

**Layer 0 — the engine (today).** Grounded, graded Q&A over PubMed. CLI + web + API. This is
the credibility artifact and the top of the funnel. Keep it open, keep it excellent.

**Layer 1 — the evidence graph (the asset).** Go beyond one abstract at a time. Ingest and
*grade* the full evidence landscape — PubMed, ClinicalTrials.gov, guidelines, drug labels,
conference abstracts, and licensed full text — into a structured, versioned, continuously-
updated graph of studies, claims, populations, interventions, and outcomes, each carrying its
strength grade and provenance. This is the thing that compounds.

**Layer 2 — regulated workflows (the revenue).** SLR automation, medical-information drafting,
surveillance, dossier generation, payer-policy support — each a validated, auditable workflow
on top of the graph, sold to a named team.

**Layer 3 — the Strata API (the platform).** Expose grounding + grading + citation as an
embeddable trust layer. Every other health-AI product — scribes, copilots, patient apps —
needs a way to *not* hallucinate and to show its work. Be the honesty layer they buy instead
of build. This is the move from "a product" to "infrastructure," and it is where the multiple
comes from.

**Layer 4 — point of care.** Only once the graph and the brand are real: the clinician-facing
decision-support app, entered from a position of trust rather than as one more chatbot.

## 5. Business model

- **Enterprise SaaS + usage** (beachhead): seats for evidence/medical-affairs teams plus
  metered synthesis. Five-to-seven-figure ACV, annual, land-and-expand by team and TA.
- **Platform/API metering** (Layer 3): per-call or per-grounded-answer pricing for embedded
  use — high gross margin, compounding with adoption.
- **Clinical subscriptions** (Layer 4, later): per-seat for institutions and clinicians, the
  UpToDate-shaped line item, entered late and from strength.

Gross margins are software margins minus content-licensing and inference cost; the licensed
full-text deals are the main variable cost and are negotiated as the graph's pull grows.

## 6. The moat — why this is defensible

Retrieval-augmented generation is commoditizing; that is not the moat. The moat is:

1. **The graded evidence graph.** A structured, versioned, continuously-updated, *graded*
   corpus is a data asset that compounds with every question asked and every source ingested.
   Latecomers start from an empty graph.
2. **The expert-calibration loop.** Every clinician or analyst who corrects a grade improves
   a proprietary calibration model. Trust data is the flywheel: better grades → more usage →
   more corrections → better grades. This is very hard to cold-start.
3. **Compliance as a product.** SOC 2, HIPAA, GxP, 21 CFR Part 11 validation, audit trails.
   These are painful to build and, once a customer has validated Strata inside a regulated
   process, painful to rip out. Regulated software is sticky software.
4. **Workflow embedding.** When Strata is the system of record for a team's SLRs or medical-
   information responses, switching means re-validating a core process. High switching cost.
5. **Brand.** "The honest one" is a positioning a competitor cannot claim without having built
   for it from day one. Own the word *trustworthy* in medical AI.

## 7. Regulatory strategy — a feature, not a tax

Strata's design is *regulatory-aligned by construction*. U.S. FDA guidance (the 21st Century
Cures Act criteria) treats clinical decision-support software as a **non-device** when it:
displays the basis of its recommendations, lets a competent professional independently review
that basis, and is not relied upon in a time-critical way. Strata's "show every source, grade
it, say it's not advice, read the papers" design maps onto these criteria almost line for line
— which is *why* the honest design is also the fast path to market.

Sequence: launch the evidence/med-affairs and non-device decision-support products with no
device clearance required; pursue Software-as-a-Medical-Device clearance later, deliberately,
only where a specific higher-risk, autonomous claim justifies it and adds enterprise value.
Build the quality system (design controls, validation) early because the life-sciences buyer
demands it anyway.

*(This is the U.S. framing; EU MDR and other regimes differ and are handled per market. None
of this is legal advice — regulatory counsel gates each launch.)*

## 8. Go-to-market

- **Open source as the top of the funnel.** The free engine earns credibility with the exact
  clinicians, researchers, and developers who become champions and hires. It is the cheapest,
  most authentic distribution a technical, trust-first product can have.
- **Design partners first.** Sign 5–10 named pharma/payer/CRO teams as design partners; build
  the SLR and medical-information workflows *with* them; turn results into hard case studies
  ("9 months → 3 weeks, full audit trail, zero fabricated citations").
- **Land and expand.** One therapeutic area or one medical-information desk, then the next,
  then enterprise-wide. Expansion is the growth engine; net revenue retention is the metric.
- **Category creation.** Name and own the category — *evidence intelligence* — so the buyer's
  mental model is "we need one of those," with Strata as the reference.

## 9. The path to unicorn — illustrative milestones

Targets, not promises — stated with their confidence, in keeping with the product.

| Stage | Proof | Rough ARR signal |
|---|---|---|
| **Seed** | 3–5 design partners live; evidence graph v1; the honesty claim independently validated | first \$0.5–2M |
| **Series A** | Repeatable enterprise motion; ~15–25 logos; API in private beta | \$3–8M ARR |
| **Series B** | Platform/API GA; payer + med-affairs both proven; net revenue retention >130% | \$20–40M ARR |
| **Unicorn** | Evidence intelligence is a category and Strata is its default; the graph + API are infrastructure others build on | ~\$80–120M ARR trajectory, or strategic value of the graph/platform |

The unicorn outcome rests on two things compounding at once: **the graph as a data asset** and
**the API as infrastructure**. Either alone is a good company; together they are the billion-
dollar one.

## 10. Competition — and why Strata wins its lane

The field is real and includes serious incumbents and fast-moving new entrants:

- **Evidence/reference incumbents** (e.g., UpToDate/Wolters Kluwer, Elsevier, DynaMed, and
  systematic-review tooling such as DistillerSR): trusted, entrenched, but built pre-LLM and
  largely human-curated — slow to become *generative* without risking the trust that is their
  whole franchise.
- **New clinical-AI entrants** answering clinician questions at the point of care: fast and
  well-funded, but aimed squarely at the hardest-to-defend market and competing on *coverage*.

Strata's wins its lane by refusing to fight on coverage:

- **Different beachhead.** Life-sciences evidence and medical affairs, not the crowded
  clinician-chatbot lane.
- **Different axis.** Auditability, grading, and provenance — the axis regulated buyers score
  on — rather than "answers the most questions."
- **Different shape.** A graph + platform, not a single app, so success makes Strata
  infrastructure rather than a feature to be cloned.

Honest read: this is a competitive, well-capitalized space, and incumbents have distribution
we don't. The bet is that *trust-first, evidence-first, life-sciences-first* is an open lane
that the coverage-racing chatbots are structurally disinclined to enter.

## 11. Honest risks — the way the product would state them

*Very weak to moderate confidence on each mitigation; stated plainly, not buried.*

- **RAG commoditizes.** If grounded generation becomes a checkbox, the engine alone is not a
  business. → *Mitigation:* the graph and the calibration loop are the moat, not the retrieval.
- **Full-text licensing is expensive and gated by publishers.** → *Mitigation:* start on open
  bibliographic data (where Strata already lives), license incrementally as enterprise pull
  funds it, and make abstracts-plus-grading valuable on their own.
- **Enterprise/regulated sales cycles are long.** → *Mitigation:* design-partner motion,
  open-source funnel, and a workflow ROI (months → weeks) sharp enough to pull budget.
- **Liability.** Medicine is litigious. → *Mitigation:* the design *is* the liability strategy —
  decision support, sources shown, strength graded, "read the papers, not advice" on every
  answer; human-in-the-loop by default; regulatory counsel gating claims.
- **Incumbent distribution.** UpToDate is already in the hospital. → *Mitigation:* don't fight
  there first; win life sciences and the API, arrive at point-of-care from strength.
- **Trust is the whole brand — one confident fabrication is existential.** → *Mitigation:*
  treat calibration and no-hallucination as the P0 metric, measured and published, forever.

## 12. The next 90 days

1. **Sharpen the wedge.** Pick one: living-SLR **or** medical-information drafting. Build the
   end-to-end workflow (ingest → grade → draft → export with audit trail) on top of today's
   engine.
2. **Sign 3 design partners.** Named teams, real documents, a measurable before/after.
3. **Ship evidence graph v1.** Add ClinicalTrials.gov + guidelines + drug labels to PubMed;
   version and persist the graded graph.
4. **Instrument the honesty claim.** Build the eval harness that measures grounding fidelity
   and grade calibration against expert labels — the number that *is* the brand.
5. **Stand up trust infrastructure.** SOC 2 track, HIPAA posture, audit logging — because the
   first enterprise buyer will ask on the first call.
6. **Tell the story.** The open-source engine, the case studies, and the category name —
   "evidence intelligence" — pointed at the beachhead buyer.

---

*Strata's promise to the market is the same as its promise in every answer: we will show you
the evidence, we will tell you how strong it is, and we will never pretend to know more than
we do. That is a rare thing to sell in medicine — which is exactly why it can be a large
company.*
