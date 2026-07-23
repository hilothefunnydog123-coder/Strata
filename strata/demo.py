"""Deterministic demo data — a rich Console with no network.

Three realistic living reviews, each seeded with two syncs so the surveillance panel has
a real 'what changed since last time' story (a newer study arrives, certainty moves). No
live PubMed call, no API key, fully reproducible — ideal for a local demo, a sales walk-
through, or a shareable link.

The abstracts are lightly stylised (clean effect sizes with confidence intervals) so the
forest plot and accumulation curve render well. They stand in for real records; the live
product uses the same pipeline against PubMed.
"""
from __future__ import annotations

from . import entities, monitor, review, store
from .pubmed import Article

_YEAR = 2026

# the demo organization's evidence base — a real object graph the Console renders
_ORG_ID, _WS_ID = "org-meridian", "ws-meridian"
_TENANT = "Meridian Health (demo)"
_AREAS = [
    ("area-cardiology", "Cardiology"),
    ("area-endocrinology", "Endocrinology & Metabolism"),
    ("area-infectious-disease", "Infectious Disease"),
]


def _a(pmid, title, ptypes, abstract, year, authors=("Ng V", "Okafor L", "Sato H")):
    return Article(pmid=pmid, title=title, abstract=abstract, journal="J Evid Synth",
                   year=year, authors=list(authors), publication_types=list(ptypes))


def _enrich(articles):
    """Give demo records realistic source provenance + citation counts so the receipts show
    the full multi-source picture offline."""
    cyc = ["pubmed", "europepmc", "openalex", "europepmc", "pubmed", "openalex", "crossref"]
    for i, a in enumerate(articles):
        pts = " ".join(a.publication_types).lower()
        t = a.title.lower()
        a.source = "clinicaltrials" if "registry" in pts else cyc[i % len(cyc)]
        lvl = (1 if ("meta" in t or "meta-analysis" in pts or "systematic" in t) else
               2 if ("randomiz" in t or "randomized" in pts) else
               3 if "cohort" in t else 5 if "case" in t else 4)
        base = {1: 540, 2: 270, 3: 120, 4: 48, 5: 12, 6: 22}[lvl]
        a.cited_by = base + (int((a.pmid or "0")[-2:]) % 40) * 3
        if a.doi is None:
            a.doi = f"10.1101/strata.{a.pmid}"
    return articles


# --------------------------------------------------------------- 1) Vitamin D
_VITD = [
    _a("40011001", "Vitamin D and respiratory infection: a meta-analysis of randomized trials",
       ["Meta-Analysis", "Systematic Review"],
       "In 25 trials (n = 11,321), vitamin D supplementation reduced the risk of acute "
       "respiratory infection (risk ratio 0.88, 95% CI 0.81 to 0.96), with the largest "
       "benefit in those with baseline deficiency.", 2021),
    _a("40011002", "Daily vitamin D for prevention of respiratory infection: a randomized controlled trial",
       ["Randomized Controlled Trial"],
       "Among 5,110 adults, the risk ratio for infection was 0.90 (95% CI 0.79 to 1.02), a "
       "modest, non-significant reduction over 12 months.", 2023),
    _a("40011003", "Serum vitamin D status and respiratory infection: a prospective cohort",
       ["Observational Study"],
       "In a cohort of 18,000 adults followed 7 years, low vitamin D was associated with "
       "infection (adjusted hazard ratio 0.86, 95% CI 0.74 to 0.99 per higher tertile).", 2022),
    _a("40011004", "High-dose vitamin D in critically ill patients: a randomized trial",
       ["Randomized Controlled Trial"],
       "Among 1,360 patients, high-dose vitamin D did not reduce hospital length of stay; "
       "no significant difference was observed.", 2020),
    _a("40011005", "Vitamin D toxicity after supplementation: a case report",
       ["Case Reports"],
       "We describe a single patient with hypercalcaemia following high-dose supplementation.", 2022),
    _a("40011006", "Vitamin D: a narrative overview for clinicians",
       ["Review"], "This review discusses vitamin D physiology and supplementation debates.", 2019),
    # the 'new since last sync' study:
    _a("40011007", "Updated meta-analysis of vitamin D for acute respiratory infection",
       ["Meta-Analysis", "Systematic Review"],
       "Across 43 trials (n = 49,419), supplementation reduced acute respiratory infection "
       "(risk ratio 0.92, 95% CI 0.86 to 0.99); daily dosing drove the effect.", 2024),
]

# --------------------------------------------------------------- 2) Metformin
_METF = [
    _a("40022001", "Metformin and cardiovascular mortality in type 2 diabetes: a meta-analysis",
       ["Meta-Analysis", "Systematic Review"],
       "Pooling 20 studies, metformin was associated with lower cardiovascular mortality "
       "(hazard ratio 0.83, 95% CI 0.74 to 0.93).", 2020),
    _a("40022002", "Metformin versus sulfonylurea and cardiovascular outcomes: a randomized trial",
       ["Randomized Controlled Trial"],
       "Among 3,200 patients with type 2 diabetes, metformin reduced the composite outcome "
       "(hazard ratio 0.79, 95% CI 0.65 to 0.96) over 5 years.", 2019),
    _a("40022003", "Metformin use and mortality: a nationwide cohort",
       ["Observational Study"],
       "In 74,000 adults, metformin was associated with lower all-cause mortality "
       "(adjusted hazard ratio 0.90, 95% CI 0.82 to 0.98).", 2021),
    _a("40022004", "Metformin in patients with heart failure and diabetes: a randomized trial",
       ["Randomized Controlled Trial"],
       "Among 1,100 patients, metformin showed no significant difference in cardiovascular "
       "death (hazard ratio 0.98, 95% CI 0.85 to 1.13).", 2018),
    _a("40022005", "Lactic acidosis on metformin: a case series",
       ["Case Reports"],
       "Three patients with renal impairment developed lactic acidosis.", 2017),
    # new since last sync:
    _a("40022006", "Metformin and cardiovascular death: an updated randomized trial",
       ["Randomized Controlled Trial"],
       "In 6,800 participants, metformin lowered cardiovascular death (hazard ratio 0.81, "
       "95% CI 0.70 to 0.94) over 6 years.", 2024),
]

# --------------------------------------------------------------- 3) SGLT2 inhibitors
_SGLT2 = [
    _a("40033001", "SGLT2 inhibitors and heart-failure hospitalization: a meta-analysis",
       ["Meta-Analysis", "Systematic Review"],
       "Across trials of 40,000 patients, SGLT2 inhibitors reduced heart-failure "
       "hospitalization (hazard ratio 0.69, 95% CI 0.61 to 0.79).", 2022),
    _a("40033002", "SGLT2 inhibition in heart failure with reduced ejection fraction: a randomized trial",
       ["Randomized Controlled Trial"],
       "Among 4,744 patients, the drug reduced worsening heart failure or cardiovascular "
       "death (hazard ratio 0.74, 95% CI 0.65 to 0.85).", 2019),
    _a("40033003", "SGLT2 inhibition in heart failure with preserved ejection fraction: a randomized trial",
       ["Randomized Controlled Trial"],
       "Among 5,988 patients, the drug reduced the primary composite (hazard ratio 0.79, "
       "95% CI 0.69 to 0.90).", 2021),
    _a("40033004", "Renal and cardiac outcomes with SGLT2 inhibitors: a prospective cohort",
       ["Observational Study"],
       "In 61,000 adults, SGLT2 inhibitors were associated with fewer HF hospitalizations "
       "(adjusted hazard ratio 0.72, 95% CI 0.60 to 0.86).", 2020),
    # new since last sync:
    _a("40033005", "SGLT2 inhibitors across the ejection-fraction spectrum: pooled randomized evidence",
       ["Meta-Analysis", "Systematic Review"],
       "Pooling 6 trials (n = 21,947), SGLT2 inhibitors reduced heart-failure "
       "hospitalization (hazard ratio 0.71, 95% CI 0.64 to 0.78).", 2023),
]


_TOPICS = [
    dict(id="demo-vitamin-d-respiratory", title="Vitamin D & respiratory infection",
         question="Does vitamin D supplementation prevent acute respiratory infections?",
         data=_VITD, t1="2026-04-18T09:00:00+00:00", t2="2026-07-21T09:00:00+00:00"),
    dict(id="demo-metformin-cv", title="Metformin & cardiovascular mortality (T2D)",
         question="Does metformin reduce cardiovascular mortality in type 2 diabetes?",
         data=_METF, t1="2026-05-02T09:00:00+00:00", t2="2026-07-20T09:00:00+00:00"),
    dict(id="demo-sglt2-hf", title="SGLT2 inhibitors & heart-failure hospitalization",
         question="Do SGLT2 inhibitors reduce heart-failure hospitalization?",
         data=_SGLT2, t1="2026-06-11T09:00:00+00:00", t2="2026-07-22T09:00:00+00:00"),
]


def seed(force: bool = False) -> list:
    """Create the three demo reviews with two syncs each. Idempotent unless force."""
    ids = []
    for t in _TOPICS:
        if force:
            store.delete(t["id"])
        if not force and store.get(t["id"]) is not None:
            ids.append(t["id"])
            continue
        review.create(t["title"], t["question"], include_levels=(1, 2, 3, 4, 5),
                      id=t["id"])
        earlier = t["data"][:-1]              # last record is the 'new' one
        full = t["data"]
        review.sync(t["id"], current_year=_YEAR, now=t["t1"],
                    _search=lambda q, retmax=60, _e=earlier: list(_e))
        review.sync(t["id"], current_year=_YEAR, now=t["t2"],
                    _search=lambda q, retmax=60, _f=full: list(_f))
        ids.append(t["id"])
    return ids


# ------------------------------------------------- monitored claims (Verify + Monitor)
# A claim whose evidence genuinely conflicts — for the "conflict detected" alert.
_FASTING = [
    _a("40044001", "Intermittent fasting and cardiovascular mortality: a meta-analysis of trials",
       ["Meta-Analysis", "Systematic Review"],
       "Across 12 short trials (n = 2,100), intermittent fasting showed no significant effect "
       "on cardiovascular mortality (risk ratio 0.98, 95% CI 0.82 to 1.17).", 2022),
    _a("40044002", "Time-restricted eating and cardiometabolic risk: a randomized trial",
       ["Randomized Controlled Trial"],
       "In 320 adults, time-restricted eating reduced a cardiometabolic composite "
       "(hazard ratio 0.71, 95% CI 0.52 to 0.97) over 12 months.", 2021),
    _a("40044003", "8-hour eating window and cardiovascular death: a prospective cohort",
       ["Observational Study"],
       "Among 20,000 adults, a habitual 8-hour eating window was associated with higher "
       "cardiovascular mortality (hazard ratio 1.35, 95% CI 1.10 to 1.66).", 2024),
    _a("40044004", "Intermittent fasting: a narrative review", ["Review"],
       "This review summarises proposed mechanisms and open questions.", 2020),
]

for _ds in (_VITD, _METF, _SGLT2, _FASTING):   # add source provenance + citation counts
    _enrich(_ds)


_CLAIMS = [
    dict(id="clm-vitd-ari", claim="Vitamin D supplementation reduces the risk of acute respiratory infections",
         data=_VITD, area="area-infectious-disease", priority="normal",
         t1="2026-04-18T09:00:00+00:00", t2="2026-07-21T09:00:00+00:00"),
    dict(id="clm-metformin-cvd", claim="Metformin reduces cardiovascular mortality in type 2 diabetes",
         data=_METF, area="area-endocrinology", priority="high",
         t1="2026-05-02T09:00:00+00:00", t2="2026-07-20T09:00:00+00:00"),
    dict(id="clm-sglt2-hf", claim="SGLT2 inhibitors reduce heart-failure hospitalization",
         data=_SGLT2, area="area-cardiology", priority="high",
         t1="2026-06-11T09:00:00+00:00", t2="2026-07-22T09:00:00+00:00"),
    dict(id="clm-fasting-cvd", claim="Intermittent fasting reduces cardiovascular mortality",
         data=_FASTING, area="area-cardiology", priority="normal",
         t1="2026-05-20T09:00:00+00:00", t2="2026-07-19T09:00:00+00:00"),
]


def seed_org(force: bool = False) -> dict:
    """Create the demo Organization -> Workspace -> Therapeutic Areas graph."""
    if force or store.get(_ORG_ID, kind="orgs") is None:
        entities.create_org(_TENANT, plan="enterprise", id=_ORG_ID)
        entities.create_workspace(_ORG_ID, "Cardiometabolic Evidence", id=_WS_ID)
        for aid, name in _AREAS:
            entities.create_area(_WS_ID, name, id=aid)
    return {"org": _ORG_ID, "workspace": _WS_ID, "areas": [a for a, _ in _AREAS]}


def seed_claims(force: bool = False) -> list:
    """Register the demo claims as first-class Claims in the workspace, check each twice so
    the change feed has a real story, then backfill the alert feed from that history."""
    seed_org(force)
    ids = []
    for c in _CLAIMS:
        if force:
            store.delete(c["id"], kind="claims")
        if not force and store.get(c["id"], kind="claims") is not None:
            ids.append(c["id"])
            continue
        entities.create_claim(c["claim"], tenant=_TENANT, workspace_id=_WS_ID,
                              area_id=c["area"], priority=c.get("priority", "normal"), id=c["id"])
        earlier = c["data"][:-1]
        full = c["data"]
        monitor.check(c["id"], now=c["t1"], _search=lambda q, retmax=40, _e=earlier: list(_e))
        monitor.check(c["id"], now=c["t2"], _search=lambda q, retmax=40, _f=full: list(_f))
        entities.backfill_alerts(c["id"])
        ids.append(c["id"])
    return ids


# Related claims that share the SAME pivotal trials — a real evidence base overlaps, and that
# overlap is what the Evidence Graph turns into cross-claim intelligence. The 8-hour-window
# cohort (higher CV mortality) legitimately *supports* the "increases mortality" claim while
# *contradicting* the "reduces mortality" claim — a genuine contested study.
_RELATED = [
    dict(id="clm-sglt2-cvd", claim="SGLT2 inhibitors reduce cardiovascular death",
         data=_SGLT2, area="area-cardiology", t="2026-07-22T10:00:00+00:00"),
    dict(id="clm-metformin-acm", claim="Metformin reduces all-cause mortality in type 2 diabetes",
         data=_METF, area="area-endocrinology", t="2026-07-20T10:00:00+00:00"),
    dict(id="clm-fasting-harm", claim="Intermittent fasting increases cardiovascular mortality",
         data=_FASTING, area="area-cardiology", t="2026-07-19T10:00:00+00:00"),
]


def seed_related(force: bool = False) -> list:
    """Register claims that share evidence with the core set, so the graph has real overlap."""
    seed_org(force)
    ids = []
    for c in _RELATED:
        if force:
            store.delete(c["id"], kind="claims")
        if not force and store.get(c["id"], kind="claims") is not None:
            ids.append(c["id"])
            continue
        entities.create_claim(c["claim"], tenant=_TENANT, workspace_id=_WS_ID,
                              area_id=c["area"], id=c["id"])
        monitor.check(c["id"], now=c["t"], _search=lambda q, retmax=40, _d=c["data"]: list(_d))
        ids.append(c["id"])
    return ids


def seed_all(force: bool = False) -> dict:
    return {"reviews": seed(force), "claims": seed_claims(force) + seed_related(force)}


def ensure_seeded() -> None:
    """Seed only if the store is empty — used by `serve` in demo mode."""
    if not store.list_reviews():
        seed()
    if not store.list_items("claims"):
        seed_claims()
        seed_related()
    elif store.get(_ORG_ID, kind="orgs") is None:      # claims exist but pre-date the org model
        seed_org()
        for c in _CLAIMS:
            if store.get(c["id"], kind="claims") is not None:
                entities.backfill_alerts(c["id"])
        seed_related()
