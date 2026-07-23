"""Regulated-format outputs — the artefacts a submission actually needs.

A Strata answer is useful to a clinician as prose. It is useless to a guideline
panel, an HTA submission or a manuscript unless it arrives in the formats those
processes read: a PRISMA 2020 flow diagram showing what was discarded, and a
GRADE Summary of Findings table converting relative effects into absolute ones.

    from strata.reporting import prisma, sof

    flow  = prisma.from_result(result)
    table = sof.build(result, comparator_risk=0.12,
                      comparator_risk_basis="control arm of the two largest trials")

    open("flow.svg", "w").write(flow.to_svg())
    print(table.to_markdown())

Both carry their own honesty text into the output — the PRISMA diagram states on
its face that screening was automated, and the SoF table refuses to print
absolute effects without a stated comparator risk. Those statements are not
removable, because the whole value of producing these formats is that a reader
can trust what they claim.
"""
from __future__ import annotations

from . import prisma, sof
from .prisma import PrismaFlow
from .sof import SummaryOfFindings

__all__ = ["prisma", "sof", "PrismaFlow", "SummaryOfFindings"]
