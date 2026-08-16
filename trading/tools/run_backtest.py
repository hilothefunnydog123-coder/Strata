"""Run the strategy over a CSV, or over synthetic bars if you have none yet.

    python tools/run_backtest.py --synthetic --days 40
    python tools/run_backtest.py --csv nq_1m.csv --plan ny_vs_brief --signal-tf 5
    python tools/run_backtest.py --csv nq_1m.csv --entry-mode outside_value

The signal timeframe is separate from the profile timeframe on purpose. The
profile is always built from the 1 minute bars in the file, because that is
where its accuracy comes from, while signals are evaluated on a coarser
timeframe where a three bar imbalance means something. Passing --signal-tf 1
runs both at one minute and will produce a lot more noise.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from strata_vp import (  # noqa: E402
    Backtest,
    Costs,
    GeminiJudge,
    PLANS,
    PropFirmRules,
    StrategyConfig,
    load_csv,
    resample,
    summarise,
)
from tools.synth_data import generate  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--csv", help="1 minute OHLCV file with a header row")
    source.add_argument("--synthetic", action="store_true", help="generate bars instead")

    parser.add_argument("--days", type=int, default=30, help="synthetic days")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--plan", default="ny_vs_brief", choices=sorted(PLANS))
    parser.add_argument("--signal-tf", type=int, default=5, help="signal timeframe in minutes")

    parser.add_argument("--entry-mode", default="value_reentry", choices=["value_reentry", "outside_value"])
    parser.add_argument("--fill-mode", default="limit", choices=["limit", "market"])
    parser.add_argument("--stop-points", type=float, default=50.0)
    parser.add_argument("--stop-mode", default="fixed", choices=["fixed", "structure", "tighter_of"])
    parser.add_argument("--min-rr", type=float, default=1.2)
    parser.add_argument("--bin-size", type=float, default=1.0)
    parser.add_argument("--no-fvg", action="store_true", help="drop the fair value gap requirement")

    parser.add_argument(
        "--point-value",
        type=float,
        default=2.0,
        help="dollars per point per contract: 2 for MNQ, 20 for NQ, 5 for MES, 50 for ES",
    )
    parser.add_argument("--tick-size", type=float, default=0.25)
    parser.add_argument("--account", type=float, default=50_000.0)
    parser.add_argument("--daily-loss", type=float, default=1_200.0)
    parser.add_argument("--trailing-dd", type=float, default=2_500.0)

    parser.add_argument("--gemini", action="store_true", help="use the model, needs GEMINI_API_KEY")
    parser.add_argument("--trades", action="store_true", help="print every trade")
    parser.add_argument("--json", help="write the full result to this path")
    args = parser.parse_args()

    if args.synthetic:
        bars = generate(days=args.days, seed=args.seed)
        print(f"generated {len(bars)} synthetic 1 minute bars")
    else:
        bars = load_csv(args.csv)
        print(f"loaded {len(bars)} bars from {args.csv}")
    if not bars:
        print("no bars")
        return 1

    signal_bars = bars if args.signal_tf <= 1 else resample(bars, args.signal_tf)
    print(
        f"{bars[0].ts.date()} to {bars[-1].ts.date()}, "
        f"{len(signal_bars)} bars at {args.signal_tf} minutes"
    )

    config = StrategyConfig(
        tick_size=args.tick_size,
        point_value=args.point_value,
        bin_size=args.bin_size,
        entry_mode=args.entry_mode,
        fill_mode=args.fill_mode,
        require_fvg=not args.no_fvg,
        stop_points=args.stop_points,
        stop_mode=args.stop_mode,
        min_reward_risk=args.min_rr,
        max_stop_points=max(args.stop_points * 1.2, args.stop_points + 10),
    )
    rules = PropFirmRules(
        account_size=args.account,
        max_daily_loss=args.daily_loss,
        trailing_drawdown=args.trailing_dd,
    )
    costs = Costs(tick_size=args.tick_size, point_value=args.point_value)

    if args.gemini and not os.environ.get("GEMINI_API_KEY"):
        print("--gemini given but GEMINI_API_KEY is not set; running deterministic")
    judge = GeminiJudge(enabled=bool(args.gemini and os.environ.get("GEMINI_API_KEY")))

    backtest = Backtest(config, PLANS[args.plan], rules, costs, judge)
    result = backtest.run(signal_bars)

    print()
    print(summarise(result))

    if args.trades:
        print()
        print("Trades")
        for trade in result.trades:
            row = trade.as_dict()
            print(
                f"  {row['entered_at']}  {row['side']:<5} x{row['contracts']} "
                f"@{row['entry']:<10} stop {row['stop']:<10} target {row['target']:<10} "
                f"{row['reason']:<14} {row['pnl']:>9} ({row['r']:+.2f}R) [{row['zone']}/{row['regime']}]"
            )

    if args.json:
        payload = {
            "stats": result.stats(),
            "account": result.account,
            "blocked": result.blocked,
            "rejections": result.rejections,
            "trades": [trade.as_dict() for trade in result.trades],
        }
        Path(args.json).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"\nwrote {args.json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
