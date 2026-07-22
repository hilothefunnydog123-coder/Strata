"""Turning ranked evidence into an answer.

Two modes, both anchored to the retrieved papers:

* ``digest`` — no model required. A structured, grounded summary: the evidence
  verdict, then each top paper with its grade and the key line of its abstract.
* ``narrative`` — pass any text-in/text-out model. It is instructed to answer
  ONLY from the numbered abstracts, cite inline, and admit when the evidence does
  not settle the question. The model summarises; it is never the source of fact.
"""
from __future__ import annotations

from typing import Callable, TYPE_CHECKING

if TYPE_CHECKING:
    from .evidence import BodyAssessment
    from .query import Evidence


def _first_sentences(text: str, n: int = 2) -> str:
    import re
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return " ".join(parts[:n]).strip()


def digest(question: str, ranked: list, body) -> str:
    if not ranked:
        return ("No studies were retrieved for this question. Try broadening the "
                "terms — and treat the absence of evidence as exactly that.")
    lines = [f"Evidence verdict: {body.summary}", ""]
    for i, e in enumerate(ranked, 1):
        a, g = e.article, e.grade
        key = _first_sentences(a.abstract) or "(no abstract available)"
        lines.append(f"[{i}] {g.label} · {g.strength} evidence · {a.year or 'n.d.'}"
                     + ("  · practice guideline" if g.is_guideline else ""))
        lines.append(f"    {a.title}")
        lines.append(f"    {key}")
        lines.append(f"    {a.url}")
        lines.append("")
    lines.append("This is a grounded digest of the strongest retrieved evidence, "
                 "not medical advice. Read the primary sources before acting.")
    return "\n".join(lines)


def _build_prompt(question: str, ranked: list, body) -> str:
    sources = []
    for i, e in enumerate(ranked, 1):
        a, g = e.article, e.grade
        sources.append(f"[{i}] ({g.label}, {g.strength} evidence, {a.year or 'n.d.'}) "
                       f"{a.title}\n{a.abstract[:1500]}")
    joined = "\n\n".join(sources)
    return (
        "You are a careful medical-evidence assistant for clinicians. Answer the "
        "question USING ONLY the numbered sources below. Rules:\n"
        "- Cite every claim inline with its source number, e.g. [2].\n"
        "- If the sources disagree, say so. If they do not answer the question, say "
        "that plainly — do not fill the gap from your own knowledge.\n"
        "- Weight higher-quality evidence (meta-analyses, RCTs) above weaker designs.\n"
        "- End with one sentence on the overall strength of the evidence.\n"
        "- Be concise. This is decision support, not advice, and not a substitute "
        "for reading the sources.\n\n"
        f"EVIDENCE STRENGTH (computed): {body.summary}\n\n"
        f"QUESTION: {question}\n\nSOURCES:\n{joined}\n\nANSWER:"
    )


def narrative(question: str, ranked: list, body, generate: Callable[[str], str]) -> str:
    if not ranked:
        return digest(question, ranked, body)
    try:
        text = generate(_build_prompt(question, ranked, body)).strip()
    except Exception as exc:
        return f"(model synthesis failed: {exc})\n\n" + digest(question, ranked, body)
    return text + f"\n\n— Evidence strength: {body.summary}"
