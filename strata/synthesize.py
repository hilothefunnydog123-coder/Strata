"""Turning ranked evidence into an answer.

Two modes, both anchored to the retrieved papers.

``digest`` — no model, no API key, no network beyond PubMed. A structured
summary: the certainty verdict, whether the papers agree, an indicative pooled
estimate where one is defensible, then each source with its grade and the line of
its abstract that carries the finding. Every sentence is either a fact from a
retrieved abstract or a statement Strata computed about those abstracts.

``narrative`` — pass any text-in/text-out model. It receives *only* the numbered
abstracts and is instructed to cite inline, to weight higher-quality designs
above weaker ones, and to say plainly when the sources do not settle the
question. The prompt tells it what Strata already computed — the certainty
grade, the consensus, the pooled estimate — so the model is summarising a
completed appraisal rather than performing one.

The model is never the source of a fact. If it fails, the digest is returned
instead, with the failure stated rather than hidden.
"""
from __future__ import annotations

import re
from typing import Callable

DISCLAIMER = ("This is a grounded digest of the strongest retrieved evidence, "
              "not medical advice. Read the primary sources before acting.")

_SENTENCE = re.compile(r"(?<=[.!?])\s+")

# Where the finding usually lives in a structured abstract.
_FINDING_SECTION = re.compile(
    r"\b(RESULTS?|FINDINGS?|CONCLUSIONS?|INTERPRETATION)\s*:", re.I)


_SAFEGUARD_NAME = {"randomised": "random allocation", "blinded": "blinding",
                   "registered": "prospective registration",
                   "itt": "intention-to-treat analysis",
                   "powered": "an a priori power calculation",
                   "confounding_adjusted": "adjustment for confounding"}


def _safeguards(keys) -> str:
    return ", ".join(_SAFEGUARD_NAME.get(k, k) for k in keys)


def first_sentences(text: str, n: int = 2) -> str:
    parts = _SENTENCE.split((text or "").strip())
    return " ".join(parts[:n]).strip()


def key_finding(text: str, n: int = 2) -> str:
    """The sentences that state the result, not the ones that set up the study.

    An abstract's first two sentences are almost always background. If the
    abstract is structured, jump to RESULTS or CONCLUSIONS; otherwise fall back
    to a sentence containing an effect estimate, and only then to the opening.
    """
    if not text:
        return ""
    m = None
    for m in _FINDING_SECTION.finditer(text):
        pass                                    # take the last such heading
    if m:
        return first_sentences(text[m.end():], n)

    for sentence in _SENTENCE.split(text):
        if re.search(r"\b(?:95%\s*CI|p\s*[<=>]|hazard ratio|odds ratio|risk ratio)\b",
                     sentence, re.I):
            return sentence.strip()
    return first_sentences(text, n)


# ------------------------------------------------------------------- digest

def digest(question: str, ranked: list, body, *, consensus=None,
           pooled=None) -> str:
    if not ranked:
        return ("No studies were retrieved for this question. Try broadening the "
                "terms — and treat the absence of evidence as exactly that: "
                "an absence of retrieved evidence, not evidence of absence.")

    lines = [f"Evidence verdict: {body.summary}"]

    for caveat in body.caveats:
        lines.append(f"  ! {caveat}")

    if consensus is not None and consensus.direction != "insufficient":
        lines.append("")
        lines.append(f"Consensus: {consensus.summary}")

    if pooled is not None:
        lines.append("")
        lines.append(f"Indicative pooling: {pooled.format()}, "
                     f"{'excluding' if pooled.excludes_null else 'including'} "
                     f"no effect.")
        lines.append("  Not a systematic review — these are the papers one search "
                     "returned, pooled for orientation only.")

    lines.append("")
    for i, e in enumerate(ranked, 1):
        a, g = e.article, e.grade
        header = f"[{i}] {g.label} · {g.strength} certainty · {a.year or 'n.d.'}"
        if g.is_guideline:
            header += " · practice guideline"
        if g.retracted:
            header += "  ** RETRACTED **"
        elif g.concern:
            header += "  ** expression of concern **"
        lines.append(header)
        lines.append(f"    {a.title}")
        finding = key_finding(a.abstract) or "(no abstract available)"
        lines.append(f"    {finding}")

        detail = []
        if g.effect is not None:
            detail.append(g.effect.format())
        if g.sample_size:
            detail.append(f"n = {g.sample_size:,}")
        if g.safeguards:
            detail.append("reports " + _safeguards(g.safeguards))
        if detail:
            lines.append(f"    {' · '.join(detail)}")

        for d in g.downgrades:
            lines.append(f"    ↓ {d.name.lower()}: {d.reason}")
        for d in g.upgrades:
            lines.append(f"    ↑ {d.name.lower()}: {d.reason}")

        lines.append(f"    {a.url}")
        lines.append("")

    lines.append(DISCLAIMER)
    return "\n".join(lines)


# ---------------------------------------------------------------- narrative

def build_prompt(question: str, ranked: list, body, *, consensus=None,
                 pooled=None) -> str:
    """Assemble the model prompt. Exposed so callers can inspect exactly what
    would be sent before sending it."""
    sources = []
    for i, e in enumerate(ranked, 1):
        a, g = e.article, e.grade
        tags = [g.label, f"{g.strength} certainty", str(a.year or "n.d.")]
        if g.is_guideline:
            tags.append("practice guideline")
        if g.sample_size:
            tags.append(f"n={g.sample_size:,}")
        if g.effect is not None:
            tags.append(g.effect.format())
        if g.retracted:
            tags.append("RETRACTED")
        sources.append(f"[{i}] ({'; '.join(tags)}) {a.title}\n"
                       f"{a.abstract[:1600]}")

    computed = [f"Certainty of the body of evidence: {body.summary}"]
    for c in body.caveats:
        computed.append(f"Caveat: {c}")
    if consensus is not None and consensus.direction != "insufficient":
        computed.append(f"Consensus across the sources: {consensus.summary}")
    if pooled is not None:
        computed.append(f"Indicative pooled estimate: {pooled.format()}")

    return (
        "You are a careful medical-evidence assistant writing for clinicians. "
        "Answer the question USING ONLY the numbered sources below.\n\n"
        "Rules:\n"
        "- Cite every claim inline with its source number, e.g. [2].\n"
        "- Weight higher-quality designs above weaker ones. A meta-analysis and "
        "a case report are not two opinions.\n"
        "- If the sources disagree, say so and say which are stronger. If they do "
        "not answer the question, say that plainly — do not fill the gap from "
        "your own knowledge.\n"
        "- Never cite a source marked RETRACTED as support. Mention it only to "
        "note that it has been retracted.\n"
        "- Do not introduce numbers, effect sizes or study names that are not in "
        "the sources.\n"
        "- End with one sentence on the overall certainty of the evidence.\n"
        "- Be concise. This is decision support, not advice, and not a "
        "substitute for reading the sources.\n\n"
        "ALREADY COMPUTED BY THE TOOL (do not contradict; you may restate):\n"
        + "\n".join(computed) + "\n\n"
        f"QUESTION: {question}\n\nSOURCES:\n" + "\n\n".join(sources) + "\n\nANSWER:")


def narrative(question: str, ranked: list, body,
              generate: Callable[[str], str], *, consensus=None,
              pooled=None) -> str:
    if not ranked:
        return digest(question, ranked, body, consensus=consensus, pooled=pooled)
    prompt = build_prompt(question, ranked, body, consensus=consensus, pooled=pooled)
    try:
        text = (generate(prompt) or "").strip()
    except Exception as exc:
        return (f"(model synthesis failed: {exc} — falling back to the grounded "
                f"digest)\n\n"
                + digest(question, ranked, body, consensus=consensus, pooled=pooled))
    if not text:
        return digest(question, ranked, body, consensus=consensus, pooled=pooled)

    footer = [f"— Evidence certainty: {body.summary}"]
    if consensus is not None and consensus.direction != "insufficient":
        footer.append(f"— Consensus: {consensus.summary}")
    uncited = _uncited_warning(text, len(ranked))
    if uncited:
        footer.append(uncited)
    return text + "\n\n" + "\n".join(footer)


def _uncited_warning(text: str, n_sources: int) -> str:
    """Flag a narrative that cites nothing, or cites a source that does not exist.

    A model that answers without citations has almost certainly answered from its
    own weights, which is the failure mode this whole tool exists to prevent.
    """
    cited = {int(m) for m in re.findall(r"\[(\d{1,2})\]", text)}
    if not cited:
        return ("! The model returned an answer with no citations. Treat it as "
                "unverified and read the sources below.")
    invalid = sorted(c for c in cited if c < 1 or c > n_sources)
    if invalid:
        return (f"! The model cited source(s) {invalid} which were not provided. "
                f"Treat the answer as unverified.")
    return ""
