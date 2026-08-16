# Strata VP

A session volume profile **signal engine** for MNQ on a funded account. It
tells you the trade. You place it.

Python 3.11, standard library only. No pip install, no data subscription, no
paid charting tier.

```
cd trading
python3 tools/run_signals.py  --synthetic --days 10          # tickets
python3 tools/why.py --synthetic --date 2026-06-09 --summary # why not this one
python3 tools/run_backtest.py --synthetic --days 90 --trades # did they work
python3 -m unittest discover -s tests -t .                   # 130 tests
```

A ticket looks like this, and is meant to be typed into a DOM in fifteen
seconds:

```
LONG MNQ x5   09:15 PT
  limit     19938.00   (midpoint of the gap)
  stop      19923.00   15.00 pt   $150
  target    19953.50   point of control
  runner    19984.00   50% off at the target, stop to breakeven, rest here
  R:R           2.05
  levels  VAL 19935.00  POC 19953.50  VAH 19984.00
  why     swept value area low, reclaimed, downtrend
```

---

## Read this before you build anything

There is no execution layer, and that is not a gap waiting to be filled.
Tradovate gates API access behind an add on and the prop firm decides
separately on top of that, so this account cannot place an automated order at
all. Everything below is built around that rather than in spite of it.

**The Pine scripts are the live half of the system.** They are not a
decoration. They compute the profile, the gaps, the arm and trigger states and
the full trade ticket on the chart during the session, using the same
arithmetic as the Python engine including the reward to risk test, so a setup
the engine would reject is not drawn either.

There are two, and they share their rules line for line:

- `strata_volume_profile.pine` is the indicator. Load it, set the two session
  strings, and create alerts on "Volume profile long" and "Volume profile
  short". This is what runs during the session.
- `strata_volume_profile_strategy.pine` is the same thing wired into the
  Strategy Tester, so TradingView grades it on your own data. Run it on a
  5 minute chart, and leave "Recalculate on every tick" and "after order is
  filled" off: both let a strategy act inside a bar it has not finished seeing,
  which is the usual way a Pine backtest reports a curve it cannot repeat.

Both draw each signal the way you would draw it by hand. Green box from the
entry up to the point of control, a paler green box on to the far side of value
where the runner goes, red box from the entry down to the stop, and a label
with the prices, the risk in points and dollars, and the reward to risk.

TradingView cannot send a webhook on the free plan, but it does not need to.
The alert messages interpolate the actual prices, so the popup and the email
carry the entry, the stop and both targets and the trade can be placed straight
from the alert without opening the chart.

**The Python engine is the research half.** It decides what the parameters
should be, proves the rules are internally consistent, and replays exported
bars into the same tickets so the chart and the backtest can be checked against
each other. `tools/run_signals.py` is that replay. `strata_vp/runner.py` will
also run it live against any bar source, with sinks for the console, a JSONL
file, Discord, Slack and Telegram, if a feed ever turns up. Nothing in it
places an order.

An execution adapter for Tradovate existed briefly and is in the git history at
`089f315` if API access ever appears. It is not in the tree, because shipping a
path that cannot be used invites trusting it.

**A flat 50 point stop cannot pay for a point of control target.** This is the
one real problem with the strategy as briefed, and it is arithmetic rather than
opinion. The distance from the value area low to the point of control is
roughly half a value area width, which on an overnight profile is commonly 20
to 40 points. Risking 50 to make 30 is 0.6 to 1. That needs a 63 percent win
rate before costs just to break even, and mean reversion into value does not
win 63 percent of the time.

The engine does not paper over it. `min_reward_risk` rejects the trade and the
strategy stands down. Ten points past the far edge of the gap, which is the
other stop in the brief, is 13 points on average and works. On 90 days of
synthetic MNQ bars, 65 sessions:

| Configuration | Trades | Per session | Win rate | Expectancy |
| --- | --- | --- | --- | --- |
| Flat 50 point stop | 0 | | | |
| **10 past the gap, midpoint entry, runner** | **58** | **0.89** | **43%** | **+0.21 R** |
| 10 past the gap, no runner | 48 | 0.74 | 31% | +0.11 R |
| Entry at the near edge instead of the middle | 54 | 0.83 | 54% | +0.14 R |
| Entry at the far edge instead of the middle | 58 | 0.89 | 29% | +0.12 R |
| Entering below value instead of on the reclaim | 61 | 0.94 | 46% | +0.21 R |

Synthetic bars, so none of that says the strategy makes money. What it does say
is structural. The flat 50 is not a risk setting, it is an off switch. The
midpoint entry beats both edges: the near edge wins more often and earns less,
the far edge misses the moves that turn early. And the runner is worth about
double the expectancy, because half the setups cannot pay 1.2 to 1 on the point
of control alone.

### Why it trades as often as you said it would

The first version took 9 trades in 90 days, which was wrong, and it was not the
strategy being selective. An audit of every session found:

| | Sessions |
| --- | --- |
| Total | 65 |
| Swept the value area low or high | 65 |
| Armed a setup | 56 |
| Produced a signal | 36 |

Every session rotates through a level. What was throwing setups away were three
gates that had nothing to do with the setup: a 75 minute warmup that skipped the
open, a 45 minute cutoff before the close, and a cap of 3 signals per session.
Those are now 30 minutes, 20 minutes and 6.

### Why it was stopping out on everything

Ten points past a five point gap is a thirteen point stop. The median five
minute bar on this instrument is eleven points. **The stop was one bar of noise
from the entry**, and the median losing trade went more than a full R the right
way before reversing into it. Those were not bad setups.

| | |
| --- | --- |
| Median stop distance | 12.8 pt |
| Median 5 minute bar range | 11.0 pt |
| Winners' worst drawdown, median | 5.2 pt |
| Losers' best excursion before dying, median | 14.0 pt |

`min_stop_atr` is the fix: a floor under every stop at 1.5 times the current
average true range, so it sits outside the noise of the thing it is trading.
Expressed in ATR rather than points because the right distance on a quiet
Tuesday is not the right distance on CPI day.

| Stop floor | Trades | Stopped | Win rate | Expectancy |
| --- | --- | --- | --- | --- |
| none | 57 | 70% | 51% | +0.17 R |
| 1.0 ATR | 56 | 69% | 52% | +0.17 R |
| **1.5 ATR** | **49** | **61%** | **61%** | **+0.27 R** |
| 2.0 ATR | 29 | 55% | 62% | +0.23 R |
| 2.5 ATR | 14 | 50% | 71% | +0.28 R |

Moving the stop to breakeven at 1R was also removed. It reads like free
protection and measured as the opposite, scratching trades that went on to
work: 58% stopped without it against 64% with, and a better win rate. The
partial exit is the risk reduction, and it is enough.

---

## The strategy

Long. Shorts are the mirror and share every line of code through a sign flip.

The logic is split into arming and triggering, because the profile conditions
describe a state that lasts many bars while the fair value gap is an event that
happens on one. Requiring both on the same closed bar catches only the setups
where the gap happened to form on the exact bar the condition became true,
which in testing was almost none of them.

`excursion_scope` decides how long a sweep keeps a level in play. The default,
`session`, means all day, which is how the setup reads by hand: the sweep
happens in the first hour and the rotation is taken at midday, forty bars
later. `recent` enforces a bar window instead and throws most of them away.

**Arm** when all of these hold on one closed bar:

1. Inside the traded session, past the warmup, far enough from the close that
   the target is reachable.
2. Price has traded down to the zone from the previous session's profile at
   some point this session, and has not since completed the rotation away from
   it. The zone is the value area low, unless the regime layer calls a strong
   uptrend, in which case it is the point of control. Traded *to* the level, not
   near it: an approach that stops ten points short is not a sweep, and treating
   it as one is what made the first version of the swing stop two points wide.
3. Price also traded below the current session's developing value area low.
   This is the second half of "oversold on both profiles", and it is what stops
   the strategy buying a level that today's auction has already accepted as
   fair.
4. Price has reclaimed the level, and has not already reached the target.

**Trigger** while armed, for up to 20 bars:

5. A bullish fair value gap in the band between the zone and the current price,
   less than half filled.
6. The target is far enough beyond the entry, relative to the stop, to clear
   the minimum reward to risk.

### Entries, stops and exits

Entry is a limit at the **midpoint of the gap**, consequent encroachment.
`fvg_entry` can move it to `proximal`, the near edge, which fills more often and
pays worse, or `distal`, the far edge, which pays best and misses the moves that
turn early.

Stop, by `stop_mode`:

| Mode | Where | Typical |
| --- | --- | --- |
| `gap` | ten points past the far edge of the trigger gap. The default. | 13 pt |
| `fixed` | a flat 50 points | 50 pt |
| `swing` | behind the extreme that reached the level | 15 to 30 pt |
| `tighter_of` | whichever of the above sits closest to the entry | 9 pt |

`gap_stop_buffer_points` is the ten. If price closes the gap and keeps going,
the imbalance that was the reason for the trade has been filled and there is
nothing left to be right about.

Exits are a ladder. `partial_fraction` of the position comes off at the first
target, normally the reference point of control, the stop moves to breakeven,
and the rest runs to the far side of value. Setting it to `0.0` takes the whole
position at the first target, which is the brief as written.

The reward to risk floor is applied to the size weighted blend of both exits,
not to the first target alone. Grading a scaled trade on its first target
understates it and rejects the setups whose runner is what pays for them.
Grading it on the runner overstates every one. One contract cannot be halved,
so a one lot takes the whole position at the first target and the blended
number is not used.

### The one deliberate departure from the brief

The brief says to buy while oversold, meaning while price is below both value
area lows. `entry_mode="outside_value"` does exactly that and is one config
line away.

The default is `value_reentry`, which waits for price to reclaim the level
after the excursion. Below value is a bearish state at least as often as it is
a stretched one, and buying it is a knife catch. The Dalton formulation is
leave value, fail to find acceptance outside it, rotate back, and the reclaim
is the moment the failure is confirmed. Both are implemented so a backtest can
settle it rather than an argument.

### Sessions

The brief's windows, in Pacific wall clock time, are the defaults:

| Plan | Traded | Reference |
| --- | --- | --- |
| `ny_vs_brief` | 06:30 to 13:00 | 03:00 to 06:30 |
| `ny_vs_overnight` | 06:30 to 13:00 | 17:00 to 06:30 |
| `london_vs_ny` | 00:00 to 06:30 | previous 06:30 to 13:00 |
| `asia_vs_ny` | 17:00 to 01:00 | previous 06:30 to 13:00 |

One note on the brief's own numbers. The window described as "Asia plus London",
03:00 to 06:30 Pacific, is really London plus the New York pre market: Asia
trades from about 17:00 Pacific the previous day. `ny_vs_brief` implements what
was asked for and `ny_vs_overnight` implements what it probably meant. They
produce different levels, and which is better is a question for the backtest.

Windows are wall clock times in `America/Los_Angeles`, so daylight saving is
handled by the timezone database rather than by arithmetic. Storing a fixed UTC
offset would move the New York open by an hour twice a year and quietly ruin
every profile for a week.

---

## Where Gemini fits, and where it is not allowed

The brief asks for judgement: in a huge uptrend price may never reach the value
area low, so the trade is a bounce off the point of control instead. That is a
real edge and it is hard to write as a rule.

It is also the most dangerous thing to hand a language model, so the contract
in `gemini.py` is narrow:

- The model never creates a trade. It sees only setups the deterministic layer
  has already found. It can veto one, or move the entry zone between a fixed
  set of named levels. It cannot invent a level, a size or a stop.
- The model never sees a price. Every number in the prompt is a distance in
  units of average true range. Absolute prices invite it to recall something
  about the instrument instead of reading the state in front of it.
- Every failure is a veto, not a default yes. Timeout, rate limit, bad JSON,
  network down: the deterministic classifier decides instead, and the fact that
  it did is recorded on the verdict so it shows up in the backtest report.
- Both opinions have to agree. `_reconcile` intersects them. A side is tradable
  only if the model and the deterministic classifier both allow it, and when
  they disagree about direction the confidence is halved.
- One call per candidate setup, cached per five bars. A strategy that trades
  three times a day never approaches the free tier's rate limit.

Run without a key and you get the deterministic classifier, which is a complete
strategy on its own: it reads point of control migration across the last four
reference sessions, session slope in ATR, open type against the reference value
area, and swing structure. That is the baseline the model has to beat, and the
`--gemini` flag exists so the two can be run over the same data and compared.

```bash
export GEMINI_API_KEY=...
python3 tools/run_backtest.py --csv nq_1m.csv --gemini
```

Set `GEMINI_MODEL` if the default model name has moved on. The client is plain
`urllib` against the REST endpoint, so there is nothing to install and nothing
to break when an SDK changes.

---

## Layout

```
strata_vp/
  bars.py       Bar, CSV loading, resampling, ATR. The only input type.
  sessions.py   Wall clock session windows, daylight saving, plan pairs.
  profile.py    Volume profile: POC, VAH, VAL, developing and fixed.
  pdarray.py    Fair value gaps from formation to consumption, swings.
  regime.py     Scale free market state features, deterministic classifier.
  gemini.py     The model call and the cage around it.
  signals.py    The strategy: arm, trigger, target, stop.
  risk.py       Prop firm rules: trailing drawdown, daily loss, sizing.
  backtest.py   Event driven loop with pessimistic fills.
  notify.py     Trade tickets and where they go: console, JSONL, Discord,
                Slack, Telegram. A failing sink never stops the others.
  runner.py     The loop, and `replay` for running it over a file. No orders.
  instruments.py Contract specs. MNQ is the default.
pine/           strata_volume_profile.pine        the indicator, for live
                strata_volume_profile_strategy.pine the strategy, for the tester
                Both draw every signal as position boxes: green from the entry
                to the point of control, paler green on to the far side of
                value, red from the entry down to the stop.
tools/          Synthetic data, the backtest CLI, the signal CLI.
tests/          130 tests, standard library unittest, no runner to install.
```

### Why the backtest can be believed

Four decisions, each of which is a common way to fake a profitable curve:

- **No lookahead.** A signal is produced on the close of bar `i` and the order
  is not active until bar `i + 1`. A market order fills at that bar's open.
  There is a test that asserts every trade's entry timestamp is strictly after
  its signal's.
- **Pessimistic intrabar.** When a bar's range contains both the stop and the
  target, the stop is taken. Without tick data there is no way to know the
  order, and assuming the good one manufactures an edge.
- **No free gap improvement.** A resting limit fills at its own price, never at
  the better price a gap through it would have given.
- **Breakeven is decided on the previous bar.** Moving the stop to entry using
  the current bar's own high would book an exit at a price the stop was not
  sitting at when the low printed.

Costs are on by default: one tick of slippage on market and stop fills, and
commission per contract per side.

### Why the risk module is the important one

Most funded accounts are not lost to a bad strategy. They are lost to a
trailing drawdown measured differently by the trader and the firm. `risk.py`
measures it the way the firm does:

- The trailing floor follows the highest **intraday equity**, not the closed
  balance, at most futures firms. A trade that goes 40 points your way and
  comes back has permanently raised the bar. `trailing_basis` models both
  conventions because they are genuinely different accounts.
- The daily loss limit is measured from the balance at the daily reset. The
  local soft stop fires at 70 percent of it, because the last 30 percent is
  exactly what "one more trade" spends.
- Position size is the smallest of three budgets: a fixed fraction of the
  account, a fraction of what is left of the daily limit, and a fraction of
  what is left of the trailing drawdown. Near a limit it returns zero
  contracts, which is the correct size.
- Consistency rules are tracked and reported rather than enforced, because they
  cannot fail the account, only the payout, and they are invisible until then
  if nobody counts.

Contract specifications live in `instruments.py` and the default is MNQ: a
quarter point tick, two dollars a point, about a dollar twenty round turn.
`--instrument NQ` switches to the full size contract, where the same 50 point
stop is 1000 dollars, which is 40 percent of a 50k account's entire trailing
drawdown on one trade. MES, ES, MGC and M2K are there too.

---

## Getting real data, for free

The engine takes a CSV with `time,open,high,low,close,volume` and a header row,
which is what a TradingView chart export gives you. Free sources that work:

- **TradingView chart export.** Free plan, limited history, fine for a first
  pass and for checking the Pine script against the Python.
- **The broker itself.** On Tradovate that means the market data websocket,
  which is not wired up here. On MT5, `MT5Broker.bars()` returns a few thousand
  recent minute bars. Note that most retail feeds carry tick volume rather than
  traded volume, so a profile built from them will not match a CME volume
  profile exactly.
- **Databento, Polygon or similar free tiers** for a few months of proper
  minute bars if you want a longer sample.

Build the profile from 1 minute bars even when signals run on 5. Bar based
profiles model where volume traded inside each bar, and narrower bars mean less
modelling. `--signal-tf` controls the signal timeframe independently.

---

## Working it up

1. Export MNQ 1 minute bars from the chart and backtest on them. Both entry
   modes, all four stop modes. Everything above came from synthetic data and is
   worth exactly nothing until this step is done.
2. Walk forward: fit nothing on the last two months, then run on them.
3. Load the Pine script, set the sessions, and watch it live for two weeks
   without trading it. Every time it prints a ticket, write down whether you
   would have taken it. The disagreements are the specification for the next
   round of changes.
4. Replay the same days through `tools/run_signals.py` and compare the tickets
   against what the chart drew. They should match. If they do not, one of them
   is wrong and it matters which.
5. Trade it on the evaluation at one micro, from the alerts, with `--gemini`
   off so there is one fewer moving part.
6. Log what you actually take next to what the system said, and compare. The
   gap between those two is the part of the system that is you.

At one contract nothing scales out, so the runner is either the whole position
or none of it. `partial_fraction` has no effect below two contracts and the
backtest refuses to pretend otherwise.

## What this is not

It is not a validated edge. It is a correct implementation of a specific idea,
with the machinery to find out whether the idea is any good, and with the
account rules wired in so that finding out does not cost the account. The
synthetic data in `tools/synth_data.py` exists to exercise the pipeline, not to
suggest a result. Every performance number in this file came from it and means
nothing about live trading.

Nothing here is financial advice.
