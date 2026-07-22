"""Strata — a medical evidence engine that grades the strength of its answers.

Ask a clinical question; get an answer built only from real PubMed literature,
with every source placed on the evidence pyramid, appraised against the GRADE
domains, and an honest verdict on how strong the backing actually is.

    from strata import ask

    r = ask("Does vitamin D supplementation prevent respiratory infections?")
    print(r.body.summary)         # "moderate-certainty evidence — …"
    print(r.consensus.summary)    # whether the papers agree, weighted by quality
    print(r.answer)               # a grounded, cited digest

The engine never invents facts. Without a model it returns a structured digest of
the retrieved papers; with a model (passed as ``generate``) it synthesises a
cited narrative from those same papers and nothing else, and flags the answer if
the model returns one without citations.

Three small neural networks read each abstract — study design, direction of
finding, and which methodological safeguards are reported — and every prediction
they make can point at the words that produced it. They are an upgrade to the
rule-based grader, never a replacement: with no weights on disk, or with
``STRATA_NO_NN=1``, everything still works.
"""
from .evidence import (BodyAssessment, Domain, Grade, LEVEL_LABEL, grade,
                       summarize_body)
from .pubmed import Article, Correction, search_articles
from .query import Comparison, Evidence, Result, ask, compare, rank
from .stats import EffectSize, Pooled, extract_effects, pool

__version__ = "0.2.0"

__all__ = [
    "ask", "compare", "rank",
    "Result", "Comparison", "Evidence",
    "grade", "summarize_body", "Grade", "BodyAssessment", "Domain", "LEVEL_LABEL",
    "Article", "Correction", "search_articles",
    "EffectSize", "Pooled", "extract_effects", "pool",
    "__version__",
]
