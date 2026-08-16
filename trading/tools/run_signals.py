"""Replay bars and print the trade tickets the system would have sent.

    python3 tools/run_signals.py --synthetic --days 10
    python3 tools/run_signals.py --csv mnq_1m.csv --jsonl signals.jsonl
    python3 tools/run_signals.py --csv mnq_1m.csv --discord https://discord.com/api/webhooks/...

There is no execution here. The output is a ticket to type into the DOM. Use
the same command with `--jsonl` to keep a record, then compare it against what
you actually took: the gap between the two is the part of the system that is
you, and it is worth measuring.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from strata_vp import (  # noqa: E402
    ConsoleSink,
    GeminiJudge,
    JsonlSink,
    Notifier,
    PLANS,
    PropFirmRules,
    RiskManager,
    Strategy,
    StrategyConfig,
    TelegramSink,
    WebhookSink,
    load_csv,
    lookup,
    resample,
)
from strata_vp.runner import replay  # noqa: E402
from strata_vp.gemini import read_api_key  # noqa: E402
from tools.synth_data import generate  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--csv", help="1 minute OHLCV file with a header row")
    source.add_argument("--synthetic", action="store_true")

    parser.add_argument("--days", type=int, default=10)
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--instrument", default="MNQ")
    parser.add_argument("--plan", default="ny_vs_brief", choices=sorted(PLANS))
    parser.add_argument("--signal-tf", type=int, default=5)

    parser.add_argument("--jsonl", help="append every ticket to this file")
    parser.add_argument("--discord", help="Discord webhook URL")
    parser.add_argument("--slack", help="Slack webhook URL")
    parser.add_argument("--telegram", help="bot token; needs --chat-id")
    parser.add_argument("--chat-id")
    parser.add_argument("--quiet", action="store_true", help="no console output")

    parser.add_argument("--no-gemini", action="store_true",
                        help="ignore GEMINI_API_KEY and run deterministic only")
    parser.add_argument("--account", type=float, default=50_000.0)
    args = parser.parse_args()

    instrument = lookup(args.instrument)
    bars = (
        generate(days=args.days, seed=args.seed)
        if args.synthetic
        else load_csv(args.csv)
    )
    signal_bars = bars if args.signal_tf <= 1 else resample(bars, args.signal_tf)

    sinks = []
    if not args.quiet:
        sinks.append(ConsoleSink())
    if args.jsonl:
        sinks.append(JsonlSink(args.jsonl))
    if args.discord:
        sinks.append(WebhookSink(args.discord, style="discord"))
    if args.slack:
        sinks.append(WebhookSink(args.slack, style="slack"))
    if args.telegram:
        if not args.chat_id:
            parser.error("--telegram needs --chat-id")
        sinks.append(TelegramSink(args.telegram, args.chat_id))

    notifier = Notifier(sinks)
    config = StrategyConfig(
        tick_size=instrument.tick_size,
        point_value=instrument.point_value,
        bin_size=instrument.bin_size,
    )
    use_gemini = bool(read_api_key()) and not args.no_gemini
    print(f"Gemini: {'on' if use_gemini else 'off, deterministic classifier only'}")
    judge = GeminiJudge(enabled=use_gemini)
    strategy = Strategy(config, PLANS[args.plan], judge)
    risk = RiskManager(PropFirmRules(account_size=args.account))

    tickets = replay(signal_bars, strategy, risk, notifier, instrument)

    sessions = {PLANS[args.plan].trade.anchor_date(t.signal.ts) for t in tickets}
    print()
    print(f"{len(tickets)} tickets across {len(sessions)} sessions")
    if notifier.duplicates:
        print(f"{notifier.duplicates} duplicates suppressed")
    if notifier.failures:
        print(f"{notifier.failures} sink failures (see the log)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
