"""Strata — a medical evidence engine that grades the strength of its answers.

Ask a clinical question; get an answer built only from real PubMed literature,
with every source placed on the evidence pyramid and an honest verdict on how
strong the backing actually is.

    from strata import ask
    r = ask("Does vitamin D supplementation prevent respiratory infections?")
    print(r.body.summary)      # e.g. "moderate-quality evidence — ..."
    print(r.answer)

The engine never invents facts: without a model it returns a grounded digest of
the retrieved papers; with a model (passed as `generate`) it synthesises a cited
narrative from those same papers and nothing else.
"""
from .evidence import BodyAssessment, Grade, grade, summarize_body
from .pubmed import Article, search_articles
from .query import Evidence, Result, ask, rank
from .receipt import Receipt
from . import anatomy, monitor, review, store, verify
from .verify import verify_claim

__version__ = "0.3.0"
__all__ = ["ask", "Result", "Evidence", "rank", "grade", "summarize_body",
           "Article", "search_articles", "Grade", "BodyAssessment",
           "verify", "verify_claim", "Receipt", "monitor", "review", "anatomy", "store"]
