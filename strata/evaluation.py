"""Calibration & accuracy evaluation — the trust proof.

A company selling *evidence trust* has to measure its own accuracy and publish the number,
warts and all. This module holds an **open, labelled gold set** — claims paired with studies
whose correct stance (support / contradict / neutral) is unambiguous from the text, plus the
defensible overall status — and scores the engine against it: per-class precision / recall /
F1, a confusion matrix, and status accuracy.

The labels are grounded, not invented: a study reporting a *significant reduction* aligned
with a "reduces" claim is `support`; a *significant increase* is `contradict`; an explicit
*no significant difference* is `neutral`. Every case is checkable against the text in the set.

It scores the **transparent heuristic path only** (no model), so the reported number is the
floor an offline, zero-cost deployment achieves — an honest lower bound, run with
``strata eval`` or ``GET /v1/eval``. When a run underperforms, that is a finding to fix, not
a number to hide.
"""
from __future__ import annotations

from typing import Optional

from . import verify
from .pubmed import Article
from .review import _extract_effect

_CLASSES = ("support", "contradict", "neutral")


def _s(pmid, title, ptypes, abstract, year, gold):
    return {"pmid": pmid, "title": title, "ptypes": ptypes, "abstract": abstract,
            "year": year, "gold": gold}


# --------------------------------------------------------------------------- the gold set
# Each claim carries its studies with a labelled stance and a defensible overall status.
# Labels are determined by the text, not by what we wish the engine said.
GOLD = [
    {"claim": "Drug A reduces mortality", "status": "Supported", "studies": [
        _s("g1", "Drug A and mortality: a meta-analysis", ["Meta-Analysis"],
           "Across 18 trials, Drug A reduced mortality (hazard ratio 0.78, 95% CI 0.70 to 0.87).", 2023, "support"),
        _s("g2", "Randomized trial of Drug A", ["Randomized Controlled Trial"],
           "Drug A reduced death (hazard ratio 0.81, 95% CI 0.69 to 0.95) over 4 years.", 2022, "support"),
        _s("g3", "Drug A cohort study", ["Observational Study"],
           "Drug A was associated with lower mortality (adjusted hazard ratio 0.88, 95% CI 0.80 to 0.97).", 2021, "support"),
        _s("g4", "Drug A versus placebo: no mortality benefit", ["Randomized Controlled Trial"],
           "There was no significant difference in mortality (hazard ratio 1.02, 95% CI 0.88 to 1.18).", 2023, "neutral"),
    ]},
    {"claim": "Drug B reduces stroke", "status": "Mixed", "studies": [
        _s("g5", "Drug B and stroke: a meta-analysis", ["Meta-Analysis"],
           "Drug B reduced stroke (risk ratio 0.82, 95% CI 0.72 to 0.93).", 2022, "support"),
        _s("g6", "Drug B in high-risk adults: a randomized trial", ["Randomized Controlled Trial"],
           "Drug B lowered stroke incidence (hazard ratio 0.79, 95% CI 0.66 to 0.94).", 2021, "support"),
        _s("g7", "Drug B and stroke risk: a large cohort", ["Observational Study"],
           "Drug B was associated with increased stroke (hazard ratio 1.28, 95% CI 1.08 to 1.52).", 2024, "contradict"),
        _s("g8", "Drug B harms in the elderly: a cohort", ["Observational Study"],
           "Higher stroke risk was observed with Drug B (risk ratio 1.35, 95% CI 1.12 to 1.63).", 2023, "contradict"),
    ]},
    {"claim": "Supplement C prevents infection", "status": "Insufficient", "studies": [
        _s("g9", "Supplement C for infection: a small pilot", ["Randomized Controlled Trial"],
           "In 80 adults, infections were fewer with Supplement C, but the difference was not significant "
           "(risk ratio 0.85, 95% CI 0.63 to 1.15).", 2022, "neutral"),
        _s("g10", "Supplement C: a narrative review", ["Review"],
           "This review discusses the proposed immune effects of Supplement C.", 2020, "neutral"),
    ]},
    {"claim": "Therapy D increases bleeding", "status": "Supported", "studies": [
        _s("g11", "Therapy D and bleeding: a meta-analysis", ["Meta-Analysis"],
           "Therapy D increased major bleeding (risk ratio 1.44, 95% CI 1.22 to 1.70).", 2023, "support"),
        _s("g12", "Bleeding with Therapy D: a randomized trial", ["Randomized Controlled Trial"],
           "Major bleeding was more common with Therapy D (hazard ratio 1.52, 95% CI 1.20 to 1.93).", 2022, "support"),
        _s("g13", "Therapy D safety: no excess bleeding", ["Randomized Controlled Trial"],
           "There was no significant difference in bleeding (hazard ratio 1.05, 95% CI 0.86 to 1.28).", 2021, "neutral"),
    ]},
    {"claim": "Intervention E reduces hospitalization", "status": "Supported", "studies": [
        _s("g14", "Intervention E and hospitalization: pooled trials", ["Meta-Analysis"],
           "Intervention E reduced hospitalization (hazard ratio 0.71, 95% CI 0.63 to 0.80).", 2023, "support"),
        _s("g15", "Randomized trial of Intervention E", ["Randomized Controlled Trial"],
           "Hospitalization fell with Intervention E (hazard ratio 0.74, 95% CI 0.64 to 0.86).", 2022, "support"),
        _s("g16", "Intervention E did not reduce admissions", ["Randomized Controlled Trial"],
           "Intervention E did not reduce hospital admissions; no significant difference was seen.", 2021, "neutral"),
        _s("g17", "Worse outcomes with Intervention E: a cohort", ["Observational Study"],
           "Intervention E was associated with more hospitalizations (hazard ratio 1.22, 95% CI 1.04 to 1.43).", 2024, "contradict"),
    ]},
    {"claim": "Treatment F improves survival", "status": "Contradicted", "studies": [
        _s("g18", "Treatment F and survival: a meta-analysis", ["Meta-Analysis"],
           "Treatment F was associated with worse survival (hazard ratio 1.31, 95% CI 1.12 to 1.53).", 2023, "contradict"),
        _s("g19", "Randomized trial of Treatment F", ["Randomized Controlled Trial"],
           "Survival was shorter with Treatment F (hazard ratio 1.27, 95% CI 1.05 to 1.54).", 2022, "contradict"),
        _s("g20", "Treatment F: no survival difference", ["Randomized Controlled Trial"],
           "No significant difference in survival was observed (hazard ratio 0.98, 95% CI 0.83 to 1.16).", 2021, "neutral"),
    ]},
]


def _article(s: dict) -> Article:
    return Article(pmid=s["pmid"], title=s["title"], abstract=s["abstract"], journal="J Gold",
                   year=s["year"], authors=["Gold A"], publication_types=list(s["ptypes"]))


# --------------------------------------------------------------------------- stance scoring
def _predict_stance(claim: str, s: dict) -> str:
    text = f"{s['title']}. {s['abstract']}"
    eff = _extract_effect(text)
    return verify._stance(eff, verify._claim_direction(claim), text)


def _prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    return {"precision": round(p, 3), "recall": round(r, 3), "f1": round(f1, 3),
            "support": tp + fn}


def run_stance_eval() -> dict:
    confusion = {g: {p: 0 for p in _CLASSES} for g in _CLASSES}
    n = correct = 0
    for item in GOLD:
        for s in item["studies"]:
            gold, pred = s["gold"], _predict_stance(item["claim"], s)
            confusion[gold][pred] += 1
            n += 1
            correct += int(gold == pred)
    per_class = {}
    for c in _CLASSES:
        tp = confusion[c][c]
        fp = sum(confusion[g][c] for g in _CLASSES if g != c)
        fn = sum(confusion[c][p] for p in _CLASSES if p != c)
        per_class[c] = _prf(tp, fp, fn)
    macro_f1 = round(sum(per_class[c]["f1"] for c in _CLASSES) / len(_CLASSES), 3)
    return {"n": n, "accuracy": round(correct / n, 3) if n else 0.0,
            "macro_f1": macro_f1, "per_class": per_class, "confusion": confusion}


# --------------------------------------------------------------------------- status scoring
def run_status_eval(*, now: str = "2026-01-01T00:00:00+00:00", current_year: int = 2026) -> dict:
    n = correct = 0
    rows = []
    for item in GOLD:
        arts = [_article(s) for s in item["studies"]]
        r = verify.verify_claim(item["claim"], now=now, current_year=current_year,
                                _search=lambda q, retmax=40, _a=arts: list(_a))
        ok = (r.status == item["status"])
        rows.append({"claim": item["claim"], "gold": item["status"], "predicted": r.status,
                     "strength": r.strength, "correct": ok})
        n += 1
        correct += int(ok)
    return {"n": n, "accuracy": round(correct / n, 3) if n else 0.0, "rows": rows}


def run(*, verbose: bool = False) -> dict:
    stance = run_stance_eval()
    status = run_status_eval()
    report = {
        "gold_claims": len(GOLD),
        "gold_stance_labels": stance["n"],
        "stance_accuracy": stance["accuracy"],
        "stance_macro_f1": stance["macro_f1"],
        "status_accuracy": status["accuracy"],
        "per_class": stance["per_class"],
        "path": "heuristic (no model) — honest offline floor",
    }
    if verbose:
        report["confusion"] = stance["confusion"]
        report["status_rows"] = status["rows"]
    return report
