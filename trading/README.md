# Strata VP

A session volume profile strategy for funded futures accounts, with the
discretionary part of it handled by Gemini and everything else handled by code
that does not need an internet connection.

Python 3.11, standard library only. No pip install, no data subscription, no
paid charting tier, no broker fees beyond the ones the account already has.

```
cd trading
python3 tools/run_backtest.py --synthetic --days 90 --trades
python3 tools/run_backtest.py --csv mnq_1m.csv --instrument MNQ --plan ny_vs_brief
python3 -m unittest discover -s tests -t .
```

---

## Read this before you build anything

Three constraints decide the shape of the whole system, and two of them are
not what people expect.

**TradingView cannot trigger trades on the free plan.** Alerts that call a
webhook are a paid feature. On a free account an alert can pop up on screen and
send an email, and that is all. So TradingView is the chart, the research tool
and the thing you look at when a trade goes wrong. It is not the trigger. The
Pine script in `pine/` draws exactly what the engine computes so the two can be
compared, and it is not in the execution path.

**The execution path has to come from the broker, and on Tradovate there is
one thing to confirm before writing any code: whether API access is enabled on
your account at all.** Tradovate gates automated access behind an API Access
add on, and prop firms reselling Tradovate then make their own decision on top
of that. Some allow it, some allow it only on evaluations, some not at all, and
none of them put it on the sales page. An account without it authenticates
perfectly and rejects every order, so the failure looks like a bug in your code
for about a day.

Test it for free against the demo host before assuming anything:

```python
from strata_vp.brokers import TradovateBroker, TradovateCredentials

broker = TradovateBroker(TradovateCredentials(...), live=False)
broker.connect()
print(broker.accounts())
```

`strata_vp/brokers/tradovate.py` covers authentication including the `p-ticket`
throttle, contract lookup, bracket placement, cancel, position and flatten.
Bars are the gap: Tradovate serves chart data over the market data websocket
rather than REST, and that is the one piece needing a dependency, so `bars()`
raises and says so rather than returning something empty. Until it is wired up,
feed `LiveTrader` from any other bar source. The strategy does not care where
bars come from, only that they are closed and in order.

Other routes, for when the firm changes:

| Route | Cost | Notes |
| --- | --- | --- |
| Tradovate REST | API Access add on, and firm permission | Implemented here. Confirm access on demo first. |
| ProjectX REST and websocket | Included with several futures firms | Best option if your firm moves to it. A direct port of the same four method interface. |
| MetaTrader 5 Python package | Free | Windows only. Forex and CFD firms, not futures. `brokers/mt5.py`. |
| Rithmic or CQG | Licence and approval | Not realistic for a first system. |
| TradingView webhook | Paid plan | Also puts a network hop and a service you do not control between the signal and the order. |

**A 50 point stop cannot pay for a point of control target.** This is the one
real problem with the strategy as briefed, and it is arithmetic rather than
opinion. The distance from the value area low to the point of control is
roughly half a value area width, which on an overnight profile is commonly 20
to 40 points. Risking 50 to make 30 is 0.6 to 1. That needs a 63 percent win
rate before costs just to break even, and mean reversion into value does not
win 63 percent of the time.

The engine does not paper over this. `min_reward_risk` rejects the trade and
the strategy stands down. Run it and see, on 90 days of synthetic MNQ bars:

| Configuration | Trades | Win rate | Expectancy | Avg stop |
| --- | --- | --- | --- | --- |
| The brief literally: fixed 50 point stop | 0 | | | |
| Stop behind the gap, no runner | 41 | 32% | +0.13 R | 10 pt |
| Stop behind the sweep, no runner | 3 | 0% | -0.68 R | 15 pt |
| Stop behind the sweep, half off at the point of control | 9 | 44% | +0.14 R | 25 pt |
| Stop behind the gap, half off at the point of control | 51 | 39% | +0.17 R | 10 pt |

Synthetic bars, so none of that says the strategy makes money. What it says is
structural and would hold on real data.

The 50 point stop is not a risk setting, it is an off switch. And the honest
version of the stop, the one in your chart, is behind the swing that swept the
level rather than behind the gap: if that low breaks, the sweep was not a sweep
and the idea is wrong. But a stop that wide cannot be paid for by the point of
control alone, which is the third row: three trades in ninety days, all losers,
because the geometry test correctly rejected everything else.

The runner is what resolves it, and it is what the setup is missing when
written down as "target the point of control". Half off there, stop to
breakeven, the rest to the far side of value. That is the fourth row, and it is
the default: `--stop-mode swing --partial 0.5`.

Two smaller things the table shows. The reclaim entry beats the literal
below-value entry on the same data, which is why it is the default. And turning
off the fair value gap requirement does not loosen the strategy, it collapses
it, because the gap is where the structural stop comes from.

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

**Trigger** while armed, for up to 12 bars:

5. A bullish fair value gap in the band between the zone and the current price,
   less than half filled.
6. The target is far enough beyond the entry, relative to the stop, to clear
   the minimum reward to risk.

### Entries, stops and exits

Entry is a limit inside the gap. `fvg_entry` picks where: `proximal` is the
near edge and fills most often, `midpoint` is consequent encroachment, `distal`
is the far edge, which is the best price, the worst fill rate, and the one that
turns a winner into a missed trade when price turns early.

Stop, by `stop_mode`:

| Mode | Where | Typical |
| --- | --- | --- |
| `fixed` | 50 points, the brief | 50 pt |
| `structure` | behind the far edge of the trigger gap | 10 pt |
| `swing` | behind the low that swept the level | 15 to 30 pt |
| `tighter_of` | whichever of the above sits closest to the entry | 9 pt |

`swing_anchor` decides what "the low that swept the level" means. `session` is
the lowest low of the session so far, which is what a hand placed stop uses
even when price has rotated through value once since the sweep. `excursion`
uses only the most recent leg into the level, which is tighter and gets run
more often.

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
  live.py       The live loop. Boring on purpose.
  instruments.py Contract specs. MNQ is the default.
  brokers/      base.py is four methods. paper.py, tradovate.py and mt5.py
                implement them.
pine/           The TradingView indicator. Chart only, not execution.
tools/          Synthetic data and the backtest CLI.
tests/          100 tests, standard library unittest, no runner to install.
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

## Going live

1. Backtest on real minute bars, both entry modes, both stop modes.
2. Walk forward: fit nothing on the last two months, then run on them.
3. Confirm API access on the Tradovate demo host, since everything after this
   depends on it.
4. Run `live.py` against `PaperBroker` with `dry_run=True` for two weeks and
   compare the paper fills against what the backtest would have produced on the
   same bars. If they disagree, one of them is lying and you want to know which
   before the account is funded.
5. Run on the Tradovate demo with one micro contract.
6. Evaluation account, one micro, `--gemini` off, so there is one fewer moving
   part while you learn what the system actually does. At one contract nothing
   scales out, so the runner is either the whole position or none of it: decide
   which before funding, not during.
7. Turn the model on and compare a month of both.

The live loop only acts on closed bars, warms up on history before its first
decision so the reference profile is real, reads position state from the broker
rather than from local belief, and runs its flat by timer off the wall clock so
a quiet feed cannot leave a position open past the session close.

## What this is not

It is not a validated edge. It is a correct implementation of a specific idea,
with the machinery to find out whether the idea is any good, and with the
account rules wired in so that finding out does not cost the account. The
synthetic data in `tools/synth_data.py` exists to exercise the pipeline, not to
suggest a result. Every performance number in this file came from it and means
nothing about live trading.

Nothing here is financial advice.
