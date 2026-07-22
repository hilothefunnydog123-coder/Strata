# Strata

**A medical evidence engine that grades the strength of its own answers.**

Ask a clinical question. Strata searches real PubMed literature, places every source on the evidence pyramid — meta-analysis → RCT → cohort → case report — and gives you an answer with an honest verdict on how strong the backing actually is. The thing that makes AI dangerous in medicine is confident hallucination; Strata is built to be the opposite. It never invents a fact: the answer comes only from retrieved papers, and it tells you plainly when the evidence is weak or absent.

```bash
pip install strata-evidence
strata ask "Does vitamin D supplementation prevent respiratory infections?"
```

```
Q  Does vitamin D supplementation prevent respiratory infections?
[MODERATE EVIDENCE]

Evidence verdict: moderate-quality evidence — the strongest available is a
systematic review / meta-analysis (1× meta-analysis, 1× RCT, 1× case report).

[1] Systematic review / meta-analysis · high evidence · 2021
    Vitamin D and respiratory infection: a meta-analysis of RCTs
    In 25 trials (n = 11,321), supplementation reduced infection risk.
    https://pubmed.ncbi.nlm.nih.gov/…

[2] Randomized controlled trial · high evidence · 2023
    ...

This is a grounded digest of the strongest retrieved evidence, not medical
advice. Read the primary sources before acting.
```

## Why it's different

Most "medical AI" is a chatbot that will answer anything, confidently, from a blur of training data. Strata inverts that:

- **Real sources only.** Every answer is anchored to specific PubMed papers, with PMIDs and links. No paper, no claim.
- **Graded, not just cited.** A citation isn't evidence — a *good* citation is. Strata classifies each paper's study design and assigns it a level on the evidence pyramid, so a single case report never gets to sound like settled science.
- **Honest about strength.** Every answer carries a computed verdict — *strong / moderate / weak / very weak* — from the quality, quantity, size, and recency of what it found. If the literature doesn't answer the question, it says so.

## Web app

```bash
strata serve      # opens a clean search page at http://127.0.0.1:8600
```

Ask a question in the browser and Strata renders the strength verdict, a visual
**evidence pyramid** (how many papers landed at each level), and the graded,
linked sources — strongest first. Standard library only; nothing is stored.

## Behind a school or corporate network?

If you see `CERTIFICATE_VERIFY_FAILED`, your network is intercepting HTTPS with
its own certificate (common on managed devices). Strata already trusts the
operating-system certificate store, which usually fixes it. If it persists:

- run it on a normal network (home Wi-Fi or a phone hotspot), **or**
- point it at your network's certificate: `set STRATA_CA_BUNDLE=C:\path\to\ca.pem`, **or**
- as a last resort on a network you trust, `set STRATA_INSECURE=1` to skip the
  check (only reads public data — but off by default for a reason).

## Two modes

**Grounded digest (no model, no API key).** The default. A structured summary of the strongest retrieved papers — verdict, then each source with its grade and key finding. Facts come only from the abstracts.

**Synthesised narrative (bring your own model).** Pass any text-in/text-out function as `generate`. Strata builds a prompt containing *only* the retrieved, graded abstracts and instructs the model to cite them inline and admit uncertainty — so the model summarises, it is never the source of a fact.

```python
from strata import ask

r = ask("Does metformin reduce cardiovascular mortality in type 2 diabetes?")
print(r.body.overall_strength)   # "moderate"
print(r.answer)                  # grounded, cited digest

r = ask("...", generate=my_model)   # cited narrative, anchored to the same papers
```

## How the grading works

Levels follow the standard hierarchy (Oxford CEBM / GRADE, simplified), read from each paper's PubMed publication types and title, then adjusted for sample size and recency:

| Level | Study design | Base strength |
|--:|---|---|
| 1 | Systematic review / meta-analysis | high |
| 2 | Randomized controlled trial | high |
| 3 | Cohort / prospective study | moderate |
| 4 | Case-control / cross-sectional / observational | low |
| 5 | Case report / series | very low |
| 6 | Narrative review / editorial / opinion | very low |

A small study or a stale one is knocked down a peg; a lone strong study counts for less than several. It's a transparent heuristic — **decision support, not a substitute for reading the papers, and not medical advice** — and the tool says so on every answer.

## Data & privacy

Strata reads the public [NCBI E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/) API — open bibliographic data. It handles **no patient data**, stores nothing, and needs no key (set `NCBI_API_KEY` to raise the rate limit). It is a research and reference tool for professionals; it does not diagnose, treat, or give personalised medical advice.

## License

MIT © 2026 Neil Gilani
