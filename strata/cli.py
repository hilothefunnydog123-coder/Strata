"""Command line.

    strata ask "Does vitamin D prevent respiratory infections?"
    strata ask "..." --explain --show-query
    strata ask "..." --json
    strata compare metformin sulfonylurea --outcome "cardiovascular mortality"
    strata serve
    strata nn info | train | eval | predict
    strata cache info | clear | prune

Every command that reaches the network exits non-zero with a readable message
rather than a traceback when it cannot: a certificate problem on a school network
is a configuration issue, not a crash, and it deserves an explanation.
"""
from __future__ import annotations

import argparse
import json
import sys

from . import __version__


# --------------------------------------------------------------------- ask

def cmd_ask(args) -> int:
    from . import report
    from .query import ask

    generate = _load_model(args.model) if args.model else None
    result = ask(args.question, k=args.k, retmax=args.retmax, generate=generate,
                 use_nn=not args.no_nn, design=args.design, years=args.years,
                 explain=args.explain)

    if args.json:
        print(json.dumps(result.as_dict(), indent=2, default=str))
    elif args.markdown:
        from .server import to_markdown
        print(to_markdown(result))
    elif args.bibtex:
        from .server import to_bibtex
        print(to_bibtex(result))
    else:
        print(report.render(result, explain=args.explain,
                            show_query=args.show_query))
    # A question with no retrieved evidence is a legitimate answer, not a
    # failure, so this still exits zero.
    return 0


def _load_model(spec: str):
    """Resolve ``--model pkg.module:function`` into a callable.

    Strata never bundles a model. The narrative mode takes any text-in/text-out
    function, and this is how you point at yours from the command line.
    """
    if ":" not in spec:
        raise SystemExit(f"--model expects 'module:function', got {spec!r}")
    module_name, func_name = spec.split(":", 1)
    import importlib
    try:
        module = importlib.import_module(module_name)
    except ImportError as exc:
        raise SystemExit(f"could not import {module_name}: {exc}") from exc
    fn = getattr(module, func_name, None)
    if not callable(fn):
        raise SystemExit(f"{spec} is not callable")
    return fn


# ----------------------------------------------------------------- compare

def cmd_compare(args) -> int:
    from .query import compare
    c = compare(args.a, args.b, outcome=args.outcome or "", k=args.k,
                use_nn=not args.no_nn)
    if args.json:
        print(json.dumps(c.as_dict(), indent=2, default=str))
        return 0

    from . import report
    print()
    print(report.c("1", c.question))
    print()
    for label, res in ((args.a, c.left), (args.b, c.right)):
        print(f"  {report.c('1', label)}  {report.strength_badge(res.body.overall_strength)}")
        print(f"    {res.body.summary}")
        if res.consensus is not None and res.consensus.direction != "insufficient":
            print(f"    {res.consensus.summary}")
        print()
    print(report.c("1", "Verdict"))
    for line in _wrap(c.verdict, 84):
        print("  " + line)
    print()
    return 0


def _wrap(text: str, width: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}" if cur else w
    if cur:
        lines.append(cur)
    return lines


# ------------------------------------------------------------------- serve

def cmd_serve(args) -> int:
    from . import server
    server.serve(port=args.port, host=args.host, k=args.k,
                 allow_remote=args.allow_remote)
    return 0


# ---------------------------------------------------------------------- nn

def cmd_nn_info(args) -> int:
    from .nn.build import describe
    rows = describe()
    if args.json:
        print(json.dumps(rows, indent=2, default=str))
        return 0

    any_present = False
    for row in rows:
        name = row["name"]
        if not row.get("present"):
            print(f"  {name:<10} not trained — run `strata nn train`")
            continue
        if row.get("error"):
            print(f"  {name:<10} unreadable: {row['error']}")
            continue
        any_present = True
        meta = row.get("meta", {})
        print(f"  {name:<10} {row['kind']}  {row['size_kb']:.0f} KB")
        print(f"             task     {meta.get('task', '—')}")
        print(f"             corpus   {meta.get('corpus', '—')}  "
              f"(built {meta.get('built', '—')})")
        score = meta.get("macro_f1")
        if score is not None:
            extra = (f", ECE {meta['ece']:.3f}" if meta.get("ece") is not None else "")
            print(f"             held-out macro-F1 {score:.3f}{extra} "
                  f"on {meta.get('n_val', '?')} examples")
        if row.get("labels"):
            print(f"             labels   {', '.join(row['labels'])}")
        print()

    if any_present:
        print("  Note: models shipped with this repository are trained on the "
              "synthetic\n  seed corpus. Those scores describe that corpus, not "
              "real PubMed text.\n  Run `strata nn train --source pubmed` to "
              "retrain on real records.")
    return 0


def cmd_nn_train(args) -> int:
    from .nn.build import build
    only = set(args.only) if args.only else None
    summary = build(source=args.source, per_class=args.per_class,
                    epochs=args.epochs, only=only, dtype=args.dtype)
    if args.json:
        print(json.dumps(summary, indent=2, default=str))
    return 0


def cmd_nn_eval(args) -> int:
    """Re-score the shipped checkpoints against a freshly generated corpus."""
    from .nn import corpus as corpus_mod
    from .nn import design_net, rigour_net, stance_net
    from .nn.corpus import RIGOUR_LABELS
    from .nn.train import evaluate, _collect, _label_scores

    if args.probes:
        return _eval_probes(args)

    examples = corpus_mod.seed_corpus(n_per_design=args.per_class)
    _, val = corpus_mod.split(examples)
    print(f"Evaluating on {len(val):,} held-out examples "
          f"(topics, templates and safeguard phrasings unseen)\n")

    out = {}
    net = design_net()
    if net:
        rep = evaluate(net, val, "design")
        print("── design " + "─" * 44)
        print(rep.table())
        print(f"\naccuracy {rep.accuracy:.3f} · ECE {rep.ece:.3f}\n")
        print(rep.confusion_table(), "\n")
        out["design"] = rep.as_dict()

    net = stance_net()
    if net:
        rep = evaluate(net, [e for e in val if e.stance], "stance")
        print("── stance " + "─" * 44)
        print(rep.table())
        print(f"\naccuracy {rep.accuracy:.3f} · ECE {rep.ece:.3f}\n")
        out["stance"] = rep.as_dict()

    net = rigour_net()
    if net:
        pv, gv = _collect(net, val, RIGOUR_LABELS)
        per_label, macro, micro = _label_scores(pv, gv, net.thresholds)
        print("── safeguards " + "─" * 40)
        for lab in RIGOUR_LABELS:
            m = per_label[lab]
            print(f"  {lab:<22} P {m['precision']:.3f}  R {m['recall']:.3f}  "
                  f"F1 {m['f1']:.3f}  (n={m['support']})")
        print(f"\n  macro-F1 {macro:.3f} · micro-F1 {micro:.3f}\n")
        out["rigour"] = {"macro_f1": macro, "micro_f1": micro,
                         "per_label": per_label}

    if not out:
        print("No trained networks found. Run `strata nn train`.")
        return 1
    if args.json:
        print(json.dumps(out, indent=2, default=str))
    return 0


def _eval_probes(args) -> int:
    """Score the networks on the hand-written adversarial probes.

    These are the cases where the surface vocabulary points the wrong way. The
    seed-corpus numbers say the models learned the corpus; this says whether that
    generalises to text written to mislead them.
    """
    from . import report
    from .nn import design_net, probes, rigour_net, stance_net

    net = design_net()
    if net is None:
        print("No design network trained. Run `strata nn train`.", file=sys.stderr)
        return 1

    out = {}
    d = probes.evaluate_design(net)
    out["design"] = {k: v for k, v in d.items() if k != "rows"}
    print(report.c("1", "Design — adversarial probes"))
    print(f"  {d['correct']}/{d['n']} correct ({d['accuracy']:.0%})\n")
    for row in d["rows"]:
        mark = report.c("32", "✓") if row["ok"] else report.c("31", "✗")
        got = row["predicted"] if row["ok"] else \
            f"{row['predicted']} (expected {row['expected']})"
        print(f"  {mark} {got:<44} {row['confidence']:.0%}")
        print(report.c("2", f"      {row['why']}"))
    print()

    s = probes.evaluate_stance()
    out["stance"] = {k: v for k, v in s.items() if k != "rows"}
    print(report.c("1", "Stance — adversarial probes")
          + report.c("2", "  (rule engine, strata.stance — not a network)"))
    print(f"  coverage {s['fired']}/{s['n']} ({s['coverage']:.0%})"
          f" · precision {s['correct']}/{s['fired']} ({s['precision']:.0%})\n")
    for row in s["rows"]:
        if row["predicted"] is None:
            print(report.c("2", f"    abstained (expected {row['expected']})"))
        elif not row["ok"]:
            print(report.c("31", f"    predicted {row['predicted']}, "
                                 f"expected {row['expected']} "
                                 f"via {row['decided_by']}"))
    print()

    if stance_net() is not None:
        alt = probes.evaluate_stance(stance_net())
        print(report.c("2", f"  (a trained stance network scores "
                            f"{alt['correct']}/{alt['n']} = {alt['accuracy']:.0%} "
                            f"here, labelling every probe)\n"))

    r_net = rigour_net()
    if r_net is not None:
        r = probes.evaluate_rigour(r_net)
        out["rigour"] = {k: v for k, v in r.items() if k != "rows"}
        print(report.c("1", "Safeguards — adversarial probes"))
        print(f"  precision {r['precision']:.2f} · recall {r['recall']:.2f} "
              f"· F1 {r['f1']:.2f}  over {r['n']} annotated probes\n")
        for row in r["rows"]:
            if row["missed"] or row["spurious"]:
                bits = []
                if row["missed"]:
                    bits.append("missed " + ", ".join(row["missed"]))
                if row["spurious"]:
                    bits.append("spurious " + ", ".join(row["spurious"]))
                print(report.c("2", "    " + "; ".join(bits)))
        print()

    if args.json:
        print(json.dumps(out, indent=2, default=str))
    return 0


def cmd_nn_predict(args) -> int:
    """Run the networks over a piece of text and show what they saw."""
    from .nn import design_net, rigour_net, stance_net
    text = args.text
    if text == "-":
        text = sys.stdin.read()
    if not text.strip():
        print("Nothing to classify.", file=sys.stderr)
        return 1

    from . import report
    net = design_net()
    if net:
        p = net.predict(text)
        print(report.c("1", "Design"),
              f"{p.label}  ({p.confidence:.0%} confident, "
              f"margin {p.margin:.2f}{'' if p.is_confident else ', LOW'})")
        for phrase, w in p.evidence_spans:
            print(report.c("2", f'    {w:>5.2f}  "{phrase}"'))
        print()

    from . import stance as stance_mod
    from .stats import extract_effects, primary_effect
    effect = primary_effect(extract_effects(text))
    st = stance_mod.infer(text, effect)
    print(report.c("1", "Stance"),
          f"{st.label or 'abstained'}"
          + (f"  ({st.confidence:.0%}, via {st.decided_by})" if st.label else ""))
    counts = stance_mod.cue_counts(text)
    if any(counts.values()):
        print(report.c("2", "    cues: " + ", ".join(
            f"{k}×{v}" for k, v in counts.items() if v)))
    if effect is not None:
        print(report.c("2", f"    effect: {effect.format()}"))
    print()

    net = rigour_net()
    if net:
        p = net.predict_labels(text)
        print(report.c("1", "Safeguards"))
        for lab, prob in sorted(p.probs.items(), key=lambda kv: -kv[1]):
            mark = "✓" if lab in p.present else "·"
            print(f"    {mark} {lab:<22} {prob:.2f}  "
                  + report.c("2", f"(threshold {p.thresholds[lab]:.2f})"))
    return 0


def cmd_nn_harvest(args) -> int:
    from .nn import corpus as corpus_mod
    print(f"Harvesting up to {args.per_class} records per class from PubMed…")
    examples = corpus_mod.harvest(per_class=args.per_class)
    labelled = sum(1 for e in examples if e.stance)
    print(f"\n{len(examples):,} records; {labelled:,} carry a weak stance label.")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump([{"text": e.text, "design": e.design, "stance": e.stance,
                        "question": e.question, "source": e.source}
                       for e in examples], fh, indent=1)
        print(f"written to {args.out}")
    return 0


# ------------------------------------------------------------------- cache

def cmd_cache(args) -> int:
    from . import cache
    if args.action == "clear":
        print(f"removed {cache.clear()} cached responses")
    elif args.action == "prune":
        print(f"removed {cache.prune()} expired responses")
    else:
        s = cache.stats()
        print(f"  path     {s['path']}")
        print(f"  entries  {s['entries']:,}")
        print(f"  size     {s['bytes'] / 1024:.0f} KB")
        if s["oldest_age_days"] is not None:
            print(f"  oldest   {s['oldest_age_days']} days")
    return 0


# -------------------------------------------------------------------- main

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="strata",
        description="A medical evidence engine that grades the strength of its answers.")
    p.add_argument("--version", action="version", version=f"strata {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("ask", help="ask a clinical question")
    a.add_argument("question")
    a.add_argument("-k", type=int, default=8, help="sources to weigh (default 8)")
    a.add_argument("--retmax", type=int, default=40,
                   help="records to retrieve before ranking (default 40)")
    a.add_argument("--design", choices=["systematic_review", "rct", "trials",
                                        "observational", "guideline"],
                   help="restrict the search to one level of the pyramid")
    a.add_argument("--years", type=int, help="only papers from the last N years")
    a.add_argument("--model", metavar="MODULE:FUNC",
                   help="a text-in/text-out callable for the narrative mode")
    a.add_argument("--explain", action="store_true",
                   help="show the phrases the networks attended to")
    a.add_argument("--show-query", action="store_true",
                   help="show the parsed PICO and the PubMed query used")
    a.add_argument("--no-nn", action="store_true",
                   help="rule-based grading only, for comparison")
    fmt = a.add_mutually_exclusive_group()
    fmt.add_argument("--json", action="store_true")
    fmt.add_argument("--markdown", action="store_true")
    fmt.add_argument("--bibtex", action="store_true")
    a.set_defaults(fn=cmd_ask)

    cp = sub.add_parser("compare", help="compare the evidence for two interventions")
    cp.add_argument("a")
    cp.add_argument("b")
    cp.add_argument("--outcome", help="the outcome both should be judged on")
    cp.add_argument("-k", type=int, default=6)
    cp.add_argument("--no-nn", action="store_true")
    cp.add_argument("--json", action="store_true")
    cp.set_defaults(fn=cmd_compare)

    s = sub.add_parser("serve", help="run the web app on localhost")
    s.add_argument("-p", "--port", type=int, default=8600)
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("-k", type=int, default=8)
    s.add_argument("--allow-remote", action="store_true",
                   help="permit binding a non-loopback address (no auth — be sure)")
    s.set_defaults(fn=cmd_serve)

    n = sub.add_parser("nn", help="the neural layer")
    nsub = n.add_subparsers(dest="nn_cmd", required=True)

    ni = nsub.add_parser("info", help="what is trained, on what, and how well")
    ni.add_argument("--json", action="store_true")
    ni.set_defaults(fn=cmd_nn_info)

    nt = nsub.add_parser("train", help="train the networks and write checkpoints")
    nt.add_argument("--source", choices=["seed", "pubmed"], default="seed")
    nt.add_argument("--per-class", type=int, default=300)
    nt.add_argument("--epochs", type=int, default=10)
    nt.add_argument("--only", nargs="+", choices=["design", "stance", "rigour"])
    nt.add_argument("--dtype", choices=["int8", "f32"], default="int8")
    nt.add_argument("--json", action="store_true")
    nt.set_defaults(fn=cmd_nn_train)

    ne = nsub.add_parser("eval", help="re-score the checkpoints on held-out data")
    ne.add_argument("--per-class", type=int, default=300)
    ne.add_argument("--probes", action="store_true",
                    help="score the hand-written adversarial probes instead")
    ne.add_argument("--json", action="store_true")
    ne.set_defaults(fn=cmd_nn_eval)

    np_ = nsub.add_parser("predict", help="classify a piece of text and explain why")
    np_.add_argument("text", help="the text, or - to read stdin")
    np_.set_defaults(fn=cmd_nn_predict)

    nh = nsub.add_parser("harvest", help="build a training corpus from real PubMed")
    nh.add_argument("--per-class", type=int, default=400)
    nh.add_argument("--out", help="write the corpus to a JSON file")
    nh.set_defaults(fn=cmd_nn_harvest)

    c = sub.add_parser("cache", help="inspect or clear the PubMed response cache")
    c.add_argument("action", nargs="?", default="info",
                   choices=["info", "clear", "prune"])
    c.set_defaults(fn=cmd_cache)

    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.fn(args)
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130
    except SystemExit:
        raise
    except Exception as exc:
        # Network and configuration problems are the common case and deserve a
        # sentence, not a traceback. STRATA_DEBUG=1 restores the traceback.
        import os
        if os.environ.get("STRATA_DEBUG") == "1":
            raise
        print(f"strata: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
