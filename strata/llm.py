"""Optional AI layer. Provider-agnostic, free-tier friendly, and never the source of facts.

If you set an API key, Strata uses a language model to sharpen three things: parsing a claim
into searchable terms, judging whether a study supports or contradicts a claim, and writing
a plain-language synthesis. Without a key, everything falls back to the transparent heuristic
so the product always works.

Any OpenAI-compatible endpoint works. Free tiers that fit a pre-VC runway:

    # Groq (fast, generous free tier)
    export STRATA_LLM_BASE_URL=https://api.groq.com/openai/v1
    export STRATA_LLM_KEY=gsk_...           STRATA_LLM_MODEL=llama-3.3-70b-versatile
    # Google Gemini (OpenAI-compatible endpoint)
    export STRATA_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
    export STRATA_LLM_KEY=...                STRATA_LLM_MODEL=gemini-2.0-flash

The model only ever sees the claim and the public abstracts. It is instructed to judge, not
invent, and Strata records its verdict beside the transparent evidence grade. Patient / cohort
data is never sent here.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

_DEFAULT_BASE = "https://api.groq.com/openai/v1"
_DEFAULT_MODEL = "llama-3.3-70b-versatile"


def _key() -> str | None:
    return os.environ.get("STRATA_LLM_KEY") or os.environ.get("GROQ_API_KEY")


def available() -> bool:
    return bool(_key())


def _base() -> str:
    return os.environ.get("STRATA_LLM_BASE_URL", _DEFAULT_BASE).rstrip("/")


def _model() -> str:
    return os.environ.get("STRATA_LLM_MODEL", _DEFAULT_MODEL)


def _http_post(url: str, headers: dict, body: dict, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def chat(messages: list, *, temperature: float = 0.0, max_tokens: int = 400, _post=None) -> str:
    post = _post or _http_post
    data = post(_base() + "/chat/completions",
                {"Authorization": "Bearer " + (_key() or ""), "Content-Type": "application/json"},
                {"model": _model(), "messages": messages, "temperature": temperature,
                 "max_tokens": max_tokens})
    return (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()


def _json_from(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}


def classify_stance(claim: str, title: str, abstract: str, *, _post=None) -> dict | None:
    """Ask the model whether a study supports, contradicts, or is neutral toward the claim.
    Returns {stance, confidence, reason} or None on failure."""
    sys = ("You are a careful evidence appraiser. Given a CLAIM and a study (title + abstract), "
           "decide whether the study's findings SUPPORT, CONTRADICT, or are NEUTRAL toward the "
           "claim. Judge only from the text. Reply with strict JSON: "
           '{"stance":"support|contradict|neutral","confidence":0..1,"reason":"<=20 words"}.')
    user = f"CLAIM: {claim}\n\nSTUDY: {title}\n{abstract[:1400]}"
    try:
        out = _json_from(chat([{"role": "system", "content": sys},
                               {"role": "user", "content": user}], _post=_post))
    except Exception:
        return None
    st = str(out.get("stance", "")).lower()
    if st not in ("support", "contradict", "neutral"):
        return None
    try:
        conf = max(0.0, min(1.0, float(out.get("confidence", 0.6))))
    except (ValueError, TypeError):
        conf = 0.6
    return {"stance": st, "confidence": conf, "reason": str(out.get("reason", ""))[:120]}


def parse_claim(claim: str, *, _post=None) -> dict | None:
    """Turn a free-text claim into structured search terms + asserted direction."""
    sys = ("Extract the medical claim into JSON: "
           '{"intervention":"","outcome":"","population":"","direction":"reduces|increases|no effect",'
           '"search_terms":"a concise PubMed-style query"}. Judge only from the claim text.')
    try:
        out = _json_from(chat([{"role": "system", "content": sys},
                               {"role": "user", "content": claim}], _post=_post))
    except Exception:
        return None
    return out or None


def synthesize(claim: str, bullets: list, *, _post=None) -> str | None:
    """One short, plain-language paragraph grounded ONLY in the given evidence bullets."""
    sys = ("Summarize the evidence for a clinician in 2-3 sentences. Use ONLY the bullets given. "
           "Cite nothing not present. State the overall strength and the main caveat. No hype.")
    user = "CLAIM: " + claim + "\n\nEVIDENCE:\n" + "\n".join("- " + b for b in bullets[:12])
    try:
        return chat([{"role": "system", "content": sys}, {"role": "user", "content": user}],
                    max_tokens=220, _post=_post) or None
    except Exception:
        return None
