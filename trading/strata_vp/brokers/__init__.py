"""Broker adapters. Import the concrete ones directly so that a missing
optional dependency, such as the Windows only MetaTrader5 package, cannot stop
a backtest from running on a machine that will never place an order."""

from .base import Broker, BracketOrder, Fill, Position
from .paper import PaperBroker

__all__ = ["Broker", "BracketOrder", "Fill", "PaperBroker", "Position"]
