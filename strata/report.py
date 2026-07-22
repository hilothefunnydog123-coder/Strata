"""Terminal rendering. ANSI colour, degrades to plain text off a TTY."""
from __future__ import annotations

import sys

_COLOR = sys.stdout.isatty()


def _c(code, s):
    return f"\033[{code}m{s}\033[0m" if _COLOR else s


_STRENGTH = {"high": "32", "moderate": "33", "low": "38;5;208",
             "very low": "31", "none": "2"}


def _strength_tag(strength: str) -> str:
    return _c(_STRENGTH.get(strength, "2"), f"[{strength.upper()} EVIDENCE]")


def render(result) -> str:
    out = [""]
    out.append(_c("1", "Q  ") + _c("1", result.question))
    out.append(_strength_tag(result.body.overall_strength))
    out.append("")
    out.append(result.answer)
    if not result.grounded and result.evidence:
        out.append("\n" + _c("2", "Sources:"))
        for i, e in enumerate(result.evidence, 1):
            g = e.grade
            tag = _c(_STRENGTH.get(g.strength, "2"), g.label)
            out.append(f"  [{i}] {tag} · {e.article.year or 'n.d.'}  {e.article.title}")
            out.append(_c("2", f"      {e.article.url}"))
    return "\n".join(out)
