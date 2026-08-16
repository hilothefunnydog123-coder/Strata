"""Session volume profile strategy for funded futures accounts.

Zero dependencies, standard library only, so it runs anywhere Python 3.11 runs
and nothing in it needs a subscription.

    from strata_vp import Backtest, StrategyConfig, PLANS, load_csv

    bars = load_csv("nq_1m.csv")
    result = Backtest(StrategyConfig(), PLANS["ny_vs_brief"]).run(bars)
    print(summarise(result))
"""

from .backtest import Backtest, Costs, Result, Trade, summarise
from .bars import Bar, atr, load_csv, resample, write_csv
from .gemini import GeminiJudge, Verdict, deterministic_verdict
from .pdarray import FVG, FVGTracker, detect, swings
from .profile import ProfileLevels, VolumeProfile, build_profile
from .regime import RegimeFeatures, classify, measure
from .risk import Decision, PropFirmRules, RiskManager
from .sessions import PLANS, SessionPlan, SessionWindow
from .signals import Signal, Strategy, StrategyConfig

__all__ = [
    "Backtest",
    "Bar",
    "Costs",
    "Decision",
    "FVG",
    "FVGTracker",
    "GeminiJudge",
    "PLANS",
    "ProfileLevels",
    "PropFirmRules",
    "RegimeFeatures",
    "Result",
    "RiskManager",
    "SessionPlan",
    "SessionWindow",
    "Signal",
    "Strategy",
    "StrategyConfig",
    "Trade",
    "Verdict",
    "VolumeProfile",
    "atr",
    "build_profile",
    "classify",
    "detect",
    "deterministic_verdict",
    "load_csv",
    "measure",
    "resample",
    "summarise",
    "swings",
    "write_csv",
]
