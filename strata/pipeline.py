"""The evidence pipeline — the staged engine behind every verification.

One claim flows through explicit, auditable stages:

    understand -> expand -> retrieve -> dedup -> rank -> classify -> extract ->
    contradiction -> grade -> synthesize -> audit

Every stage appends to an ``audit_trail`` (what it did, how long it took), so every conclusion
traces back to the studies that produced it. ``stream()`` yields each stage as it completes for
progressive UIs; ``run()`` drains it to a finished :class:`~strata.receipt.Receipt`.

AI is optional and routed per task through :mod:`strata.models`; when no model is configured
the pipeline runs entirely on transparent heuristics. Nothing here fabricates precision: an
effect estimate is only emitted when a real one is found in the text, and it is labelled as a
heuristic extraction.
"""
from __future__ import annotations

import datetime as _dt
import re
import time
from typing import Callable, Optional

from . import assessment
from . import cohort as _cohort
from . import llm, models, sources, verify
from .evidence import grade, summarize_body
from .query import rank
from .receipt import CLAIM_STATUS, Receipt
from .review import _extract_effect, _first_sentences

_ORDER = ["very low", "low", "moderate", "high"]


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _pico(claim: str, provided: Optional[dict], use_llm: bool) -> tuple[dict, list]:
    """Heuristic PICO, optionally refined by a model. Returns (pico, models_used)."""
    m = re.search(r"(.+?)\b(reduces?|increases?|prevents?|improves?|lowers?|raises?|causes?|"
                  r"worsens?|treats?|is effective for|is associated with)\b(.+)", claim, re.I)
    inter = out = pop = ""
    if m:
        inter = m.group(1).strip()
        out = re.sub(r"\bin (patients|adults|people|those|women|men|children)\b.*", "",
                     m.group(3), flags=re.I).strip(" .")
    pm = re.search(r"\bin ([^.,]*?(?:patients|adults|people|children|women|men|elderly|"
                   r"over \d+|aged[^.,]*))", claim, re.I)
    if pm:
        pop = pm.group(1).strip()
    direction = "reduces" if verify._claim_direction(claim) == "down" else "increases"
    pico = {"population": pop, "intervention": inter, "comparator": "", "outcome": out,
            "direction": direction}
    used = []
    if use_llm:
        refined = llm.parse_claim(claim)
        if refined:
            used.append("query_understanding")
            for k in ("population", "intervention", "comparator", "outcome"):
                if not pico.get(k) and refined.get(k):
                    pico[k] = str(refined[k])
    if provided:                                    # caller-supplied PICO always wins
        for k, v in provided.items():
            if v:
                pico[k] = v
    return pico, used


def _confidence(status, strength, aligned_n, sup_w, con_w, recent_frac) -> float:
    if status == "Insufficient":
        return round(min(0.35, 0.10 + 0.05 * aligned_n), 2)
    if status == "Unsupported":
        return 0.1
    base = {"high": 0.9, "moderate": 0.72, "low": 0.5, "very low": 0.3, "none": 0.15}.get(strength, 0.4)
    qty = min(1.0, aligned_n / 5.0)
    agree = (max(sup_w, con_w) / (sup_w + con_w)) if (sup_w + con_w) > 0 else 0.5
    conf = base * (0.55 + 0.25 * qty + 0.20 * agree) * (0.85 + 0.15 * recent_frac)
    return round(max(0.05, min(0.97, conf)), 2)


def stream(claim: str, *, pico: Optional[dict] = None, context: Optional[dict] = None,
           current_year: Optional[int] = None, retmax: int = 40, consider: int = 18,
           now: Optional[str] = None, use_llm: Optional[bool] = None,
           _search: Optional[Callable] = None):
    """Generator yielding a dict per stage; the final event is {'stage':'done','receipt':{...}}."""
    t0 = time.perf_counter()
    audit, models_used = [], []
    current_year = current_year or _dt.date.today().year
    now = now or _now()
    search = _search or sources.search_all
    ai = (llm.available() if use_llm is None else use_llm)

    def stage(name, detail, **extra):
        rec = {"stage": name, "detail": detail, "ms": int((time.perf_counter() - t0) * 1000), **extra}
        audit.append(rec)
        return {"type": "stage", **rec}

    # 1 understand
    claim_dir = verify._claim_direction(claim)
    pico_obj, u = _pico(claim, pico, ai)
    models_used += u
    yield stage("understand", f"Parsed claim. Intervention: {pico_obj.get('intervention') or 'n/a'}; "
                              f"outcome: {pico_obj.get('outcome') or 'n/a'}.", pico=pico_obj)

    # 2 expand
    query = verify._query(claim)
    expansions = llm.expand_query(claim) if ai else None
    if expansions:
        models_used.append("query_expansion")
    yield stage("expand", f"Search query built{' + ' + str(len(expansions)) + ' expansion terms' if expansions else ''}.",
                query=query, expansions=expansions or [])

    # 3 retrieve
    articles = search(query, retmax=retmax)
    breakdown = sources.source_breakdown(articles)
    yield stage("retrieve", f"Retrieved {len(articles)} records across {len(breakdown)} sources.",
                sources=breakdown, count=len(articles))

    # 4 dedup (search_all dedupes internally; report the surviving set)
    yield stage("dedup", f"{len(articles)} unique records after de-duplication by DOI/PMID/title.",
                count=len(articles))

    # 5 rank
    graded = [(a, grade(a, current_year)) for a in articles]
    ranked = rank([a for a, _ in graded], [g for _, g in graded], current_year)[:consider]
    yield stage("rank", f"Ranked by evidence level, recency and citations; considering top {len(ranked)}.",
                count=len(ranked))

    # 6 classify (study designs)
    design_counts = {}
    for e in ranked:
        design_counts[e.grade.label] = design_counts.get(e.grade.label, 0) + 1
    yield stage("classify", "Classified study designs on the evidence pyramid.", designs=design_counts)

    # 7 extract (effect sizes)
    effect_estimates = []
    items = []
    for e in ranked:
        a, g = e.article, e.grade
        eff = _extract_effect(f"{a.title}. {a.abstract}")
        items.append([a, g, None, eff])
        if eff and eff.get("value") is not None:
            effect_estimates.append({"measure": eff["measure"], "value": eff["value"],
                                     "ci_low": eff["ci_low"], "ci_high": eff["ci_high"],
                                     "direction": eff["direction"], "significant": eff["significant"],
                                     "year": a.year, "label": g.label, "source": a.source,
                                     "title": a.title})
    yield stage("extract", f"Extracted {len(effect_estimates)} numeric effect estimates (heuristic).",
                effects=len(effect_estimates))

    # 8 contradiction (stance)
    by_stance = {"support": [], "contradict": [], "neutral": []}
    sup_w = con_w = 0.0
    ai_calls = 0
    for it in items:
        a, g, _, eff = it
        st = verify._stance(eff, claim_dir, f"{a.title}. {a.abstract}")
        if ai and st == "neutral" and a.abstract and ai_calls < 8:
            ai_calls += 1
            v = llm.classify_stance(claim, a.title, a.abstract)
            if v and v["confidence"] >= 0.6 and v["stance"] != "neutral":
                st = v["stance"]
                if "study_classification" not in models_used:
                    models_used.append("study_classification")
        it[2] = st
        by_stance[st].append(g)
        w = verify._weight(g.level, eff, a.cited_by)
        if st == "support":
            sup_w += w
        elif st == "contradict":
            con_w += w
    sup, con, neu = len(by_stance["support"]), len(by_stance["contradict"]), len(by_stance["neutral"])
    support_items = [it for it in items if it[2] == "support"]
    contradict_items = [it for it in items if it[2] == "contradict"]
    contra = assessment.contradiction_analysis(support_items, contradict_items)
    _detail = (f"{sup} supporting, {con} contradicting, {neu} neutral."
               + (f" Disagreement explained by {len(contra['reasons'])} factor(s)." if contra.get("reasons") else ""))
    yield stage("contradiction", _detail, supporting=sup, contradicting=con, neutral=neu,
                reasons=[r["factor"] for r in contra.get("reasons", [])])

    # 9 grade (status, strength, confidence)
    status, strength = verify._status_and_strength(sup_w, con_w, sup, con, by_stance, len(items))
    aligned = [it for it in items if it[2] == ("contradict" if status == "Contradicted" else "support")]
    recent = [a for a, g, s, e in aligned if a.year and (current_year - a.year) <= 10]
    recent_frac = (len(recent) / len(aligned)) if aligned else 0.0
    confidence = _confidence(status, strength, len(aligned), sup_w, con_w, recent_frac)
    claim_status = CLAIM_STATUS.get(status, "INSUFFICIENT")
    if status == "Supported" and strength in ("low", "very low"):
        claim_status = "PARTIALLY_SUPPORTED"
    rationale = assessment.strength_rationale(items, status, strength, current_year,
                                              pico=pico_obj, supporting=sup, contradicting=con)
    yield stage("grade", f"{claim_status} at {strength} certainty (confidence {confidence}). {rationale['summary']}",
                claim_status=claim_status, strength=strength, confidence=confidence,
                rationale=rationale)

    # 10 synthesize (optional)
    synthesis = None
    if ai and items:
        bullets = [f"{g.label} ({a.year or 'n.d.'}): {(_first_sentences(a.abstract) or a.title)[:180]}"
                   for a, g, s, e in items[:8]]
        synthesis = llm.synthesize(claim, bullets)
        if synthesis:
            models_used.append("synthesis")
    yield stage("synthesize", "Wrote plain-language synthesis." if synthesis else "Synthesis skipped (no model).")

    # 11 audit / assemble
    top = min(aligned or items, key=lambda it: it[1].level, default=None)
    highest = None
    if top:
        a, g = top[0], top[1]
        highest = {"pmid": a.pmid, "title": a.title, "year": a.year, "url": a.url,
                   "label": g.label, "level": g.level, "strength": g.strength, "source": a.source}
    citations = [{
        "n": i, "pmid": a.pmid, "title": a.title, "year": a.year, "url": a.url,
        "level": g.level, "label": g.label, "strength": g.strength, "stance": st,
        "source": a.source, "cited_by": a.cited_by, "doi": a.doi,
        "snippet": _first_sentences(a.abstract) or "(no abstract)", "effect": eff,
    } for i, (a, g, st, eff) in enumerate(items[:10], 1)]
    pop_note = _cohort.population_note(context, citations) if context else None
    pop_limits = [pop_note] if pop_note else []
    yield stage("audit", f"Assembled {len(citations)} cited sources; every conclusion is traceable.",
                citations=len(citations))

    receipt = Receipt(
        receipt_id=verify.receipt_id(claim), claim=claim.strip(), status=status, strength=strength,
        supporting=sup, contradicting=con, neutral=neu, total=len(items), checked=now,
        highest_evidence=highest, key_limitation=verify._limitation(items, status),
        citations=citations, query=query, sources=breakdown, population_note=pop_note,
        synthesis=synthesis, claim_status=claim_status, confidence=confidence, pico=pico_obj,
        effect_estimates=effect_estimates, strength_rationale=rationale, contradiction=contra,
        population_limitations=pop_limits,
        audit_trail=audit, models_used=sorted(set(models_used)),
        elapsed_ms=int((time.perf_counter() - t0) * 1000))
    yield {"type": "done", "receipt": receipt.to_dict(), "_receipt": receipt}


def run(claim: str, **kw) -> Receipt:
    """Drain the pipeline to a finished Receipt."""
    last = None
    for ev in stream(claim, **kw):
        last = ev
    return last["_receipt"]
