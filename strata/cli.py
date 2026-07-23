"""Command line.

    strata ask "<clinical question>"          one-shot graded answer
    strata serve                              open the Console + Lite web app
    strata review create --title T --question Q [--levels 1,2,3] [--since 2015]
    strata review list                        all living reviews + status
    strata review sync <id>                   re-run a review, report what changed
    strata review show <id>                   print a review's current state
    strata review delete <id>
    strata demo [--force]                     seed reproducible demo reviews
"""
from __future__ import annotations

import argparse
import json
import sys

from . import report
from .query import ask


# ----------------------------------------------------------------------- ask
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
    server.serve(port=args.port, demo_seed=not args.no_demo)
    return 0


# -------------------------------------------------------------------- review
def cmd_review(args) -> int:
    from . import review, store

    if args.review_cmd == "create":
        levels = tuple(int(x) for x in args.levels.split(",") if x.strip())
        p = review.create(args.title, args.question, include_levels=levels,
                          since_year=args.since)
        print(f"created  {p.id}")
        print(f"         run `strata review sync {p.id}` to build the evidence base.")
        return 0

    if args.review_cmd == "list":
        rows = review.list_reviews()
        if not rows:
            print("no living reviews yet — `strata review create ...`")
            return 0
        for r in rows:
            p = r["protocol"]
            print(f"{p['id']:<44} {str(r['overall_strength'] or '-'):<10} "
                  f"{str(r['included'] or 0):>3} incl  {r['syncs']} sync(s)")
        return 0

    if args.review_cmd == "sync":
        try:
            snap, surv = review.sync(args.id)
        except KeyError as e:
            print(e, file=sys.stderr)
            return 1
        print(f"synced   {args.id}   [{snap['overall_strength'].upper()} EVIDENCE]")
        print(f"         {snap['summary']}")
        if surv.get("first_sync"):
            print("         baseline established.")
        elif surv.get("changed"):
            if surv.get("strength_change"):
                a, b = surv["strength_change"]
                print(f"         certainty moved {a} -> {b}")
            for s in surv.get("new_studies", []):
                print(f"         NEW  {s['title']}")
        else:
            print("         no new evidence since last sync.")
        return 0

    if args.review_cmd == "show":
        v = review.view(args.id)
        if not v:
            print("no such review", file=sys.stderr)
            return 1
        s = v["snapshot"]
        if not s:
            print(f"{args.id}: created but not yet synced.")
            return 0
        print(f"{v['protocol']['title']}   [{s['overall_strength'].upper()} EVIDENCE]")
        print(f"  {v['protocol']['question']}")
        print(f"  {s['summary']}")
        pr = s["prisma"]
        print(f"  identified {pr['identified']} -> included {pr['included']} "
              f"(excluded {pr['excluded_level']} by level, {pr['excluded_year']} by year)")
        for h in s.get("hotspots", []):
            print(f"  · {h['name']}  ({round(h['intensity']*100)}% of signal)")
        for st in s["studies"][:8]:
            print(f"    [{st['n']}] {st['label']} · {st['strength']} · {st['year'] or 'n.d.'}  {st['title']}")
        return 0

    if args.review_cmd == "delete":
        print("deleted" if store.delete(args.id) else "no such review")
        return 0

    return 2


def cmd_demo(args) -> int:
    from . import demo
    ids = demo.seed(force=args.force)
    print("seeded demo reviews:")
    for i in ids:
        print(f"  {i}")
    print("run `strata serve` and open the Console.")
    return 0


# ------------------------------------------------------------------------ main
def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        prog="strata", description="Living evidence intelligence for medicine.")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("ask", help="ask a clinical question")
    a.add_argument("question")
    a.add_argument("-k", type=int, default=8, help="number of sources to weigh")
    a.add_argument("--json", action="store_true", help="emit structured JSON")
    a.set_defaults(fn=cmd_ask)

    s = sub.add_parser("serve", help="open the Console + Lite web app")
    s.add_argument("-p", "--port", type=int, default=8600)
    s.add_argument("--no-demo", action="store_true", help="don't seed demo data on an empty store")
    s.set_defaults(fn=cmd_serve)

    r = sub.add_parser("review", help="living systematic reviews")
    rsub = r.add_subparsers(dest="review_cmd", required=True)
    rc = rsub.add_parser("create", help="define a new living review")
    rc.add_argument("--title", required=True)
    rc.add_argument("--question", required=True)
    rc.add_argument("--levels", default="1,2,3", help="evidence levels to include (default 1,2,3)")
    rc.add_argument("--since", type=int, default=None, help="ignore studies before this year")
    rsub.add_parser("list", help="list living reviews")
    rr = rsub.add_parser("sync", help="re-run a review and report what changed")
    rr.add_argument("id")
    rsh = rsub.add_parser("show", help="print a review's current state")
    rsh.add_argument("id")
    rd = rsub.add_parser("delete", help="delete a review")
    rd.add_argument("id")
    r.set_defaults(fn=cmd_review)

    d = sub.add_parser("demo", help="seed reproducible demo reviews")
    d.add_argument("--force", action="store_true", help="re-seed even if they exist")
    d.set_defaults(fn=cmd_demo)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
