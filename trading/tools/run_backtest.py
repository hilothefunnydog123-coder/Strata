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
    lookup,
    resample,
    summarise,
)
from strata_vp.gemini import read_api_key  # noqa: E402
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

    parser.add_argument("--instrument", default="MNQ", help="MNQ, NQ, MES, ES, MGC, M2K")
    parser.add_argument("--entry-mode", default="value_reentry", choices=["value_reentry", "outside_value"])
    parser.add_argument("--fill-mode", default="limit", choices=["limit", "market"])
    parser.add_argument("--stop-points", type=float, default=50.0)
    parser.add_argument(
        "--stop-mode", default="gap", choices=["fixed", "gap", "swing", "tighter_of"]
    )
    parser.add_argument("--swing-anchor", default="session", choices=["session", "excursion"])
    parser.add_argument(
        "--partial", type=float, default=0.5,
        help="fraction taken at the point of control; 0 takes the whole position there",
    )
    parser.add_argument(
        "--excursion-scope", default="session", choices=["session", "recent"],
    )
    parser.add_argument("--min-rr", type=float, default=1.0)
    parser.add_argument("--bin-size", type=float, default=1.0)
    parser.add_argument("--no-fvg", action="store_true", help="drop the fair value gap requirement")

    parser.add_argument(
        "--point-value", type=float, default=None,
        help="override the instrument's dollars per point per contract",
    )
    parser.add_argument("--tick-size", type=float, default=None)
    parser.add_argument("--account", type=float, default=50_000.0)
    parser.add_argument("--daily-loss", type=float, default=1_200.0)
    parser.add_argument("--trailing-dd", type=float, default=2_500.0)

    parser.add_argument(
        "--no-gemini", action="store_true",
        help="ignore GEMINI_API_KEY and run the deterministic classifier only",
    )
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

    instrument = lookup(args.instrument)
    tick_size = args.tick_size if args.tick_size is not None else instrument.tick_size
    point_value = args.point_value if args.point_value is not None else instrument.point_value
    print(f"{instrument.name}: tick {tick_size}, ${point_value} a point, "
          f"${instrument.commission_round_turn} round turn")

    config = StrategyConfig(
        tick_size=tick_size,
        point_value=point_value,
        bin_size=args.bin_size,
        entry_mode=args.entry_mode,
        excursion_scope=args.excursion_scope,
        fill_mode=args.fill_mode,
        require_fvg=not args.no_fvg,
        stop_points=args.stop_points,
        stop_mode=args.stop_mode,
        swing_anchor=args.swing_anchor,
        partial_fraction=args.partial,
        min_reward_risk=args.min_rr,
        # The ATR floor can push a stop past a cap derived from the flat
        # distance, so the cap has to clear it rather than silently reject
        # every trade on a volatile day.
        max_stop_points=max(args.stop_points * 1.2, args.stop_points + 10, 90.0),
    )
    rules = PropFirmRules(
        account_size=args.account,
        max_daily_loss=args.daily_loss,
        trailing_drawdown=args.trailing_dd,
    )
    costs = Costs(
        tick_size=tick_size,
        point_value=point_value,
        commission_per_contract=instrument.commission_round_turn,
    )

    # Gemini runs whenever a key is present. It used to be opt in behind a
    # flag, which meant the discretionary layer was off in every run anyone
    # actually did and the thing being measured was never the thing shipped.
    has_key = bool(read_api_key())
    use_gemini = has_key and not args.no_gemini
    if use_gemini:
        print("Gemini: on. Check it with tools/check_gemini.py if a run looks odd.")
    elif has_key:
        print("Gemini: off by request, deterministic classifier only")
    else:
        print("Gemini: no key found, deterministic classifier only "
              "(tools/check_gemini.py says where it looked)")
    judge = GeminiJudge(enabled=use_gemini)

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
                f"{row['reason']:<14} {row['pnl']:>9} ({row['r']:+.2f}R) "
                f"[{row['zone']}/{row['regime']}{', scaled' if len(row['legs']) > 1 else ''}]"
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
