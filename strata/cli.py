"""Command line for Strata — the evidence engine and the platform around it.

    strata verify "<claim>"          verify a claim; show the full evidence trail
    strata ask "<question>"          the classic grounded digest
    strata serve                     run the web app + API on localhost
    strata seed                      populate a synthetic demo evidence base
    strata claim add "<claim>"       add a claim to the store (with PICO)
    strata claim list                list stored claims and their status
    strata monitor run [--claim ID]  re-verify claim(s); detect and alert on change
    strata apikey create --org NAME  mint an API key (shown once)
    strata apikey list | revoke ID   manage API keys
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


def cmd_verify(args) -> int:
    from .verify import verify
    v = verify(args.claim, k=args.k)
    if args.json:
        print(json.dumps(v.to_dict(), indent=2, default=str))
    else:
        print(report.render_verdict(v))
    return 0


def cmd_serve(args) -> int:
    from . import server
    server.serve(port=args.port, host=args.host, db_path=args.db, seed=not args.no_seed)
    return 0


def cmd_seed(args) -> int:
    from .db import get_db
    from .seed import seed_demo
    db = get_db(args.db)
    ws = seed_demo(db)
    print(f"Seeded synthetic demo workspace (id={ws}) into {db.path}")
    print(f"Claims: {len(db.list_claims(ws))}   ·   run `strata serve` and open /console")
    return 0


def cmd_claim_add(args) -> int:
    from .db import get_db
    from .claims import create_claim_from_question
    from .monitor import create_monitor
    db = get_db(args.db)
    org = db.get_or_create_org(args.org)
    ws = db.get_or_create_workspace(org, args.workspace)
    cid = create_claim_from_question(db, ws, args.claim, therapeutic_area=args.area)
    if args.monitor:
        create_monitor(db, cid, frequency=args.frequency)
    print(f"Created claim {cid} in {args.org}/{args.workspace}"
          + (f" (monitoring {args.frequency})" if args.monitor else ""))
    print("Run `strata monitor run --claim %d` to establish the baseline assessment." % cid)
    return 0


def cmd_claim_list(args) -> int:
    from .db import get_db
    db = get_db(args.db)
    rows = db.query("SELECT c.*, w.name AS ws FROM claims c JOIN workspaces w ON w.id=c.workspace_id "
                    "ORDER BY c.updated_at DESC LIMIT ?", (args.limit,))
    if not rows:
        print("No claims yet. Add one with `strata claim add \"...\"` or run `strata seed`.")
        return 0
    for c in rows:
        print(f"  #{c['id']:<4} [{c['status']:>20}/{c['evidence_strength']:>9}] "
              f"{c['trend']:>13} v{c['current_version']}  {c['text'][:64]}")
    return 0


def cmd_monitor_run(args) -> int:
    from .db import get_db
    from .monitor import run_monitor, run_due
    db = get_db(args.db)
    if args.claim:
        res = run_monitor(db, args.claim)
        _print_monitor_result(res)
    else:
        results = run_due(db)
        if not results:
            print("No monitors are due.")
        for res in results:
            _print_monitor_result(res)
    return 0


def _print_monitor_result(res) -> None:
    if res.get("error"):
        print(f"  claim {res['claim_id']}: error — {res['error']}")
        return
    tag = "baseline" if res.get("baseline") else ("no change" if not res["material"] else res["trend"])
    print(f"  claim {res['claim_id']}: v{res['version']} · {tag} · "
          f"{res['events']} change event(s), {res['alerts']} alert(s)")


def cmd_apikey_create(args) -> int:
    from .db import get_db
    db = get_db(args.db)
    org = db.get_or_create_org(args.org)
    scopes = args.scopes.split(",") if args.scopes else None
    k = db.create_api_key(org, args.name, rate_limit_per_min=args.rate, scopes=scopes)
    print("API key created (this is shown ONCE — store it now):\n")
    print(f"    {k['key']}\n")
    print(f"  org: {args.org}   rate limit: {k['rate_limit_per_min']}/min")
    return 0


def cmd_apikey_list(args) -> int:
    from .db import get_db
    db = get_db(args.db)
    rows = db.query("SELECT k.id, k.name, k.prefix, k.active, k.rate_limit_per_min, "
                    "o.name AS org FROM api_keys k LEFT JOIN organizations o ON o.id=k.org_id "
                    "ORDER BY k.created_at DESC")
    if not rows:
        print("No API keys. Create one with `strata apikey create --org ... --name ...`")
        return 0
    for r in rows:
        state = "active" if r["active"] else "revoked"
        print(f"  #{r['id']:<3} {r['prefix']}…  {state:>7}  {r['rate_limit_per_min']}/min  "
              f"{r['org'] or '-'}  ({r['name']})")
    return 0


def cmd_apikey_revoke(args) -> int:
    from .db import get_db
    db = get_db(args.db)
    db.revoke_api_key(args.id)
    print(f"Revoked API key #{args.id}.")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        prog="strata", description="Continuous Evidence Intelligence for medicine.")
    p.add_argument("--db", default=None, help="path to the Strata database (default: $STRATA_DB or strata.db)")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("ask", help="grounded evidence digest for a question")
    a.add_argument("question")
    a.add_argument("-k", type=int, default=8)
    a.add_argument("--json", action="store_true")
    a.set_defaults(fn=cmd_ask)

    ver = sub.add_parser("verify", help="verify a claim; show supporting vs contradicting evidence")
    ver.add_argument("claim")
    ver.add_argument("-k", type=int, default=10)
    ver.add_argument("--json", action="store_true")
    ver.set_defaults(fn=cmd_verify)

    s = sub.add_parser("serve", help="run the web app + API")
    s.add_argument("-p", "--port", type=int, default=8600)
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--no-seed", action="store_true", help="do not seed demo data")
    s.set_defaults(fn=cmd_serve)

    sd = sub.add_parser("seed", help="populate a synthetic demo evidence base")
    sd.set_defaults(fn=cmd_seed)

    cl = sub.add_parser("claim", help="manage claims")
    clsub = cl.add_subparsers(dest="sub", required=True)
    ca = clsub.add_parser("add")
    ca.add_argument("claim")
    ca.add_argument("--org", default="My Organization")
    ca.add_argument("--workspace", default="Default")
    ca.add_argument("--area", default=None)
    ca.add_argument("--monitor", action="store_true")
    ca.add_argument("--frequency", default="weekly", choices=["daily", "weekly", "monthly"])
    ca.set_defaults(fn=cmd_claim_add)
    ccl = clsub.add_parser("list")
    ccl.add_argument("--limit", type=int, default=100)
    ccl.set_defaults(fn=cmd_claim_list)

    mon = sub.add_parser("monitor", help="run evidence-change monitoring")
    monsub = mon.add_subparsers(dest="sub", required=True)
    mr = monsub.add_parser("run")
    mr.add_argument("--claim", type=int, default=None, help="a specific claim id (default: all due)")
    mr.set_defaults(fn=cmd_monitor_run)

    ak = sub.add_parser("apikey", help="manage API keys")
    aksub = ak.add_subparsers(dest="sub", required=True)
    akc = aksub.add_parser("create")
    akc.add_argument("--org", required=True)
    akc.add_argument("--name", default="default")
    akc.add_argument("--rate", type=int, default=60)
    akc.add_argument("--scopes", default=None, help="comma-separated (verify,search,monitor or *)")
    akc.set_defaults(fn=cmd_apikey_create)
    akl = aksub.add_parser("list"); akl.set_defaults(fn=cmd_apikey_list)
    akr = aksub.add_parser("revoke"); akr.add_argument("id", type=int); akr.set_defaults(fn=cmd_apikey_revoke)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
