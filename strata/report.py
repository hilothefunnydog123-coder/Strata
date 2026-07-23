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


_STATUS_COLOR = {"supported": "32", "partially_supported": "33", "contested": "35",
                 "unsupported": "31", "insufficient_evidence": "2"}
_TREND = {"strengthening": "↑ strengthening", "weakening": "↓ weakening",
          "stable": "→ stable", "new": "• new"}


def render_verdict(verdict) -> str:
    """Terminal rendering of a Strata Verify verdict — the full evidence trail."""
    v = verdict
    out = [""]
    out.append(_c("1", "CLAIM  ") + _c("1", v.question))
    status_tag = _c(_STATUS_COLOR.get(v.status, "2"), f"[{v.status.upper().replace('_', ' ')}]")
    strength_tag = _c(_STRENGTH.get(v.evidence_strength, "2"),
                      f"{v.evidence_strength.upper()} CERTAINTY")
    out.append(f"{status_tag}  {strength_tag}")
    out.append("")
    out.append(v.answer)
    out.append("")
    out.append(_c("2", "Evidence trail:"))
    for l in v.lines:
        mark = {"supporting": _c("32", "▲ supports"),
                "contradicting": _c("31", "▼ contradicts")}.get(l.stance, _c("2", "· context"))
        out.append(f"  [{l.n}] {mark}  {l.grade.label} · {l.article.year or 'n.d.'}")
        out.append(f"       {l.article.title}")
        if l.article.url:
            out.append(_c("2", f"       {l.article.url}"))
    return "\n".join(out)
