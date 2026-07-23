"""Question understanding — PICO structuring and query expansion.

A clinical question is turned into a structured representation before it ever
touches a search API:

    Population   who?      (e.g. adults over 65 with heart failure)
    Intervention what?     (e.g. Treatment X)
    Comparator   vs what?  (e.g. standard care / placebo)
    Outcome      measuring what?  (e.g. hospitalization)

Retrieval quality caps everything downstream, so the raw question is expanded
into a broader query with light, well-known synonyms rather than passed through
verbatim. Extraction is deterministic and provenance-tagged; if a model is
registered for the ``expand`` task it can refine the structure, and that is
labelled ``inferred``. Nothing here invents clinical facts — it only restructures
the user's own words.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .extract import _population
from .models import ModelRouter

# small, conservative synonym expansions for common clinical terms
_SYNONYMS = {
    "heart failure": ["cardiac failure", "congestive heart failure"],
    "myocardial infarction": ["heart attack"],
    "mortality": ["death", "survival"],
    "hospitalization": ["hospitalisation", "hospital admission"],
    "cardiovascular": ["cardiac", "coronary"],
    "diabetes": ["diabetes mellitus", "type 2 diabetes"],
    "cancer": ["carcinoma", "neoplasm", "tumour", "tumor"],
    "stroke": ["cerebrovascular"],
    "elderly": ["older adults", "aged"],
}

_STOP = {"does", "do", "is", "are", "can", "the", "a", "an", "of", "in", "on", "for",
         "with", "and", "or", "to", "reduce", "reduces", "prevent", "prevents",
         "improve", "improves", "affect", "affects", "lower", "lowers", "patients",
         "people", "risk", "effect", "efficacy", "treatment", "among", "versus", "vs"}


@dataclass
class PICO:
    raw: str
    population: Dict[str, Any] = field(default_factory=dict)
    intervention: Dict[str, Any] = field(default_factory=dict)
    comparator: Dict[str, Any] = field(default_factory=dict)
    outcome: Dict[str, Any] = field(default_factory=dict)
    confident: bool = False

    def as_dict(self) -> Dict[str, Any]:
        return {"raw": self.raw, "population": self.population,
                "intervention": self.intervention, "comparator": self.comparator,
                "outcome": self.outcome, "confident": self.confident}


def _first(pattern: str, text: str, group: int = 1) -> Optional[str]:
    m = re.search(pattern, text, re.I)
    return m.group(group).strip(" ?.") if m else None


def structure(question: str, *, router: Optional[ModelRouter] = None) -> PICO:
    """Parse a clinical question into a PICO structure (deterministic core)."""
    q = question.strip()
    pico = PICO(raw=q)

    # Intervention: "does X ...", "effect/efficacy of X", "X reduces/prevents ..."
    interv = (_first(r"\b(?:effect|efficacy|impact|role|benefit)s?\s+of\s+([a-z0-9\- ]{2,40}?)"
                     r"\s+(?:on|in|for|reduce|prevent|improve|versus|vs|compared)", q)
              or _first(r"\bdoes\s+([a-z0-9\- ]{2,40}?)\s+"
                        r"(?:reduce|prevent|improve|lower|affect|increase|cause|help)", q)
              or _first(r"^([A-Z][a-z0-9\- ]{2,40}?)\s+"
                        r"(?:reduce|prevent|improve|lower|affect|increase|cause)s?\b", q))

    # Outcome: after the effect verb, or after "risk of" / "on"
    outcome = (_first(r"\b(?:reduce|prevent|improve|lower|affect|increase|cause)s?\s+"
                      r"(?:the\s+)?(?:risk of\s+)?([a-z0-9\- ]{3,40}?)\b(?:\s+in\b|\s+among\b|\?|$)", q)
               or _first(r"\brisk of\s+([a-z0-9\- ]{3,40})", q))

    # Population: "in/among patients with ...", plus structured age/terms
    pop_phrase = (_first(r"\b(?:in|among|for)\s+((?:patients|adults|children|women|men|"
                         r"people|individuals|the elderly)[a-z0-9\- ,]{0,50})", q)
                  or _first(r"\b(?:in|among|for)\s+([a-z0-9\- ]{3,40}?\s+patients)", q))
    pop_struct = _population(q) or {}

    # Comparator: "versus/vs/compared to X", else a sensible default
    comp = _first(r"\b(?:versus|vs\.?|compared (?:to|with))\s+([a-z0-9\- ]{2,40})", q)

    pico.intervention = {"value": interv or "", "provenance": "heuristic" if interv else "none"}
    pico.outcome = {"value": outcome or "", "provenance": "heuristic" if outcome else "none"}
    pico.population = {"value": pop_phrase or "",
                       "terms": pop_struct.get("terms", []),
                       "age_min": pop_struct.get("age_min"),
                       "age_max": pop_struct.get("age_max"),
                       "provenance": "heuristic" if (pop_phrase or pop_struct) else "none"}
    pico.comparator = {"value": comp or "standard care or placebo",
                       "provenance": "heuristic" if comp else "default"}
    pico.confident = bool(interv and outcome)

    # Optional model refinement (labelled 'inferred', never trusted for facts).
    if router is not None and router.has("expand"):
        _model_refine(pico, router)
    return pico


def _model_refine(pico: PICO, router: ModelRouter) -> None:
    prompt = ("Extract the PICO of this clinical question as strict JSON with keys "
              "population, intervention, comparator, outcome (strings). "
              "Do not add facts. Question: " + pico.raw)
    out = router.generate("expand", prompt)
    if not out:
        return
    try:
        data = json.loads(out[out.find("{"): out.rfind("}") + 1])
    except (ValueError, TypeError):
        return
    for key in ("population", "intervention", "comparator", "outcome"):
        val = data.get(key)
        if val and not getattr(pico, key).get("value"):
            slot = getattr(pico, key)
            if key == "population":
                slot["value"] = val
            else:
                setattr(pico, key, {"value": val, "provenance": "inferred"})
    pico.confident = bool(pico.intervention.get("value") and pico.outcome.get("value"))


def _keyify(phrase: str) -> List[str]:
    words = [w for w in re.split(r"[^a-z0-9]+", (phrase or "").lower()) if w and w not in _STOP]
    return words


def expand_query(pico: PICO) -> Dict[str, Any]:
    """Build an expanded search query from the PICO (additive, recall-first)."""
    notes: List[str] = []
    blocks: List[str] = []
    used_terms: List[str] = []

    def block_for(phrase: str) -> Optional[str]:
        phrase = (phrase or "").strip()
        if not phrase:
            return None
        variants = [phrase]
        low = phrase.lower()
        for base, syns in _SYNONYMS.items():
            if base in low:
                variants += syns
                notes.append(f"expanded '{base}' with {len(syns)} synonym(s)")
        variants = list(dict.fromkeys(v for v in variants if v))
        used_terms.extend(variants)
        return "(" + " OR ".join(f'"{v}"' if " " in v else v for v in variants) + ")"

    for phrase in (pico.intervention.get("value"), pico.outcome.get("value"),
                   pico.population.get("value")):
        b = block_for(phrase)
        if b:
            blocks.append(b)

    if len(blocks) >= 2:
        query = " AND ".join(blocks)
    else:
        # not confident enough to constrain — fall back to the raw question so we
        # don't silently tank recall with a half-built boolean query
        query = pico.raw
        notes.append("PICO extraction was low-confidence; used the raw question for recall")

    return {"query": query, "terms": used_terms, "notes": notes}
