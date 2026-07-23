"""AI helpers, routed through the model abstraction layer (:mod:`strata.models`).

Each helper names a *task*; the router picks the right tier and falls back automatically.
Without a configured key, every helper returns None and the pipeline uses its transparent
heuristics. The model only ever sees the claim and public abstracts. It judges; it never
invents, and it never sees patient / cohort data.
"""
from __future__ import annotations

from . import models


def available() -> bool:
    return models.available()


def classify_stance(claim: str, title: str, abstract: str, *, _post=None) -> dict | None:
    """Does the study SUPPORT, CONTRADICT, or is it NEUTRAL toward the claim?"""
    sys = ("You are a careful evidence appraiser. Given a CLAIM and a study (title + abstract), "
           "decide whether the study SUPPORTS, CONTRADICTS, or is NEUTRAL toward the claim. "
           "Judge only from the text. Reply strict JSON: "
           '{"stance":"support|contradict|neutral","confidence":0..1,"reason":"<=20 words"}.')
    user = f"CLAIM: {claim}\n\nSTUDY: {title}\n{abstract[:1400]}"
    out, _ = models.run_json("study_classification",
                             [{"role": "system", "content": sys}, {"role": "user", "content": user}],
                             _post=_post)
    if not out or str(out.get("stance", "")).lower() not in ("support", "contradict", "neutral"):
        return None
    try:
        conf = max(0.0, min(1.0, float(out.get("confidence", 0.6))))
    except (ValueError, TypeError):
        conf = 0.6
    return {"stance": str(out["stance"]).lower(), "confidence": conf,
            "reason": str(out.get("reason", ""))[:120]}


def parse_claim(claim: str, *, _post=None) -> dict | None:
    """Structure a free-text claim into PICO + asserted direction + a search query."""
    sys = ("Extract the medical claim into JSON: "
           '{"population":"","intervention":"","comparator":"","outcome":"",'
           '"direction":"reduces|increases|no effect","search_terms":"concise PubMed-style query"}. '
           "Judge only from the claim text; leave a field empty if not stated.")
    out, _ = models.run_json("query_understanding",
                             [{"role": "system", "content": sys}, {"role": "user", "content": claim}],
                             _post=_post)
    return out or None


def expand_query(claim: str, *, _post=None) -> list | None:
    """Synonyms / MeSH-style alternates to broaden retrieval."""
    sys = ('Return JSON {"terms":["...","..."]} with up to 6 alternate search phrases '
           "(synonyms, drug classes, MeSH-like terms) for the claim. No commentary.")
    out, _ = models.run_json("query_expansion",
                             [{"role": "system", "content": sys}, {"role": "user", "content": claim}],
                             _post=_post)
    terms = (out or {}).get("terms")
    return [str(t) for t in terms][:6] if isinstance(terms, list) else None


def synthesize(claim: str, bullets: list, *, _post=None) -> str | None:
    """One short, plain-language paragraph grounded ONLY in the given evidence bullets."""
    sys = ("Summarize the evidence for a clinician in 2-3 sentences using ONLY the bullets given. "
           "State the overall strength and the main caveat. Cite nothing not present. No hype.")
    user = "CLAIM: " + claim + "\n\nEVIDENCE:\n" + "\n".join("- " + b for b in bullets[:12])
    text, _ = models.run("synthesis",
                         [{"role": "system", "content": sys}, {"role": "user", "content": user}],
                         max_tokens=220, _post=_post)
    return text
