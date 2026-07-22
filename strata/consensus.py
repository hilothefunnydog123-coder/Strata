"""Do the retrieved papers agree, and how much does that agreement count?

A count of papers is not a consensus. Six case reports pointing one way and one
large trial pointing the other is not "six to one" — the trial should dominate,
and a tool that reports a majority vote there is actively misleading.

So agreement is weighted by how much each study is worth: its level on the
pyramid, the certainty it earned after the GRADE domains, how confidently its
direction could be read at all, and whether it has been retracted (weight zero —
a withdrawn paper does not get a vote).

Papers whose direction :mod:`strata.stance` could not read confidently abstain
entirely rather than voting weakly. That is why the paper count under the
consensus meter is usually smaller than the number of sources shown: roughly half
of real abstracts state their conclusion in terms the rule engine will not commit
on, and a guess there would corrupt the very thing this module exists to report.

The output distinguishes three situations that a single "consensus" figure would
blur together:

    agreement    the weighted evidence points one way
    conflict     substantial weight on both sides — the interesting case, and the
                 one Strata names explicitly rather than averaging away
    insufficient too little to say, which is a finding and is reported as one
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .evidence import STRENGTH_ORDER, Grade

#: How much a study's certainty multiplies its vote.
_CERTAINTY_WEIGHT = {"high": 1.0, "moderate": 0.65, "low": 0.35, "very low": 0.15}

#: How much its position on the pyramid multiplies its vote. A meta-analysis is
#: worth roughly seven case reports here, which is about right.
_LEVEL_WEIGHT = {1: 1.0, 2: 0.9, 3: 0.55, 4: 0.4, 5: 0.15, 6: 0.1, 7: 0.08}

_DIRECTIONAL = ("supports", "against")

#: Phrasing used inside a sentence ("the evidence consistently ...").
DISPLAY = {"supports": "supports a benefit",
           "no_effect": "found no effect",
           "against": "found harm or no benefit",
           "unclear": "was inconclusive"}


@dataclass
class Vote:
    pmid: str
    title: str
    stance: str
    weight: float
    level: int
    strength: str

    def as_dict(self) -> dict:
        return {"pmid": self.pmid, "title": self.title, "stance": self.stance,
                "weight": round(self.weight, 3), "level": self.level,
                "strength": self.strength}


@dataclass
class Consensus:
    direction: str                # supports | no_effect | against | mixed | insufficient
    agreement: float              # 0-1, share of directional weight on the winning side
    confidence: str               # strong | moderate | weak | none
    weights: dict = field(default_factory=dict)      # stance -> summed weight
    counts: dict = field(default_factory=dict)       # stance -> paper count
    votes: list = field(default_factory=list)
    conflicts: list = field(default_factory=list)
    summary: str = ""

    @property
    def is_conflicted(self) -> bool:
        return self.direction == "mixed"

    def as_dict(self) -> dict:
        return {"direction": self.direction, "agreement": round(self.agreement, 3),
                "confidence": self.confidence,
                "weights": {k: round(v, 3) for k, v in self.weights.items()},
                "counts": self.counts, "summary": self.summary,
                "votes": [v.as_dict() for v in self.votes],
                "conflicts": self.conflicts}


def vote_weight(g: Grade) -> float:
    """What one paper's opinion is worth.

    Retracted papers weigh nothing. Everything else is the product of its level,
    its post-GRADE certainty, and how clearly its direction could be read — a
    conclusion inferred from a single hedged cue should not count as a full vote.
    """
    if g.retracted:
        return 0.0
    base = _LEVEL_WEIGHT.get(g.level, 0.1) * _CERTAINTY_WEIGHT.get(g.strength, 0.15)
    # stance confidence runs 0.55-0.95; rescale that band onto 0-1.
    conf = min(1.0, max(0.0, (g.stance_confidence - 0.55) / 0.40))         if g.stance_confidence else 0.0
    return base * (0.55 + 0.45 * conf)


def assess(evidence) -> Consensus:
    """Weigh up the direction of a body of evidence.

    ``evidence`` is any sequence of objects with ``.article`` and ``.grade``.
    """
    votes: list[Vote] = []
    weights: dict[str, float] = {}
    counts: dict[str, int] = {}

    for e in evidence:
        g = e.grade
        if not g.stance:
            continue
        w = vote_weight(g)
        counts[g.stance] = counts.get(g.stance, 0) + 1
        weights[g.stance] = weights.get(g.stance, 0.0) + w
        if w > 0:
            votes.append(Vote(pmid=e.article.pmid, title=e.article.title,
                              stance=g.stance, weight=w, level=g.level,
                              strength=g.strength))

    total = sum(weights.values())
    if not votes or total <= 0.02:
        return Consensus(direction="insufficient", agreement=0.0, confidence="none",
                         weights=weights, counts=counts, votes=votes,
                         summary="Too little gradeable evidence to judge a direction.")

    winner = max(weights, key=lambda k: weights[k])
    # Agreement is measured across the *directional* claims only. A study that
    # found no effect is not disagreeing with one that found benefit in the way
    # that a study finding harm is, and averaging all four together understates
    # genuine conflict.
    directional = {k: v for k, v in weights.items() if k in _DIRECTIONAL}
    dir_total = sum(directional.values())
    if dir_total > 0:
        agreement = max(directional.values()) / dir_total
    else:
        agreement = weights[winner] / total

    conflicts = _conflicts(votes)
    opposing = min(directional.values()) if len(directional) == 2 else 0.0

    if winner in _DIRECTIONAL and agreement < 0.68 and opposing > 0.08:
        direction = "mixed"
    else:
        direction = winner

    share = weights[winner] / total
    if direction == "mixed":
        confidence = "weak"
    elif share >= 0.7 and total >= 0.9:
        confidence = "strong"
    elif share >= 0.55 and total >= 0.4:
        confidence = "moderate"
    else:
        confidence = "weak"

    return Consensus(direction=direction, agreement=agreement, confidence=confidence,
                     weights=weights, counts=counts, votes=votes,
                     conflicts=conflicts,
                     summary=_summarize(direction, confidence, counts, conflicts))


def _conflicts(votes: list[Vote]) -> list[dict]:
    """Pairs of strong studies that reached opposite conclusions.

    Only studies at level 3 or above are eligible. A case report contradicting a
    meta-analysis is not a controversy, it is a case report.
    """
    strong = [v for v in votes if v.level <= 3 and v.stance in _DIRECTIONAL]
    out = []
    for i, a in enumerate(strong):
        for b in strong[i + 1:]:
            if a.stance != b.stance:
                out.append({"a": {"pmid": a.pmid, "title": a.title,
                                  "stance": a.stance, "level": a.level},
                            "b": {"pmid": b.pmid, "title": b.title,
                                  "stance": b.stance, "level": b.level}})
    return out[:5]


def _summarize(direction: str, confidence: str, counts: dict,
               conflicts: list) -> str:
    n = sum(counts.values())
    if direction == "mixed":
        s = (f"The {n} gradeable papers point in different directions"
             f" — {counts.get('supports', 0)} toward benefit and "
             f"{counts.get('against', 0)} toward harm or no benefit.")
        if conflicts:
            s += (" The disagreement is not confined to weak studies; "
                  "it includes trials and cohorts.")
        return s + " Read the primary sources before drawing a conclusion."

    if direction == "insufficient":
        return "Too little gradeable evidence to judge a direction."

    qualifier = {"strong": "The weighted evidence consistently",
                 "moderate": "On balance the weighted evidence",
                 "weak": "The limited evidence tentatively"}[confidence]
    return (f"{qualifier} {DISPLAY.get(direction, direction)}, "
            f"across {n} graded paper{'s' if n != 1 else ''}.")


def disagreement_index(consensus: Consensus) -> float:
    """0 when the evidence is unanimous, 1 when it is evenly split.

    Fed back into :func:`strata.evidence.summarize_body`, where genuine conflict
    lowers the certainty of the answer as a whole.
    """
    directional = {k: v for k, v in consensus.weights.items() if k in _DIRECTIONAL}
    total = sum(directional.values())
    if total <= 0 or len(directional) < 2:
        return 0.0
    return 1.0 - (max(directional.values()) / total - 0.5) * 2.0


def timeline(evidence) -> list[dict]:
    """Stance by publication year — does the picture change over time?

    Useful for the case Strata exists to catch: an early positive finding that
    later, larger trials failed to reproduce.
    """
    by_year: dict[int, dict] = {}
    for e in evidence:
        year = e.article.year
        if not year or not e.grade.stance:
            continue
        slot = by_year.setdefault(year, {"year": year, "supports": 0,
                                         "no_effect": 0, "against": 0,
                                         "unclear": 0, "best_level": 9})
        slot[e.grade.stance] += 1
        slot["best_level"] = min(slot["best_level"], e.grade.level)
    return [by_year[y] for y in sorted(by_year)]
