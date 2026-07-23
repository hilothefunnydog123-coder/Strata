"""Matching registered trials to published papers, and measuring what is missing.

This is the module that answers the question a literature search structurally
cannot: *how much of the evidence never got published?*

A search of PubMed returns the trials someone chose to write up. Trials with a
disappointing, null or commercially inconvenient result are written up less often
and later. So the published set is not a sample of the evidence — it is a biased
subset of it, and pooling it produces an effect estimate shifted toward whatever
the sponsors were willing to print. This is publication bias, it is large (the
literature puts the inflation at roughly 10-30% for the affected questions), and
it is the reason a meta-analysis of published trials alone is not trustworthy.

The conventional response is to *infer* the missing studies from the shape of the
published ones — funnel plot asymmetry, Egger's regression, trim-and-fill. Those
are in :mod:`strata.meta.bias` and they are worth having. But they are inference
from indirect evidence, they need at least ten studies to mean anything, and they
cannot distinguish publication bias from genuine small-study effects.

The register lets you skip the inference. Every interventional trial is
registered before it enrols. Cross-referencing the register against the
literature *counts* the gap:

    14 registered trials matched, 11,204 participants enrolled.
      8 published                      6,120 participants
      2 results posted, no publication 1,455 participants
      4 completed, nothing reported    3,629 participants  ← 32% of enrolment

That last line is a measured quantity. It belongs in every evidence summary that
claims to be systematic, and it is what HTA bodies and regulators ask for.

**On matching.** Two identifier routes are used and no fuzzy one. A paper carries
its registration number — journals have required it since the ICMJE statement —
and the register carries the PMIDs of papers reporting it. Both directions are
read because they disagree surprisingly often. What is deliberately *not* done is
matching on title similarity: a false match would move a trial from "unreported"
to "published", which silently erases exactly the finding this module exists to
surface. An unmatched trial is reported as unmatched.
"""
from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field

from .trials import TrialRecord


@dataclass
class TrialLink:
    """One trial and the papers found to report it."""
    trial: TrialRecord
    articles: list = field(default_factory=list)
    matched_by: str = ""             # "paper cites NCT" | "register cites PMID" | ""

    @property
    def is_reported(self) -> bool:
        return bool(self.articles) or self.trial.has_results

    def status(self, today: _dt.date | None = None) -> str:
        if self.articles:
            return "published"
        return self.trial.reporting_status(today)


@dataclass
class ReportingAudit:
    """What the register says exists, set against what the literature published."""
    links: list[TrialLink] = field(default_factory=list)
    today: _dt.date | None = None

    # ------------------------------------------------------------- partitions
    def by_status(self) -> dict[str, list[TrialLink]]:
        out: dict[str, list[TrialLink]] = {}
        for link in self.links:
            out.setdefault(link.status(self.today), []).append(link)
        return out

    @property
    def unreported(self) -> list[TrialLink]:
        """Finished, past the reporting deadline, and silent on both channels."""
        return [l for l in self.links if l.status(self.today) == "overdue"]

    @property
    def published(self) -> list[TrialLink]:
        return [l for l in self.links if l.status(self.today) == "published"]

    @property
    def results_only(self) -> list[TrialLink]:
        """Summary results posted to the register, never written up.

        Real evidence that a literature search cannot see. Worth flagging on its
        own rather than folding into "reported", because a reviewer who wants it
        has to go and read the register by hand.
        """
        return [l for l in self.links if l.status(self.today) == "results-posted"]

    # ------------------------------------------------------------ enrolment
    def enrolment(self, links: list[TrialLink] | None = None) -> int:
        """Participants enrolled across a set of trials, counting only actual
        figures. An estimated enrolment is a plan, not a fact, and adding the two
        together produces a number that is neither."""
        chosen = self.links if links is None else links
        return sum(l.trial.enrollment or 0 for l in chosen
                   if l.trial.enrollment and
                   l.trial.enrollment_type.upper() == "ACTUAL")

    @property
    def unreported_fraction(self) -> float:
        """Share of enrolled participants whose data were never reported."""
        total = self.enrolment()
        return (self.enrolment(self.unreported) / total) if total else 0.0

    # -------------------------------------------------------------- verdicts
    def summary(self) -> str:
        """The paragraph that belongs at the top of an evidence summary."""
        if not self.links:
            return ("No matching trial registrations were found, so the "
                    "completeness of the published record could not be checked.")

        counts = {k: len(v) for k, v in self.by_status().items()}
        total = len(self.links)
        enrolled = self.enrolment()
        missing = self.enrolment(self.unreported)

        bits = [f"{total} registered trial{'s' if total != 1 else ''} matched "
                f"this question"]
        if enrolled:
            bits[0] += f", enrolling {enrolled:,} participants"

        parts = []
        for key, label in (("published", "published"),
                           ("results-posted", "posted results without a publication"),
                           ("overdue", "completed with nothing reported"),
                           ("ongoing", "still running"),
                           ("awaiting", "recently completed, within the reporting window"),
                           ("withdrawn", "withdrawn before enrolling"),
                           ("unknown", "of unknown status")):
            if counts.get(key):
                parts.append(f"{counts[key]} {label}")
        if parts:
            bits.append("; ".join(parts))

        text = ". ".join(bits) + "."
        if missing and enrolled:
            text += (f" Data from {missing:,} participants "
                     f"({missing / enrolled:.0%} of those enrolled) have never "
                     f"been reported in any form.")
        return text

    def bias_warning(self) -> str | None:
        """A caveat for the body assessment when the gap is material.

        The one-in-five threshold is a judgement, and it is stated rather than
        hidden: below it the gap is noted in the audit but does not move the
        certainty rating, because every register has some administrative
        untidiness and treating that as evidence suppression cries wolf.
        """
        if not self.links:
            return None
        n_missing = len(self.unreported)
        if not n_missing:
            return None
        fraction = self.unreported_fraction
        if fraction >= 0.20:
            return (f"{n_missing} completed trial"
                    f"{'s have' if n_missing > 1 else ' has'} never reported "
                    f"results, covering {fraction:.0%} of all enrolled "
                    f"participants — the published evidence is materially "
                    f"incomplete")
        if n_missing >= 3:
            return (f"{n_missing} completed trials have never reported results; "
                    f"the published record is incomplete")
        return None

    def as_dict(self) -> dict:
        counts = {k: len(v) for k, v in self.by_status().items()}
        return {
            "trials_matched": len(self.links),
            "by_status": counts,
            "participants_enrolled": self.enrolment(),
            "participants_unreported": self.enrolment(self.unreported),
            "unreported_fraction": round(self.unreported_fraction, 4),
            "summary": self.summary(),
            "warning": self.bias_warning(),
            "unreported_trials": [
                {"nct_id": l.trial.nct_id, "url": l.trial.url,
                 "title": l.trial.title,
                 "enrollment": l.trial.enrollment,
                 "enrollment_type": l.trial.enrollment_type,
                 "status": l.trial.status,
                 "sponsor": l.trial.sponsor,
                 "sponsor_class": l.trial.sponsor_class,
                 "completed": (l.trial.primary_completion_date.isoformat()
                               if l.trial.primary_completion_date else None),
                 "why_stopped": l.trial.why_stopped}
                for l in self.unreported],
            "results_posted_only": [
                {"nct_id": l.trial.nct_id, "url": l.trial.url,
                 "title": l.trial.title, "enrollment": l.trial.enrollment}
                for l in self.results_only],
            "method": ("Matched on registration identifiers only — the number "
                       "printed in the paper and the PMIDs recorded in the "
                       "register. Titles are not fuzzy-matched, because a false "
                       "match would reclassify an unreported trial as published "
                       "and hide the very gap being measured."),
        }


def link(articles: list, trials: list[TrialRecord], *,
         today: _dt.date | None = None) -> ReportingAudit:
    """Match papers to registrations, attach each trial to its paper, and audit.

    Mutates the matched articles: ``article.trial`` is set to the
    :class:`~strata.sources.trials.TrialRecord`, which is how prospective
    registration, protocol masking and planned-versus-achieved enrolment reach
    the risk-of-bias instruments in :mod:`strata.appraisal`. Those are facts about
    the study that no abstract reliably states.
    """
    by_pmid = {a.pmid: a for a in articles if getattr(a, "pmid", "")}
    by_nct: dict[str, list] = {}
    for article in articles:
        for nct in getattr(article, "nct_ids", None) or []:
            by_nct.setdefault(nct.upper(), []).append(article)

    links = []
    for trial in trials:
        matched, how = [], ""
        for article in by_nct.get(trial.nct_id.upper(), []):
            matched.append(article)
            how = "paper cites its registration number"
        for pmid in trial.result_pmids or trial.linked_pmids:
            article = by_pmid.get(pmid)
            if article is not None and article not in matched:
                matched.append(article)
                how = how or "register records the publication"

        for article in matched:
            if getattr(article, "trial", None) is None:
                article.trial = trial
        links.append(TrialLink(trial=trial, articles=matched, matched_by=how))

    return ReportingAudit(links=links, today=today)
