"""Seed a demonstration evidence base for the Console.

Honesty note: the *studies* below are synthetic and use hypothetical
interventions (Treatment X, Compound A, …) — never real drugs — so nothing here
fabricates evidence about a real product. What is *real* is the engine: every
grade, stance, contradiction and change event shown in the Console is computed
by the actual pipeline over this corpus. On a live network, ``strata monitor
run`` and ``POST /v1/monitor`` populate the same tables from real literature.

The demo deliberately includes claims whose evidence *changed* — a new null RCT,
a new meta-analysis — so the Console shows the thing that matters: what moved.
"""
from __future__ import annotations

from typing import List

from .db import Database
from .pubmed import Article
from .sources import RetrievalResult
from .claims import create_claim_from_question, ingest
from .monitor import create_monitor
from .verify import verify

DEMO_ORG = "Strata Demo"
DEMO_WORKSPACE = "Sample Evidence Base (synthetic)"


def _A(pmid, title, abstract, journal, year, ptypes, doi):
    return Article(pmid, title, abstract, journal, year, ["Author A", "Author B"],
                   ptypes, doi=doi, source="pubmed")


def _ret(arts: List[Article]):
    return lambda q, retmax, sources=None: RetrievalResult(
        articles=arts, per_source={"pubmed": len(arts)}, retrieved_total=len(arts),
        unique=len(arts), sources_used=["pubmed"])


# (question, therapeutic_area, baseline_articles, followup_articles_or_None)
_CLAIMS = [
    ("Does Treatment X reduce hospitalization in elderly patients with heart failure?",
     "Cardiology",
     [_A("c1", "Treatment X reduces hospitalization in elderly heart failure: a meta-analysis of RCTs",
         "In 18 randomized trials (n = 24,500) of adults over 65 with heart failure, Treatment X "
         "reduced hospitalization (RR 0.79, 95% CI 0.71 to 0.88, p < 0.001).", "Lancet", 2021,
         ["Meta-Analysis"], "10.5555/c1"),
      _A("c2", "Randomized controlled trial of Treatment X in older heart failure patients",
         "Among 4,200 patients aged 65 to 88 with heart failure, Treatment X reduced hospitalization "
         "versus standard care (HR 0.83, 95% CI 0.72 to 0.95, p = 0.008) over 2.5 years.", "NEJM",
         2022, ["Randomized Controlled Trial"], "10.5555/c2")],
     [_A("c9", "Large randomized trial of Treatment X finds no reduction in hospitalization in the elderly",
         "In 8,000 patients over 65 with heart failure, Treatment X did not reduce hospitalization "
         "(HR 0.98, 95% CI 0.90 to 1.07, p = 0.64).", "JAMA", 2025,
         ["Randomized Controlled Trial"], "10.5555/c9")]),

    ("Does Compound A lower cardiovascular mortality in adults with type 2 diabetes?",
     "Endocrinology",
     [_A("e1", "Compound A and cardiovascular mortality in type 2 diabetes: a systematic review",
         "Across 12 cohort studies (n = 61,000 adults), Compound A was associated with lower "
         "cardiovascular mortality (HR 0.88, 95% CI 0.80 to 0.97).", "Diabetologia", 2020,
         ["Systematic Review"], "10.5555/e1"),
      _A("e2", "Prospective cohort of Compound A users with type 2 diabetes",
         "In this prospective cohort of 15,000 adults, Compound A users had lower cardiovascular "
         "mortality (HR 0.90, 95% CI 0.82 to 0.99).", "Circulation", 2021, [], "10.5555/e2")],
     None),

    ("Is Agent Z effective for preventing recurrence in early-stage breast cancer?",
     "Oncology",
     [_A("o1", "Agent Z for recurrence prevention in early breast cancer: randomized trial",
         "In 2,100 women with early-stage breast cancer, Agent Z reduced recurrence (HR 0.76, "
         "95% CI 0.63 to 0.92, p = 0.004) over 5 years. Funded by Oncimmune Ltd.", "J Clin Oncol",
         2023, ["Randomized Controlled Trial"], "10.5555/o1")],
     [_A("o5", "Agent Z shows no recurrence benefit in a second randomized trial",
         "Among 2,400 women with early-stage breast cancer, Agent Z did not reduce recurrence "
         "(HR 1.02, 95% CI 0.86 to 1.21, p = 0.80).", "Lancet Oncol", 2025,
         ["Randomized Controlled Trial"], "10.5555/o5")]),

    ("Does early Compound B administration improve survival in sepsis?",
     "Infectious Disease",
     [_A("i1", "Early Compound B in sepsis: a case series",
         "We describe 40 patients with sepsis given early Compound B; survival appeared improved.",
         "Crit Care", 2019, ["Case Reports"], "10.5555/i1"),
      _A("i2", "Observational study of early Compound B in sepsis",
         "In 900 patients, early Compound B was associated with improved survival, though the "
         "confidence interval was wide (OR 0.7, 95% CI 0.4 to 1.2).", "Chest", 2020,
         ["Observational Study"], "10.5555/i2")],
     None),

    ("Does Treatment Y reduce stroke risk in patients with atrial fibrillation?",
     "Cardiology",
     [_A("c20", "Treatment Y for stroke prevention in atrial fibrillation: meta-analysis",
         "In 9 randomized trials (n = 31,000), Treatment Y reduced stroke (RR 0.68, 95% CI 0.60 "
         "to 0.77, p < 0.001).", "Eur Heart J", 2022, ["Meta-Analysis"], "10.5555/c20"),
      _A("c21", "Randomized trial of Treatment Y in atrial fibrillation",
         "Among 6,500 patients, Treatment Y reduced stroke versus placebo (HR 0.66, 95% CI 0.55 "
         "to 0.79).", "NEJM", 2023, ["Randomized Controlled Trial"], "10.5555/c21")],
     None),

    ("Does Supplement C prevent cognitive decline in older adults?",
     "Endocrinology",
     [_A("e10", "Supplement C and cognitive decline: a narrative review",
         "This review discusses Supplement C and cognition; findings are mixed.", "J Nutr Health",
         2018, ["Review"], "10.5555/e10"),
      _A("e11", "Cross-sectional study of Supplement C and cognition",
         "In 1,200 older adults, no significant association was found between Supplement C and "
         "cognitive decline (no significant difference).", "Age Ageing", 2021,
         ["Observational Study"], "10.5555/e11")],
     None),
]


def seed_demo(db: Database, *, current_year: int = 2026) -> int:
    """Populate a synthetic demo workspace. Returns the workspace id. Idempotent-ish:
    skips seeding if the demo workspace already has claims."""
    org = db.get_or_create_org(DEMO_ORG)
    ws = db.get_or_create_workspace(org, DEMO_WORKSPACE, "sample")
    if db.list_claims(ws, limit=1):
        return ws

    for question, area, baseline, followup in _CLAIMS:
        claim_id = create_claim_from_question(db, ws, question, therapeutic_area=area)
        create_monitor(db, claim_id, frequency="weekly")
        v1 = verify(question, current_year=current_year, retrieve_fn=_ret(baseline),
                    claim_population=db.get_claim(claim_id).get("population"))
        ingest(db, claim_id, v1)
        if followup:
            v2 = verify(question, current_year=current_year,
                        retrieve_fn=_ret(baseline + followup),
                        claim_population=db.get_claim(claim_id).get("population"))
            ingest(db, claim_id, v2)
    return ws
