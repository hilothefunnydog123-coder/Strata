"""Model abstraction layer.

Every AI-assisted step in the pipeline names a *task*, not a model. A task routes to a tier,
and each tier resolves to a concrete model with a fallback chain: primary -> free -> local ->
none. Cheap tasks never touch an expensive model, and any provider can be swapped by editing
config, not code.

Configuration (all optional; unset => the pipeline runs on transparent heuristics only):

    STRATA_LLM_KEY / STRATA_LLM_BASE_URL / STRATA_LLM_MODEL     primary (e.g. Groq llama-3.3-70b)
    STRATA_LLM_FREE_MODEL                                        cheap/fast model for light tasks
    STRATA_LOCAL_BASE_URL / STRATA_LOCAL_MODEL                   local fallback (Ollama, vLLM)
    STRATA_TASK_<TASK>=<tier>                                    override a task's tier

Tiers: ``reason`` (hard synthesis / contradiction), ``fast`` (classification / expansion),
``local`` (offline fallback). Tasks are graded so a token budget is spent where it matters.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

# task -> default tier. Hard reasoning gets the strong model; mechanical work gets the cheap one.
TASK_TIER = {
    "query_understanding": "fast",
    "query_expansion": "fast",
    "study_classification": "fast",
    "evidence_extraction": "reason",
    "contradiction_detection": "reason",
    "synthesis": "reason",
}


def _env(*names, default=None):
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    return default


def _tiers() -> dict:
    """Resolve each tier to (base_url, key, model) from the environment."""
    key = _env("STRATA_LLM_KEY", "GROQ_API_KEY")
    base = _env("STRATA_LLM_BASE_URL", default="https://api.groq.com/openai/v1")
    strong = _env("STRATA_LLM_MODEL", default="llama-3.3-70b-versatile")
    fast = _env("STRATA_LLM_FREE_MODEL", default="llama-3.1-8b-instant")
    return {
        "reason": {"base": base, "key": key, "model": strong},
        "fast": {"base": base, "key": key, "model": fast},
        "local": {"base": _env("STRATA_LOCAL_BASE_URL", default="http://127.0.0.1:11434/v1"),
                  "key": _env("STRATA_LOCAL_KEY", default="local"),
                  "model": _env("STRATA_LOCAL_MODEL", default="llama3.1")},
    }


def tier_for(task: str) -> str:
    return os.environ.get("STRATA_TASK_" + task.upper()) or TASK_TIER.get(task, "fast")


def available() -> bool:
    """True when at least one non-local tier has a key configured."""
    return bool(_env("STRATA_LLM_KEY", "GROQ_API_KEY"))


def _fallback_chain(task: str) -> list:
    """Ordered list of concrete tier configs to try for a task."""
    tiers = _tiers()
    order, seen = [], set()
    for name in (tier_for(task), "fast", "reason", "local"):
        cfg = tiers.get(name)
        if cfg and cfg["model"] and (name, cfg["model"]) not in seen and (cfg["key"] or name == "local"):
            order.append((name, cfg))
            seen.add((name, cfg["model"]))
    return order


def _http_post(url: str, headers: dict, body: dict, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def run(task: str, messages: list, *, temperature: float = 0.0, max_tokens: int = 400,
        _post=None) -> tuple[str, str] | tuple[None, None]:
    """Execute a task down its fallback chain. Returns (text, model_used) or (None, None)."""
    post = _post or _http_post
    for name, cfg in _fallback_chain(task):
        try:
            data = post(cfg["base"].rstrip("/") + "/chat/completions",
                        {"Authorization": "Bearer " + (cfg["key"] or ""), "Content-Type": "application/json"},
                        {"model": cfg["model"], "messages": messages,
                         "temperature": temperature, "max_tokens": max_tokens})
            text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
            if text:
                return text, f"{name}:{cfg['model']}"
        except Exception:
            continue                      # fail soft, try the next model in the chain
    return None, None


def run_json(task: str, messages: list, *, _post=None, **kw) -> tuple[dict, str] | tuple[None, None]:
    text, used = run(task, messages, _post=_post, **kw)
    if not text:
        return None, None
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None, used
    try:
        return json.loads(m.group(0)), used
    except json.JSONDecodeError:
        return None, used


def status() -> dict:
    tiers = _tiers()
    return {"available": available(),
            "tiers": {k: {"model": v["model"], "configured": bool(v["key"]) or k == "local"}
                      for k, v in tiers.items()},
            "routing": {t: tier_for(t) for t in TASK_TIER}}
