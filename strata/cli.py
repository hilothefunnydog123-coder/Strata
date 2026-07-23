"""Command line for Strata — the verification layer for medical AI.

    strata verify "<claim>"                    check a claim → Evidence Receipt
    strata monitor add "<claim>"               put a claim under continuous surveillance
    strata monitor list | check <id> | show <id> | delete <id>
    strata console                             the Evidence-Health rollup (what changed)
    strata changes [--limit N]                 the recent evidence-change alert feed
    strata serve [--host 0.0.0.0] [--port 8600]   run the web app + Console + Verify API
    strata demo [--force]                      seed reproducible reviews + claims

    strata ask "<question>"                     one-shot graded answer (Lite engine)
    strata review create|sync|show|list|delete  living systematic reviews
"""
from __future__ import annotations

import argparse
import json
import sys

from . import report
from .query import ask


# ----------------------------------------------------------------------- verify
def cmd_verify(args) -> int:
    from . import receipt as R, verify as V
    r = V.verify_claim(args.claim)
    if args.json:
        print(json.dumps(r.to_dict(), indent=2))
    else:
        print(R.render_terminal(r, color=sys.stdout.isatty()))
    return 0


def cmd_monitor(args) -> int:
    from . import monitor as M, receipt as R
    if args.monitor_cmd == "add":
        p = M.register(args.claim, tenant=args.tenant)
        rd, ch = M.check(p["id"])
        print(f"monitoring  {p['id']}")
        print(R.render_terminal(R.Receipt.from_dict(rd), color=sys.stdout.isatty()))
        return 0
    if args.monitor_cmd == "list":
        rows = M.list_claims()
        if not rows:
            print('no monitored claims — `strata monitor add "<claim>"`')
            return 0
        for r in rows:
            flag = "  ● CHANGED" if r["evidence_changed"] else ""
            print(f"{r['id']:<26} {str(r['status'] or '-'):<12} "
                  f"▲{r['supporting'] or 0} ▼{r['contradicting'] or 0}  "
                  f"{(r['claim'] or '')[:46]}{flag}")
        return 0
    if args.monitor_cmd == "check":
        try:
            rd, ch = M.check(args.id)
        except KeyError as e:
            print(e, file=sys.stderr)
            return 1
        print(R.render_terminal(R.Receipt.from_dict(rd), color=sys.stdout.isatty()))
        if ch.get("first_check"):
            print("  baseline established.")
        elif ch.get("changed"):
            for e in ch["events"]:
                print("  • " + e["text"])
        else:
            print("  no change since last check.")
        return 0
    if args.monitor_cmd == "show":
        v = M.view(args.id)
        if not v or not v.get("receipt"):
            print("no such claim (or not yet checked)", file=sys.stderr)
            return 1
        print(R.render_terminal(R.Receipt.from_dict(v["receipt"]), color=sys.stdout.isatty()))
        return 0
    if args.monitor_cmd == "delete":
        print("deleted" if M.delete(args.id) else "no such claim")
        return 0
    return 2


# ----------------------------------------------------------------------- ask / review
def cmd_ask(args) -> int:
    result = ask(args.question, k=args.k)
    if args.json:
        print(json.dumps({
            "question": result.question, "overall_strength": result.body.overall_strength,
            "evidence_summary": result.body.summary, "answer": result.answer,
            "sources": [{"n": i, "pmid": e.article.pmid, "title": e.article.title,
                         "year": e.article.year, "url": e.article.url,
                         "study_type": e.grade.label, "strength": e.grade.strength,
                         "sample_size": e.grade.sample_size}
                        for i, e in enumerate(result.evidence, 1)]}, indent=2))
    else:
        print(report.render(result))
    return 0


def cmd_review(args) -> int:
    from . import review, store
    if args.review_cmd == "create":
        levels = tuple(int(x) for x in args.levels.split(",") if x.strip())
        p = review.create(args.title, args.question, include_levels=levels, since_year=args.since)
        print(f"created  {p.id}\n         run `strata review sync {p.id}` to build the evidence base.")
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
        print(f"  {v['protocol']['question']}\n  {s['summary']}")
        pr = s["prisma"]
        print(f"  identified {pr['identified']} -> included {pr['included']} "
              f"(excluded {pr['excluded_level']} by level, {pr['excluded_year']} by year)")
        for h in s.get("hotspots", []):
            print(f"  · {h['name']}  ({round(h['intensity']*100)}% of signal)")
        return 0
    if args.review_cmd == "delete":
        print("deleted" if store.delete(args.id) else "no such review")
        return 0
    return 2


def cmd_serve(args) -> int:
    from . import server
    server.serve(port=args.port, host=args.host, demo_seed=not args.no_demo)
    return 0


def cmd_console(args) -> int:
    """Print the Evidence-Health rollup — what changed across the monitored evidence base."""
    from . import demo, entities
    demo.ensure_seeded()
    s = entities.console_summary(workspace_id=args.workspace)
    print(f"EVIDENCE HEALTH\n\n  {s['claims_monitored']} claims monitored")
    print(f"  ↑ {s['strengthened']} strengthened   ↓ {s['weakened']} weakened   "
          f"⚠ {s['newly_contradicted']} newly contradicted   ● {s['new_studies']} new studies")
    print(f"  {s['open_alerts']} open alert(s)\n")
    if s["by_area"]:
        print("  Therapeutic areas:")
        for a in s["by_area"]:
            print(f"    {(a['name'] or 'Unassigned'):<32} {a['claims']} claim(s), {a['changed']} changed, {a['alerts']} alert(s)")
    att = s.get("attention") or []
    if att:
        print("\n  Needs attention:")
        for c in att[:6]:
            print(f"    [{(c.get('top_severity') or '-').upper():<5}] {str(c['status'] or '-'):<12} {(c['claim'] or '')[:52]}")
    return 0


def cmd_graph(args) -> int:
    """Print the Evidence-Graph rollup — the cross-claim intelligence layer."""
    from . import demo, graph
    demo.ensure_seeded()
    g = graph.build(args.workspace)
    s = graph.summary(g=g)
    print("EVIDENCE GRAPH\n")
    print(f"  {s['claims']} claims · {s['studies']} studies · {s['edges']} links "
          f"· density {s['density']} studies/claim")
    print(f"  {s['hub_studies']} hub studies · {s['contested_studies']} contested "
          f"· {s['unstable_claims']} unstable claims · {s['evidence_gaps']} evidence gaps "
          f"· avg reliability {s['avg_reliability']}\n")
    print("  Hub studies (underpin the most claims):")
    for h in graph.hub_studies(g, limit=5):
        print(f"    x{h['claim_count']}  rel {h['reliability']:<5} {(h['title'] or '')[:56]}")
    contested = graph.contested_studies(g, limit=4)
    if contested:
        print("\n  Contested studies (cited both ways):")
        for c in contested:
            print(f"    ▲{c['support']} ▼{c['contradict']}  {(c['title'] or '')[:56]}")
    return 0


def cmd_changes(args) -> int:
    from . import demo, entities
    demo.ensure_seeded()
    feed = entities.changes_feed(workspace_id=args.workspace, limit=args.limit)
    if not feed:
        print("no evidence changes recorded yet.")
        return 0
    for a in feed:
        print(f"[{(a['severity'] or '-').upper():<5}] {a['headline']}")
        print(f"        {(a.get('claim') or '')[:64]}   ({(a.get('created') or '')[:10]})")
    return 0


def cmd_demo(args) -> int:
    from . import demo
    out = demo.seed_all(force=args.force)
    print("seeded demo data:")
    for i in out["reviews"]:
        print(f"  review  {i}")
    for i in out["claims"]:
        print(f"  claim   {i}")
    print("run `strata serve` and open http://127.0.0.1:8600/")
    return 0


# ------------------------------------------------------------------------ main
def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="strata",
                                description="The verification layer for medical AI.")
    sub = p.add_subparsers(dest="cmd", required=True)

    v = sub.add_parser("verify", help="check a medical claim against the evidence")
    v.add_argument("claim")
    v.add_argument("--json", action="store_true")
    v.set_defaults(fn=cmd_verify)

    m = sub.add_parser("monitor", help="continuously watch medical claims")
    msub = m.add_subparsers(dest="monitor_cmd", required=True)
    ma = msub.add_parser("add", help="start monitoring a claim")
    ma.add_argument("claim")
    ma.add_argument("--tenant", default=None)
    msub.add_parser("list", help="list monitored claims")
    mc = msub.add_parser("check", help="re-check a claim, report what changed")
    mc.add_argument("id")
    ms = msub.add_parser("show", help="show a claim's latest receipt")
    ms.add_argument("id")
    md = msub.add_parser("delete", help="stop monitoring a claim")
    md.add_argument("id")
    m.set_defaults(fn=cmd_monitor)

    s = sub.add_parser("serve", help="run the web app + Verify API")
    s.add_argument("-p", "--port", type=int, default=8600)
    s.add_argument("--host", default="127.0.0.1", help="bind host (0.0.0.0 in a container)")
    s.add_argument("--no-demo", action="store_true", help="don't seed demo data on an empty store")
    s.set_defaults(fn=cmd_serve)

    a = sub.add_parser("ask", help="one-shot graded answer (Lite engine)")
    a.add_argument("question")
    a.add_argument("-k", type=int, default=8)
    a.add_argument("--json", action="store_true")
    a.set_defaults(fn=cmd_ask)

    r = sub.add_parser("review", help="living systematic reviews")
    rsub = r.add_subparsers(dest="review_cmd", required=True)
    rc = rsub.add_parser("create")
    rc.add_argument("--title", required=True)
    rc.add_argument("--question", required=True)
    rc.add_argument("--levels", default="1,2,3")
    rc.add_argument("--since", type=int, default=None)
    rsub.add_parser("list")
    for name in ("sync", "show", "delete"):
        sp = rsub.add_parser(name)
        sp.add_argument("id")
    r.set_defaults(fn=cmd_review)

    co = sub.add_parser("console", help="print the Evidence-Health rollup (what changed)")
    co.add_argument("--workspace", default=None)
    co.set_defaults(fn=cmd_console)

    cg = sub.add_parser("changes", help="print the recent evidence-change alert feed")
    cg.add_argument("--workspace", default=None)
    cg.add_argument("--limit", type=int, default=20)
    cg.set_defaults(fn=cmd_changes)

    gr = sub.add_parser("graph", help="print the Evidence-Graph rollup (cross-claim intelligence)")
    gr.add_argument("--workspace", default=None)
    gr.set_defaults(fn=cmd_graph)

    d = sub.add_parser("demo", help="seed reproducible reviews + monitored claims")
    d.add_argument("--force", action="store_true")
    d.set_defaults(fn=cmd_demo)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
