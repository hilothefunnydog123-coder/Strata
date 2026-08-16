"""Session volume profile strategy for funded futures accounts.

Zero dependencies, standard library only, so it runs anywhere Python 3.11 runs
and nothing in it needs a subscription.

    from strata_vp import Backtest, StrategyConfig, PLANS, load_csv

    bars = load_csv("mnq_1m.csv")
    result = Backtest(StrategyConfig(), PLANS["ny_vs_brief"]).run(bars)
    print(summarise(result))

There is no execution layer. The system produces signals and a person places
the order. See notify.py and runner.py.
"""

from .backtest import Backtest, Costs, Result, Trade, summarise
from .bars import Bar, atr, load_csv, resample, write_csv
from .gemini import GeminiJudge, Verdict, deterministic_verdict
from .instruments import BY_SYMBOL, ES, MES, MNQ, NQ, Instrument, lookup
from .notify import ConsoleSink, JsonlSink, Notifier, TelegramSink, WebhookSink, render_text
from .pdarray import FVG, FVGTracker, detect, swings
from .profile import ProfileLevels, VolumeProfile, build_profile
from .regime import RegimeFeatures, classify, measure
from .risk import Decision, PropFirmRules, RiskManager
from .runner import SignalRunner, replay
from .sessions import PLANS, SessionPlan, SessionWindow
from .signals import Signal, Strategy, StrategyConfig

__all__ = [
    "Backtest",
    "Bar",
    "Costs",
    "Decision",
    "FVG",
    "FVGTracker",
    "BY_SYMBOL",
    "ES",
    "GeminiJudge",
    "ConsoleSink",
    "Instrument",
    "JsonlSink",
    "MES",
    "MNQ",
    "NQ",
    "PLANS",
    "ProfileLevels",
    "PropFirmRules",
    "RegimeFeatures",
    "Result",
    "RiskManager",
    "SignalRunner",
    "SessionPlan",
    "SessionWindow",
    "Notifier",
    "Signal",
    "Strategy",
    "StrategyConfig",
    "Trade",
    "TelegramSink",
    "Verdict",
    "WebhookSink",
    "VolumeProfile",
    "atr",
    "build_profile",
    "classify",
    "detect",
    "deterministic_verdict",
    "load_csv",
    "lookup",
    "measure",
    "render_text",
    "replay",
    "resample",
    "summarise",
    "swings",
    "write_csv",
]
