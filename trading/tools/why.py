"""Why was this trade not taken.

The tool for the argument that matters: you took a trade, the system did not,
and one of you is wrong. It replays the bars with every condition recorded and
prints them for the window you name, so the answer is a column rather than an
opinion.

    python3 tools/why.py --csv mnq_1m.csv --at "2026-06-10 07:15"
    python3 tools/why.py --csv mnq_1m.csv --date 2026-06-10          # whole session
    python3 tools/why.py --csv mnq_1m.csv --date 2026-06-10 --summary

Times are Pacific, the same way the sessions are written.

Reading the output. Every column has to be true in the right combination for a
long: `swept_lo` and `dev_lo` are the excursion, "oversold on both profiles".
`reclaim` is price back above the value area low. `<poc` is the rotation not
yet finished. `gapL` is a live bullish gap to trigger off. When all of those
are set and there is still no ticket, the `rejected` column says what stopped
it, and it is almost always the reward to risk test.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from strata_vp import PLANS, Strategy, StrategyConfig, load_csv, lookup, resample  # noqa: E402
from strata_vp.sessions import PACIFIC  # noqa: E402
from tools.synth_data import generate  # noqa: E402


def mark(value: bool) -> str:
    return "Y" if value else "."


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--csv", help="1 minute OHLCV file with a header row")
    source.add_argument("--synthetic", action="store_true")

    when = parser.add_mutually_exclusive_group(required=True)
    when.add_argument("--at", help='Pacific time of the trade, "YYYY-MM-DD HH:MM"')
    when.add_argument("--date", help="whole session, YYYY-MM-DD")

    parser.add_argument("--window", type=int, default=12, help="bars either side of --at")
    parser.add_argument("--summary", action="store_true", help="counts rather than bars")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--instrument", default="MNQ")
    parser.add_argument("--plan", default="ny_vs_brief", choices=sorted(PLANS))
    parser.add_argument("--signal-tf", type=int, default=5)
    args = parser.parse_args()

    instrument = lookup(args.instrument)
    bars = generate(days=args.days, seed=args.seed) if args.synthetic else load_csv(args.csv)
    signal_bars = bars if args.signal_tf <= 1 else resample(bars, args.signal_tf)

    config = StrategyConfig(
        tick_size=instrument.tick_size,
        point_value=instrument.point_value,
        bin_size=instrument.bin_size,
    )
    strategy = Strategy(config, PLANS[args.plan], trace=True)
    signals = []
    for bar in signal_bars:
        produced = strategy.on_bar(bar)
        if produced is not None:
            signals.append(produced)

    if args.at:
        target = datetime.strptime(args.at, "%Y-%m-%d %H:%M").replace(tzinfo=PACIFIC)
        span = timedelta(minutes=args.signal_tf * args.window)
        rows = [r for r in strategy.trace if abs(r["ts"] - target) <= span]
        heading = f"{args.at} Pacific, {args.window} bars either side"
    else:
        day = datetime.strptime(args.date, "%Y-%m-%d").date()
        rows = [r for r in strategy.trace if r["ts"].astimezone(PACIFIC).date() == day]
        heading = f"{args.date}, the whole session"

    if not rows:
        print(f"No bars traced for {heading}.")
        print("The session had no reference profile, or the date is outside the data.")
        first = strategy.trace[0]["ts"] if strategy.trace else None
        last = strategy.trace[-1]["ts"] if strategy.trace else None
        if first:
            print(f"Traced {first.astimezone(PACIFIC)} to {last.astimezone(PACIFIC)}.")
        return 1

    reference = rows[0]
    print(f"{heading}")
    print(
        f"levels: VAL {reference['ref_val']}  POC {reference['ref_poc']}  "
        f"VAH {reference['ref_vah']}   ATR {reference['atr']}"
    )
    print()

    if args.summary:
        from collections import Counter

        counts = Counter()
        for row in rows:
            for name in (
                "swept_low", "swept_high", "below_dev_val", "above_dev_vah",
                "reclaimed_low", "below_poc",
            ):
                counts[name] += 1 if row[name] else 0
            counts["gap_long_live"] += 1 if row["gap_long"] else 0
            counts["gap_short_live"] += 1 if row["gap_short"] else 0
            counts["armed"] += 1 if row["armed"] else 0
        print(f"{len(rows)} bars in the session")
        for name, value in counts.most_common():
            print(f"  {value:>4} / {len(rows)}  {name}")
        rejections = Counter(r for row in rows for r in row["rejected"])
        if rejections:
            print("\nrejections")
            for reason, count in rejections.most_common():
                print(f"  {count:>4}  {reason}")
        taken = [s for s in signals if s.ts.astimezone(PACIFIC).date() == rows[0]["ts"].astimezone(PACIFIC).date()]
        print(f"\ntickets produced: {len(taken)}")
        for one in taken:
            print(
                f"  {one.ts.astimezone(PACIFIC).strftime('%H:%M')}  {one.side:<5} "
                f"{one.entry} stop {one.stop} target {one.target}"
            )
        return 0

    print(
        "time   close    swept_lo dev_lo reclaim <poc | swept_hi dev_hi reclaim >poc | "
        "gapL gapS armed  rejected"
    )
    for row in rows:
        local = row["ts"].astimezone(PACIFIC).strftime("%H:%M")
        armed = ",".join(row["armed"]) or "-"
        print(
            f"{local}  {row['close']:>9}   "
            f"{mark(row['swept_low'])}       {mark(row['below_dev_val'])}      "
            f"{mark(row['reclaimed_low'])}       {mark(row['below_poc'])}  | "
            f"{mark(row['swept_high'])}        {mark(row['above_dev_vah'])}      "
            f"{mark(row['reclaimed_high'])}       {mark(not row['below_poc'])}  | "
            f"{row['gap_long']:>3}  {row['gap_short']:>3}  {armed:<6} "
            f"{'; '.join(row['rejected'])}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
