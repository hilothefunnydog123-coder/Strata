# Setting this up from nothing

Written for someone who trades, not someone who writes software. Nothing here
assumes you have used a terminal before.

---

## First: you probably do not need any of this yet

There are two halves to this system and only one of them needs a computer setup.

**The half that trades is TradingView, and it needs nothing installed.** Load
the Pine script on your chart, set two boxes, and it draws the levels, the
gaps, and the trade with its stop and targets. That is the live system. If all
you want is to see signals during the session, stop reading after Part 1.

**The half in this guide is the research side.** Backtests over your own
exported data, the tool that explains why a trade you took was not signalled,
and the Gemini layer. Useful, not urgent, and none of it places a trade.

---

## Part 1: TradingView, no install

1. Open your MNQ chart on tradingview.com. Set the timeframe to **5 minutes**.
2. At the bottom of the screen, click **Pine Editor**.
3. Delete whatever is in there.
4. Open `pine/strata_volume_profile.pine`, select all of it, copy, paste in.
5. Click **Add to chart**.
6. Click the gear icon next to the indicator's name to set the two session
   boxes. Defaults are `0630-1300` for the session traded and `0300-0630` for
   the reference, in Pacific time.

For alerts: right-click the chart, **Add alert**, and under Condition pick the
indicator and then "Volume profile long" or "Volume profile short". The alert
message carries the entry, stop and both targets, so you can place the trade
from the notification without opening the chart.

For a backtest, do the same with `pine/strata_volume_profile_strategy.pine` and
open the **Strategy Tester** tab at the bottom. That grades it on your real
chart data with nothing exported and nothing installed.

Everything below is the other half.

---

## Part 2: Opening a terminal

A terminal is a window where you type commands instead of clicking. That is all
it is.

**Windows.** Press the Windows key, type `powershell`, press Enter. A blue or
black window opens with a blinking cursor.

**Mac.** Press Cmd and Space together, type `terminal`, press Enter.

When this guide shows a line to run, you type or paste it and press Enter.
Paste is **Ctrl+V** on Windows, **Cmd+V** on Mac. Nothing happens until you
press Enter.

One thing that will confuse you once: Windows uses `python`, Mac uses
`python3`. Every command below is shown for both. Use the line for your
machine.

---

## Part 3: Installing Python

Python is the language the research tools are written in. It is free.

**Windows**

1. Go to [python.org/downloads](https://www.python.org/downloads/).
2. Click the big yellow **Download Python** button.
3. Run the file it downloads.
4. **On the first screen, tick the box that says "Add python.exe to PATH".**
   It is at the bottom and it is easy to miss. If you miss it, the terminal
   will say "python is not recognized" later and you will have to install
   again.
5. Click **Install Now**, wait, close it.

**Mac**

Macs ship with an old Python that is too old for this. Get a current one:

1. Go to [python.org/downloads](https://www.python.org/downloads/).
2. Download and run the installer. Click through it.

**Check it worked.** Close the terminal, open a new one, and run:

```
python --version
```
```
python3 --version
```

You want a number of **3.11 or higher**. If it says 3.10 or lower, or says
python is not recognised, the install did not take.

---

## Part 4: Getting the code

The easy way, no extra software:

1. Go to
   [the branch on GitHub](https://github.com/hilothefunnydog123-coder/Strata/tree/claude/algo-trading-prop-firms-yc4vip).
2. Click the green **Code** button.
3. Click **Download ZIP**.
4. Find the ZIP in your Downloads and unzip it. On Windows, right-click and
   **Extract All**. On Mac, double click it.

You now have a folder called something like `Strata-claude-algo-trading-prop-firms-yc4vip`.
Inside it is a folder called `trading`. That is the one you want.

---

## Part 5: Getting the terminal into that folder

The terminal is always "in" some folder, and it can only see the files there.
`cd` means change directory.

**The trick that avoids typing the path.** Type `cd` and then a space, then
drag the `trading` folder from your file explorer onto the terminal window and
let go. It fills in the path for you. Press Enter.

Or type it out:

```
cd C:\Users\YourName\Downloads\Strata-claude-algo-trading-prop-firms-yc4vip\trading
```
```
cd ~/Downloads/Strata-claude-algo-trading-prop-firms-yc4vip/trading
```

Check you are in the right place:

```
dir
```
```
ls
```

You should see `README.md`, `strata_vp`, `tools`, `tests`, `pine`. If you see
something else, you are in the wrong folder.

**Every command from here assumes you are in that `trading` folder.** If you
close the terminal, you have to `cd` there again.

---

## Part 6: Run the first thing

```
python tools/run_backtest.py --synthetic --days 90
```
```
python3 tools/run_backtest.py --synthetic --days 90
```

It prints a performance summary. This is on made up data, so the numbers mean
nothing about whether the strategy works. It proves your setup is working,
which is the only thing being tested right now.

If that printed a table, you are done setting up.

---

## Part 7: The Gemini key

Free. It is the layer that reads whether the session is trending and can veto a
setup or move the entry to the point of control.

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and
   sign in with a Google account.
2. Click **Create API key**. Copy what it gives you.
3. Run this, with your key in place of the example:

```
python tools/check_gemini.py --set-key AIzaSyYourActualKeyHere
```
```
python3 tools/check_gemini.py --set-key AIzaSyYourActualKeyHere
```

That saves the key and immediately tests it with a real request. If it works it
prints Gemini's read of a sample session next to what the rule based classifier
said about the same thing.

You only do this once. The key is saved in a file called `.env` in the
`trading` folder, which is excluded from GitHub so it cannot get published by
accident.

If it says the call failed, run this to see which models your key can reach:

```
python tools/check_gemini.py --list
```

---

## Part 8: The commands worth knowing

All from the `trading` folder. Windows drops the `3` from `python3`.

**Backtest on made up data.** Proves the setup works, says nothing about the
strategy.
```
python3 tools/run_backtest.py --synthetic --days 90 --trades
```

**Backtest on your own data.** Export from TradingView first, see the README.
```
python3 tools/run_backtest.py --csv mnq_1m.csv
```

**See the signals as trade tickets**, the way they would arrive during a
session.
```
python3 tools/run_signals.py --csv mnq_1m.csv
```

**Find out why a trade was not signalled.** This is the one to reach for when
the system disagrees with you. Times are Pacific.
```
python3 tools/why.py --csv mnq_1m.csv --at "2026-06-10 07:15"
python3 tools/why.py --csv mnq_1m.csv --date 2026-06-10 --summary
```

**Check the whole thing still works** after any change.
```
python3 -m unittest discover -s tests -t .
```

---

## When it goes wrong

**"python is not recognized"** on Windows. The "Add python.exe to PATH" box was
not ticked during install. Install again and tick it.

**"can't open file ... No such file or directory"**. The terminal is not in the
`trading` folder. Go back to Part 5.

**"No module named strata_vp"**. Same cause. You are one folder too high or too
low. `dir` or `ls` should show `strata_vp` in the listing.

**A backtest on your own CSV prints an error about volume.** You exported the
index rather than the contract. Export `MNQ1!`, not `NQ`. Without volume there
is no volume profile.

**Only a few hundred bars loaded from your export.** TradingView only exports
the bars currently on the chart. Click the chart, hold the left arrow key until
it stops loading more, then export.

**The Pine script draws lines but never a trade.** Look at the status table in
the top right of the chart. It lists every condition and colours the failing
one red. That table exists for exactly this question.

---

## What none of this does

It does not place orders. There is no connection to Tradovate, no autotrading,
and nothing here can touch your account. The output is a trade ticket that you
read and decide about. That is a deliberate limit, not an unfinished part: the
account has no API access to trade through even if the code wanted one.
