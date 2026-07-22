"""Command line: `strata ask "<clinical question>"`.

Searches PubMed, grades the evidence, and prints a grounded, cited answer with an
honest strength verdict. Add --json for the structured result.
"""
from __future__ import annotations

import argparse
import json
import sys

from . import report
from .query import ask


def cmd_ask(args) -> int:
    result = ask(args.question, k=args.k)
    if args.json:
        payload = {
            "question": result.question,
            "overall_strength": result.body.overall_strength,
            "evidence_summary": result.body.summary,
            "answer": result.answer,
            "sources": [{
                "n": i, "pmid": e.article.pmid, "title": e.article.title,
                "year": e.article.year, "url": e.article.url,
                "study_type": e.grade.label, "strength": e.grade.strength,
                "sample_size": e.grade.sample_size,
            } for i, e in enumerate(result.evidence, 1)],
        }
        print(json.dumps(payload, indent=2))
    else:
        print(report.render(result))
    return 0


def cmd_serve(args) -> int:
    from . import server
    server.serve(port=args.port)
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        prog="strata", description="A medical evidence engine that grades its answers.")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("ask", help="ask a clinical question")
    a.add_argument("question")
    a.add_argument("-k", type=int, default=8, help="number of sources to weigh")
    a.add_argument("--json", action="store_true", help="emit structured JSON")
    a.set_defaults(fn=cmd_ask)

    s = sub.add_parser("serve", help="open the web app on localhost")
    s.add_argument("-p", "--port", type=int, default=8600)
    s.set_defaults(fn=cmd_serve)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
