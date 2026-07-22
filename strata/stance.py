"""Which way did the paper come out?

This drives the consensus meter, so being wrong here is worse than being silent.
The module is built around that: it reads the conclusion with a wide but
high-precision rule set, corroborates against the reported confidence interval,
and **abstains** whenever the two disagree or neither is clear.

## Why this is not a neural network

It was, briefly. A stance classifier trained on the seed corpus reached 0.94
macro-F1 on held-out synthetic data and **36% on the adversarial probes** — four
classes, so barely above the 25% chance line. It had learned the generator's
phrasing, not the skill.

The rule set it was meant to replace scored **100% on the probes it fired on**,
and fired on only 3 of 22. Precise but nearly blind. That is a coverage problem,
and coverage is something you can fix by writing more patterns; a model that has
memorised a corpus is not.

So the rules were widened, given the confidence interval as a second source, and
the network demoted to a fallback consulted only where the rules abstain *and* it
is confident. Every stance records which route produced it, in ``decided_by``.

## The two sources

**Conclusion cues.** A conclusion states the direction in words: "supports its
use", "did not improve", "should be reconsidered", "remains uncertain". Four cue
families, scanned over the last portion of the abstract where conclusions live.

**The interval.** An effect estimate whose interval spans the null is a null
result whatever the prose claims, and abstracts do over-claim. Where the two
sources conflict, the interval wins for *no effect* and the prose wins for
*direction*, because the numbers know about significance and the words know
whether a lower number is good news.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

LABELS = ("supports", "no_effect", "against", "unclear")

DISPLAY = {"supports": "Supports benefit", "no_effect": "Found no effect",
           "against": "Found harm or no benefit", "unclear": "Inconclusive"}

#: Where the conclusion starts, in three fallbacks. A structured abstract says so
#: explicitly and that heading is by far the most reliable anchor. Failing that, a
#: short abstract is read whole — slicing 300 characters in half lands mid-clause
#: and loses the very sentence being looked for. Only a long unstructured abstract
#: falls back to a fraction.
_CONCLUSION_HEADING = re.compile(
    r"\b(?:CONCLUSIONS?|INTERPRETATION|SUMMARY|IMPLICATIONS?)\s*:", re.I)
_SHORT_ENOUGH_TO_READ_WHOLE = 700
_TAIL = 0.5


def conclusion_of(text: str) -> str:
    """The part of an abstract that states the upshot."""
    if not text:
        return ""
    last = None
    for last in _CONCLUSION_HEADING.finditer(text):
        pass
    if last is not None:
        return text[last.end():]
    if len(text) <= _SHORT_ENOUGH_TO_READ_WHOLE:
        return text
    return text[int(len(text) * _TAIL):]

# ---------------------------------------------------------------- cue families

_SUPPORT = re.compile(r"""
    \b(?:
      significantly\s+(?:reduc|improv|increas|lower|decreas|shorten)\w*
    | (?:reduc|improv|lower|decreas|shorten)\w*\s+(?:significantly|markedly|substantially)
    | was\s+(?:significantly\s+)?(?:lower|less\s+frequent|less\s+common|shorter|better)
    | were\s+(?:significantly\s+)?(?:lower|fewer|less\s+frequent|less\s+common|better)
    | (?:less|fewer)\s+(?:frequent|common|likely)\s+(?:in|with|among)
    | occurred\s+less\s+often
    | associated\s+with\s+(?:a\s+)?(?:significant|marked|substantial|lower|reduced)\s*
      (?:reduction|improvement|decrease|risk|rate|incidence)?
    | support(?:s|ed)?\s+(?:the\s+|its\s+|their\s+)?(?:use|adoption|routine)
    | strengthens?\s+the\s+case
    | conferred\s+a\s+(?:clinically\s+)?(?:meaningful|significant|important)\s+benefit
    | favour(?:s|ed|ing)?\s+(?:the\s+)?(?:intervention|treatment|\w+\s+group)
    | (?:was|were)\s+(?:effective|efficacious|beneficial|superior)
    | improved\s+\w+\s+in
    | benefit\s+(?:was\s+)?(?:observed|seen|demonstrated)
    | number\s+needed\s+to\s+treat
    | interval\s+lay\s+entirely\s+below
    )\b""", re.I | re.X)

_NULL = re.compile(r"""
    \b(?:
      no\s+(?:significant\s+)?(?:difference|effect|benefit|association|evidence\s+of)
    | did\s+not\s+(?:significantly\s+)?(?:differ|improve|reduce|affect|change|alter|lower)
      (?:\s+significantly)?
    | (?:was|were)\s+not\s+(?:significantly\s+)?(?:associated|different|superior|reduced|improved)
    | failed\s+to\s+(?:show|demonstrate|improve|reduce)
    | not\s+support(?:ed)?\s+(?:by\s+)?(?:the\s+|its\s+)?(?:routine\s+)?(?:use|practice)
    | (?:stopped|terminated)\s+for\s+futility
    | met\s+its\s+(?:prespecified\s+)?futility
    | no\s+benefit
    | performed\s+no\s+better
    | (?:rates|results)\s+were\s+similar
    | changed\s+nothing
    | close\s+to\s+unity
    | crossed\s+the\s+line\s+of\s+no\s+effect
    | neither\s+the\s+primary\s+nor
    | difficult\s+to\s+justify
    )\b""", re.I | re.X)

_HARM = re.compile(r"""
    \b(?:
      significantly\s+(?:worse|higher|increased|elevated|more\s+frequent)
    | (?:was|were)\s+(?:significantly\s+)?worse
    | associated\s+with\s+(?:an?\s+)?(?:increased|higher|excess|elevated|greater)\s+
      (?:risk|rate|incidence|mortality|odds|hazard|frequency)
    | associated\s+with\s+more\s+\w+
    | (?:more|higher)\s+(?:frequent|common)\s+(?:serious\s+)?adverse
    | occurred\s+more\s+often\s+(?:with|in|among)
    | (?:was|were)\s+(?:more\s+common|elevated|higher)\s+(?:with|among|in)\s+
      (?:those\s+)?(?:receiving|exposed|recipients)
    | harm(?:s|ful)?\s+(?:outweigh|exceeded|were)
    | risks?\s+of\s+\w+\s+outweighed
    | should\s+be\s+(?:reconsidered|avoided|discouraged|weighed)
    | argues?\s+against
    | does\s+more\s+harm\s+than\s+good
    | safety\s+signal
    | dose-response\s+relationship
    | excess\s+risk
    | terminated\s+early\s+(?:for|because\s+of|on)\s+(?:safety|harm)
    | discontinuation\s+for\s+adverse
    | interval\s+lay\s+above\s+the\s+line
    )\b""", re.I | re.X)

_UNCLEAR = re.compile(r"""
    \b(?:
      insufficient\s+(?:evidence|data)
    | evidence\s+is\s+(?:insufficient|inconclusive|uncertain|too)
    | no\s+firm\s+conclusion
    | cannot\s+be\s+(?:determined|established|drawn)
    | inconsisten(?:t|cy)
    | further\s+(?:research|trials?|studies)\s+(?:are|is)\s+(?:needed|required|warranted)
    | adequately\s+powered\s+trials?\s+are\s+needed
    | definitive\s+trial\s+is\s+required
    | certainty\s+of\s+(?:the\s+)?evidence\s+was\s+(?:very\s+)?low
    | too\s+(?:few|sparse|heterogeneous|small)
    | remains?\s+(?:unclear|uncertain|open|genuinely\s+open)
    | compatible\s+with\s+both\s+benefit\s+and\s+harm
    | neither\s+recommend\s+nor
    | hypothesis-generating
    | (?:no|not)\s+causal\s+inference
    | causality\s+cannot
    | underpowered
    | pooling\s+was\s+judged\s+inappropriate
    | estimates?\s+conflicted
    | should\s+not\s+be\s+interpreted
    | not\s+(?:be\s+)?extrapolated
    | associations?\s+reported\s+are\s+not\s+causal
    )\b""", re.I | re.X)

_FAMILIES = (("supports", _SUPPORT), ("no_effect", _NULL),
             ("against", _HARM), ("unclear", _UNCLEAR))


@dataclass
class Stance:
    label: str | None
    confidence: float
    decided_by: str            # rules | rules+interval | interval | network | none
    cues: list = None

    def __bool__(self) -> bool:
        return self.label is not None


def _scan(segment: str) -> dict:
    return {name: len(rx.findall(segment)) for name, rx in _FAMILIES}


def cue_counts(text: str) -> dict:
    """How many cues of each family fire in the conclusion.

    Read the conclusion first. If it says nothing this rule set recognises, widen
    to the back half of the abstract before giving up — plenty of papers state
    the upshot in the results section and leave the conclusion to discuss
    implications. Narrowing first and widening second keeps the precise reading
    when there is one, without throwing away the papers that lack it.
    """
    if not text:
        return {k: 0 for k, _ in _FAMILIES}
    scores = _scan(conclusion_of(text))
    if any(scores.values()):
        return scores
    return _scan(text[int(len(text) * _TAIL):] or text)


def from_rules(text: str) -> Stance:
    """Read the conclusion. Abstains on a tie or on silence."""
    scores = cue_counts(text)
    if not any(scores.values()):
        return Stance(None, 0.0, "none", [])

    # A hedge beats a claim: an abstract that reports a significant result *and*
    # says the evidence is insufficient is, for grading purposes, hedged.
    if scores["unclear"] and scores["unclear"] >= max(
            scores["supports"], scores["against"], scores["no_effect"]):
        return Stance("unclear", _confidence(scores, "unclear"), "rules",
                      _fired(scores))

    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    best, best_n = ranked[0]
    if best_n == 0 or (len(ranked) > 1 and ranked[1][1] == best_n):
        return Stance(None, 0.0, "none", _fired(scores))
    return Stance(best, _confidence(scores, best), "rules", _fired(scores))


def _fired(scores: dict) -> list:
    return [k for k, v in scores.items() if v]


def _confidence(scores: dict, winner: str) -> float:
    """Share of cues belonging to the winning family, floored so a lone cue is
    still a usable but modest signal."""
    total = sum(scores.values()) or 1
    return round(min(0.95, 0.55 + 0.45 * (scores[winner] / total)), 3)


def infer(text: str, effect=None, *, network=None) -> Stance:
    """Combine the conclusion, the interval and — last — the network.

    Precedence, and the reasoning behind it:

    1. A non-significant interval overrides prose claiming a direction. Abstracts
       over-claim; ``RR 0.94 (95% CI 0.87 to 1.01)`` is a null result no matter
       how the discussion frames it.
    2. Otherwise the conclusion decides direction, because the numbers cannot
       know whether a lower value is good news.
    3. The network is consulted only where the rules said nothing, and only when
       it is confident. It is the least reliable source and is treated as such.
    """
    ruled = from_rules(text)
    interval_is_null = (effect is not None and effect.has_interval
                        and effect.is_significant is False)

    if interval_is_null:
        if ruled.label in ("supports", "against"):
            # Prose and interval disagree — trust the interval, but say the
            # disagreement narrowed our confidence.
            return Stance("no_effect", 0.7, "rules+interval", ruled.cues)
        if ruled.label is None:
            return Stance("no_effect", 0.65, "interval", [])
        return Stance(ruled.label, ruled.confidence, "rules+interval", ruled.cues)

    if ruled.label is not None:
        # A significant interval corroborating a directional claim raises
        # confidence a little; it cannot create one on its own.
        if (effect is not None and effect.has_interval
                and effect.is_significant and ruled.label in ("supports", "against")):
            return Stance(ruled.label, min(0.95, ruled.confidence + 0.1),
                          "rules+interval", ruled.cues)
        return ruled

    if network is not None:
        try:
            pred = network.predict(text, explain=False)
        except Exception:
            return Stance(None, 0.0, "none", [])
        if pred.confidence >= 0.60 and pred.margin >= 0.15:
            return Stance(pred.label, pred.confidence * 0.8, "network", [])
    return Stance(None, 0.0, "none", [])


def weak_label(text: str) -> str | None:
    """Rules-only label, for weakly supervising a harvested PubMed corpus.

    Deliberately the conservative path: no interval, no network, abstain on any
    ambiguity. Training on a noisy label is worse than training on fewer.
    """
    return from_rules(text).label
