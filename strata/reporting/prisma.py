"""PRISMA 2020 flow — where every record went, and why.

A systematic review is not credible because of what it found. It is credible
because you can see what it discarded. PRISMA's flow diagram is the instrument
for that: identified, removed before screening, screened, excluded, assessed,
included, with a number on every arrow that has to add up.

Strata can produce one honestly because the pipeline already knows all of it —
how many records PubMed said existed, how many were retrieved, how many
collapsed as duplicates of the same trial, how many were dropped for having no
abstract, how many were retracted, and how many survived to be graded and
ranked. Until now those numbers were scattered across the result object; this
assembles them into the standard diagram, with the arithmetic checked.

**One honest departure, stated on the diagram itself.** In a real systematic
review, screening is two humans reading titles and abstracts against
pre-specified eligibility criteria. In Strata it is an automated relevance rank
that keeps the top *k*. Those are not the same operation and the diagram says
so, in the box, every time. A PRISMA diagram that implies human screening
happened when it did not is a fabricated audit trail, which is considerably
worse than no diagram at all.

What this *is* good for: showing a reviewer or an auditor exactly how a Strata
answer was assembled, in the notation their field already reads, with a
reproducibility hash that lets them rerun it (:mod:`strata.provenance`).
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Box:
    """One box in the diagram, with its count and its sub-counts."""
    key: str
    label: str
    n: int
    detail: list[tuple[str, int]] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"key": self.key, "label": self.label, "n": self.n,
                "detail": [{"reason": r, "n": c} for r, c in self.detail]}


@dataclass
class PrismaFlow:
    identified: int
    removed_before_screening: int
    screened: int
    excluded_at_screening: int
    assessed: int
    excluded_at_assessment: int
    included: int
    boxes: list[Box]
    automated: bool = True
    notes: list[str] = field(default_factory=list)
    balanced: bool = True

    def as_dict(self) -> dict:
        return {"standard": "PRISMA 2020",
                "identified": self.identified,
                "removed_before_screening": self.removed_before_screening,
                "screened": self.screened,
                "excluded_at_screening": self.excluded_at_screening,
                "assessed_for_eligibility": self.assessed,
                "excluded_at_assessment": self.excluded_at_assessment,
                "included": self.included,
                "automated_screening": self.automated,
                "arithmetic_balances": self.balanced,
                "boxes": [b.as_dict() for b in self.boxes],
                "notes": self.notes}

    def to_svg(self, width: int = 760) -> str:
        """The diagram itself, as standalone SVG.

        Deliberately monochrome and theme-neutral: it goes into manuscripts,
        submission dossiers and slide decks, and every one of those has its own
        idea of what the background is.
        """
        rows = [
            ("Identification", [
                (f"Records identified from PubMed", self.identified),
                (f"Records removed before screening", self.removed_before_screening),
            ]),
            ("Screening", [
                ("Records screened", self.screened),
                ("Records excluded", self.excluded_at_screening),
            ]),
            ("Eligibility", [
                ("Reports assessed for eligibility", self.assessed),
                ("Reports excluded", self.excluded_at_assessment),
            ]),
            ("Included", [
                ("Studies included in the appraisal", self.included),
                ("", -1),
            ]),
        ]
        box_w, box_h, gap_y = 260, 62, 34
        left_x, right_x = 130, 430
        height = 70 + len(rows) * (box_h + gap_y)

        parts = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
            f'height="{height}" viewBox="0 0 {width} {height}" '
            f'font-family="system-ui,-apple-system,Segoe UI,sans-serif" '
            f'font-size="12" role="img" '
            f'aria-label="PRISMA 2020 flow diagram">',
            '<defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" '
            'refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" '
            'fill="currentColor"/></marker></defs>',
            '<g fill="none" stroke="currentColor" stroke-width="1.2" '
            'color="#555">',
        ]
        y = 40
        centres = []
        for _stage, pair in rows:
            (l_label, l_n), (r_label, r_n) = pair
            parts.append(f'<rect x="{left_x}" y="{y}" width="{box_w}" '
                         f'height="{box_h}" rx="4"/>')
            centres.append(y + box_h)
            if r_n >= 0:
                parts.append(f'<rect x="{right_x}" y="{y}" width="{box_w}" '
                             f'height="{box_h}" rx="4"/>')
                parts.append(f'<path d="M{left_x + box_w} {y + box_h / 2} '
                             f'H{right_x - 6}" marker-end="url(#a)"/>')
            y += box_h + gap_y
        for i in range(len(rows) - 1):
            top = centres[i]
            parts.append(f'<path d="M{left_x + box_w / 2} {top} '
                         f'V{top + gap_y - 6}" marker-end="url(#a)"/>')
        parts.append("</g>")

        y = 40
        parts.append('<g fill="currentColor" color="#111">')
        for stage, pair in rows:
            (l_label, l_n), (r_label, r_n) = pair
            parts.append(f'<text x="16" y="{y + box_h / 2 + 4}" font-weight="600" '
                         f'font-size="11" letter-spacing="0.5">'
                         f'{stage.upper()}</text>')
            parts.append(f'<text x="{left_x + 14}" y="{y + 25}">'
                         f'{_esc(l_label)}</text>')
            parts.append(f'<text x="{left_x + 14}" y="{y + 45}" '
                         f'font-weight="700">n = {l_n:,}</text>')
            if r_n >= 0:
                parts.append(f'<text x="{right_x + 14}" y="{y + 25}">'
                             f'{_esc(r_label)}</text>')
                parts.append(f'<text x="{right_x + 14}" y="{y + 45}" '
                             f'font-weight="700">n = {r_n:,}</text>')
            y += box_h + gap_y
        parts.append(f'<text x="16" y="{height - 12}" font-size="10" '
                     f'fill="#777">Screening was automated relevance ranking, '
                     f'not independent human screening — see notes.</text>')
        parts.append("</g></svg>")
        return "".join(parts)


def _esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def from_result(result, *, no_abstract: int = 0) -> PrismaFlow:
    """Build the flow from a :class:`strata.query.Result`.

    Every count comes from the pipeline rather than being reconstructed, which
    is why the arithmetic is checkable: ``identified - removed - excluded ==
    included`` is asserted and reported in ``balanced``.
    """
    identified = result.total_hits or result.retrieved or len(result.evidence)
    fetched = result.retrieved or len(result.evidence)
    duplicates = result.duplicates_removed or 0
    included = len(result.evidence)

    # Records PubMed held but that were never retrieved: the search returned
    # 1,284 hits and Strata fetched 40 of them. In PRISMA terms those were
    # excluded at screening — by a relevance rank rather than by a human.
    not_retrieved = max(0, identified - fetched - duplicates)

    retracted = sum(1 for e in result.evidence if e.grade.retracted)
    assessed = fetched
    excluded_at_assessment = max(0, assessed - included)

    boxes = [
        Box("identified", "Records identified from PubMed", identified,
            [("database search", identified)]),
        Box("removed", "Records removed before screening",
            duplicates + no_abstract,
            [("duplicate records of the same study", duplicates),
             ("records with no abstract", no_abstract)]),
        Box("screened", "Records screened", identified - duplicates),
        Box("excluded_screening", "Records excluded by relevance ranking",
            not_retrieved),
        Box("assessed", "Reports assessed for eligibility", assessed),
        Box("excluded_assessment", "Reports not carried into the appraisal",
            excluded_at_assessment,
            [("outranked by higher-quality evidence", excluded_at_assessment)]),
        Box("included", "Studies included in the appraisal", included,
            [("of which retracted, retained and marked", retracted)]),
    ]

    balanced = (identified - duplicates - no_abstract - not_retrieved
                - excluded_at_assessment) == included

    notes = [
        "Screening was performed by automated relevance ranking (BM25 over the "
        "abstract, plus MeSH overlap, evidence level, recency and reported "
        "methodological rigour), not by two independent human reviewers. This "
        "diagram documents an automated evidence retrieval, and should be "
        "labelled as such wherever it is reproduced.",
        "Eligibility criteria were the PubMed boolean query shown in the "
        "provenance record, not a pre-specified protocol.",
        "Retracted papers are retained in the included set and marked, rather "
        "than silently dropped; they are excluded from every pooled estimate.",
    ]
    if result.broadened:
        notes.append("The initial query returned too few records and was "
                     "broadened once; the counts above are for the broadened "
                     "search.")
    if not balanced:
        notes.append("The arithmetic does not balance exactly, because PubMed's "
                     "reported hit count and the records actually returned can "
                     "differ when the index changes between the search and the "
                     "fetch. The retrieved and included counts are exact.")

    return PrismaFlow(
        identified=identified, removed_before_screening=duplicates + no_abstract,
        screened=identified - duplicates, excluded_at_screening=not_retrieved,
        assessed=assessed, excluded_at_assessment=excluded_at_assessment,
        included=included, boxes=boxes, automated=True, notes=notes,
        balanced=balanced)
