"""The discretionary layer, and the cage it lives in.

The strategy brief asks for judgement: in a strong uptrend price may never
reach the value area low, so the trade is a bounce off the point of control
instead. That is a real edge and it is hard to write as a rule, which is what
the model is for.

It is also the most dangerous part of the system, so the contract is narrow:

  * The model can never create a trade. It sees only setups the deterministic
    layer has already found, and it can veto one, or move the entry zone
    between a fixed set of named levels. It cannot invent a level, a size, or
    a stop.
  * The model never sees a price it can anchor on. Every number in the prompt
    is a distance in units of average true range. Absolute prices invite it to
    recall something about the instrument instead of reading the state.
  * Every failure is a veto, not a default yes. Timeout, rate limit, bad JSON,
    empty response, network down: the deterministic classifier in regime.py
    decides instead, and the fact that it did is recorded on the verdict so it
    shows up in the backtest report rather than being discovered later.
  * One call per candidate setup, cached per bar. The free tier has a request
    per minute ceiling and a strategy that trades three times a day should
    never come close to it.

Implemented against the REST endpoint with urllib so the whole system stays at
zero dependencies. An API key in GEMINI_API_KEY is the only thing needed.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from .regime import Regime, RegimeFeatures, classify

Zone = Literal["value_area_low", "value_area_high", "point_of_control", "none"]
Target = Literal["point_of_control", "value_area_high", "value_area_low", "none"]

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# Where the key is looked for, in order. The environment variable is the right
# answer on a server and an annoyance on a laptop, where it has to be re set
# every time a terminal opens and is silently absent the one morning it
# matters. A file next to the package is the boring version that keeps working.
KEY_FILENAME = ".env"
KEY_LOCATIONS = (
    Path(__file__).resolve().parent.parent / KEY_FILENAME,   # trading/.env
    Path.home() / ".strata_vp" / "gemini.key",
)


def read_api_key() -> str | None:
    """GEMINI_API_KEY from the environment, or from one of the key files.

    A key file is either a bare key on its own line or `GEMINI_API_KEY=...`,
    because both are what people actually write. Blank lines and `#` comments
    are skipped, and surrounding quotes are stripped: a key pasted with the
    quotes still on it is the single most common way this fails, and it fails
    as a 400 from the API rather than as anything that mentions quotes.
    """
    from_env = os.environ.get("GEMINI_API_KEY", "").strip()
    if from_env:
        return from_env

    for location in KEY_LOCATIONS:
        try:
            text = location.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                name, _, value = line.partition("=")
                if name.strip().upper() not in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
                    continue
                line = value.strip()
            line = line.strip().strip('"').strip("'")
            if line:
                return line
    return None


def key_search_path() -> list[str]:
    """Everywhere read_api_key looked, for an error message worth reading."""
    return ["the GEMINI_API_KEY environment variable"] + [
        f"{location}{'' if location.exists() else '  (does not exist)'}"
        for location in KEY_LOCATIONS
    ]

SYSTEM_INSTRUCTION = """\
You are a market state classifier inside an automated futures trading system.
You are not a trader and you do not decide whether to take a trade. A separate
deterministic engine has already found a setup that satisfies its rules. Your
only job is to read the state of the session and answer whether that setup is
consistent with it.

You are working in the auction market framework. Value area high, point of
control and value area low come from the previous session's volume profile.
The engine's default assumption is mean reversion: price leaves value, fails to
find acceptance outside it, and rotates back to the point of control.

The one judgement that matters most: in a genuinely one directional session,
price often does not reach the far side of value at all. It holds the point of
control and continues. When you see that, say so by moving the preferred long
zone to point_of_control, and expect the rotation to run past the point of
control to the value area high rather than stopping there. The mirror applies
to a one directional session downward.

Be conservative. Answering "balanced" and leaving the zones at their defaults
is correct most of the time. Only call a strong trend when the point of control
migration, the slope and the structure count all agree. If the evidence
conflicts, lower your confidence rather than picking a side.

All distances are in multiples of the current average true range. A positive
distance means the level is above the current price. You are never given an
absolute price, and you must not ask for one or reason about what instrument
this is.
"""

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "regime": {
            "type": "STRING",
            "enum": [
                "strong_uptrend",
                "uptrend",
                "balanced",
                "downtrend",
                "strong_downtrend",
            ],
        },
        "confidence": {"type": "NUMBER"},
        "long_allowed": {"type": "BOOLEAN"},
        "short_allowed": {"type": "BOOLEAN"},
        "preferred_long_zone": {
            "type": "STRING",
            "enum": ["value_area_low", "point_of_control", "none"],
        },
        "preferred_short_zone": {
            "type": "STRING",
            "enum": ["value_area_high", "point_of_control", "none"],
        },
        "long_target": {
            "type": "STRING",
            "enum": ["point_of_control", "value_area_high", "none"],
        },
        "short_target": {
            "type": "STRING",
            "enum": ["point_of_control", "value_area_low", "none"],
        },
        "rationale": {"type": "STRING"},
    },
    "required": [
        "regime",
        "confidence",
        "long_allowed",
        "short_allowed",
        "preferred_long_zone",
        "preferred_short_zone",
        "long_target",
        "short_target",
        "rationale",
    ],
    "propertyOrdering": [
        "regime",
        "confidence",
        "long_allowed",
        "short_allowed",
        "preferred_long_zone",
        "preferred_short_zone",
        "long_target",
        "short_target",
        "rationale",
    ],
}


@dataclass(frozen=True, slots=True)
class Verdict:
    regime: Regime
    confidence: float
    long_allowed: bool
    short_allowed: bool
    preferred_long_zone: Zone
    preferred_short_zone: Zone
    long_target: Target
    short_target: Target
    rationale: str
    source: str = "deterministic"
    latency_ms: float = 0.0

    def zone_for(self, side: str) -> Zone:
        return self.preferred_long_zone if side == "long" else self.preferred_short_zone

    def target_for(self, side: str) -> Target:
        return self.long_target if side == "long" else self.short_target

    def allows(self, side: str) -> bool:
        return self.long_allowed if side == "long" else self.short_allowed

    def as_dict(self) -> dict[str, object]:
        return {
            "regime": self.regime,
            "confidence": self.confidence,
            "long_allowed": self.long_allowed,
            "short_allowed": self.short_allowed,
            "preferred_long_zone": self.preferred_long_zone,
            "preferred_short_zone": self.preferred_short_zone,
            "long_target": self.long_target,
            "short_target": self.short_target,
            "source": self.source,
            "rationale": self.rationale[:280],
        }


def deterministic_verdict(features: RegimeFeatures) -> Verdict:
    """What the system does with no model, and what it falls back to on every
    model failure. This is a complete strategy on its own."""
    regime, confidence = classify(features)

    long_allowed = regime != "strong_downtrend"
    short_allowed = regime != "strong_uptrend"

    long_zone: Zone = "point_of_control" if regime == "strong_uptrend" else "value_area_low"
    short_zone: Zone = "point_of_control" if regime == "strong_downtrend" else "value_area_high"

    long_target: Target = (
        "value_area_high" if regime in ("strong_uptrend", "uptrend") else "point_of_control"
    )
    short_target: Target = (
        "value_area_low" if regime in ("strong_downtrend", "downtrend") else "point_of_control"
    )

    return Verdict(
        regime=regime,
        confidence=confidence,
        long_allowed=long_allowed,
        short_allowed=short_allowed,
        preferred_long_zone=long_zone,
        preferred_short_zone=short_zone,
        long_target=long_target,
        short_target=short_target,
        rationale=(
            f"deterministic: poc migration {features.poc_migration:+.2f} va/session, "
            f"slope {features.slope:+.2f} atr/10 bars, open {features.open_type}"
        ),
        source="deterministic",
    )


@dataclass
class GeminiJudge:
    """Calls Gemini for a verdict, falls back to the deterministic one.

    `enabled` defaults to whether an API key is present, so a backtest run on a
    machine with no key produces the deterministic strategy rather than an
    error, and the two runs are directly comparable.
    """

    api_key: str | None = field(default_factory=read_api_key)
    model: str = DEFAULT_MODEL
    timeout_s: float = 8.0
    max_attempts: int = 2
    min_seconds_between_calls: float = 4.0
    enabled: bool | None = None
    calls: int = field(default=0, init=False)
    failures: int = field(default=0, init=False)
    _last_call_at: float = field(default=0.0, init=False)
    _cache: dict[str, Verdict] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        if self.enabled is None:
            self.enabled = bool(self.api_key)

    def judge(self, features: RegimeFeatures, *, cache_key: str | None = None) -> Verdict:
        fallback = deterministic_verdict(features)
        if not self.enabled or not self.api_key:
            return fallback
        if cache_key is not None and cache_key in self._cache:
            return self._cache[cache_key]

        verdict = self._call(features) or fallback
        if verdict.source == "gemini":
            verdict = _reconcile(verdict, fallback)
        if cache_key is not None:
            self._cache[cache_key] = verdict
        return verdict

    def _call(self, features: RegimeFeatures) -> Verdict | None:
        # Crude client side rate limit. The free tier counts requests per
        # minute and a 429 costs more than a short wait.
        gap = time.monotonic() - self._last_call_at
        if gap < self.min_seconds_between_calls:
            time.sleep(self.min_seconds_between_calls - gap)

        payload = {
            "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
            "contents": [{"role": "user", "parts": [{"text": _prompt(features)}]}],
            "generationConfig": {
                "temperature": 0.0,
                "candidateCount": 1,
                "maxOutputTokens": 2048,
                "responseMimeType": "application/json",
                "responseSchema": RESPONSE_SCHEMA,
            },
        }
        body = json.dumps(payload).encode("utf-8")
        url = ENDPOINT.format(model=self.model)
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self.api_key or "",
            },
            method="POST",
        )

        for attempt in range(self.max_attempts):
            started = time.monotonic()
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
                    raw = json.loads(response.read().decode("utf-8"))
                self._last_call_at = time.monotonic()
                self.calls += 1
                parsed = _parse(raw)
                if parsed is None:
                    self.failures += 1
                    return None
                return Verdict(
                    **parsed,
                    source="gemini",
                    latency_ms=round((time.monotonic() - started) * 1000, 1),
                )
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
                self._last_call_at = time.monotonic()
                self.failures += 1
                if attempt + 1 >= self.max_attempts:
                    return None
                time.sleep(1.5 * (attempt + 1))
        return None


def _prompt(features: RegimeFeatures) -> str:
    state = json.dumps(features.as_dict(), indent=2, sort_keys=True)
    return (
        "Session state. Every distance is in multiples of the current average "
        "true range, positive meaning the level sits above the current price. "
        "poc_migration is the average shift of the point of control between "
        "the last reference sessions, measured in value area widths per "
        "session.\n\n"
        f"{state}\n\n"
        "Classify the regime and answer whether long and short setups are "
        "consistent with it. Keep the rationale under 240 characters."
    )


def _parse(raw: dict[str, Any]) -> dict[str, Any] | None:
    try:
        candidates = raw.get("candidates") or []
        if not candidates:
            return None
        parts = candidates[0].get("content", {}).get("parts") or []
        text = "".join(part.get("text", "") for part in parts).strip()
        if not text:
            return None
        data = json.loads(text)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError):
        return None

    try:
        confidence = float(data["confidence"])
        return {
            "regime": _one_of(data["regime"], RESPONSE_SCHEMA["properties"]["regime"]["enum"], "balanced"),
            "confidence": max(0.0, min(1.0, confidence)),
            "long_allowed": bool(data["long_allowed"]),
            "short_allowed": bool(data["short_allowed"]),
            "preferred_long_zone": _one_of(
                data["preferred_long_zone"], ["value_area_low", "point_of_control", "none"], "value_area_low"
            ),
            "preferred_short_zone": _one_of(
                data["preferred_short_zone"], ["value_area_high", "point_of_control", "none"], "value_area_high"
            ),
            "long_target": _one_of(
                data["long_target"], ["point_of_control", "value_area_high", "none"], "point_of_control"
            ),
            "short_target": _one_of(
                data["short_target"], ["point_of_control", "value_area_low", "none"], "point_of_control"
            ),
            "rationale": str(data.get("rationale", ""))[:280],
        }
    except (KeyError, TypeError, ValueError):
        return None


def _one_of(value: Any, allowed: list[str], default: str) -> str:
    return value if isinstance(value, str) and value in allowed else default


def _reconcile(model: Verdict, fallback: Verdict) -> Verdict:
    """The cage.

    Two independent opinions arrive here and only their intersection gets to
    trade. A side is allowed only if both allow it. The model may move an entry
    zone to the point of control, which is the judgement we asked it for, but
    it may not move a zone further out than the deterministic layer would, and
    it may not raise its own confidence past what the evidence supports when
    the two disagree about direction.
    """
    disagree = REGIME_RANK[model.regime] * REGIME_RANK[fallback.regime] < 0
    confidence = model.confidence * (0.5 if disagree else 1.0)

    def pick_zone(model_zone: Zone, fallback_zone: Zone) -> Zone:
        if model_zone == "none" or fallback_zone == "none":
            return "none"
        # point_of_control is the tighter, earlier entry. Allow the model to
        # tighten, never to loosen.
        if model_zone == "point_of_control":
            return "point_of_control"
        return fallback_zone

    return Verdict(
        regime=model.regime,
        confidence=round(confidence, 3),
        long_allowed=model.long_allowed and fallback.long_allowed,
        short_allowed=model.short_allowed and fallback.short_allowed,
        preferred_long_zone=pick_zone(model.preferred_long_zone, fallback.preferred_long_zone),
        preferred_short_zone=pick_zone(model.preferred_short_zone, fallback.preferred_short_zone),
        long_target=model.long_target,
        short_target=model.short_target,
        rationale=model.rationale,
        source="gemini",
        latency_ms=model.latency_ms,
    )


REGIME_RANK: dict[str, int] = {
    "strong_downtrend": -2,
    "downtrend": -1,
    "balanced": 0,
    "uptrend": 1,
    "strong_uptrend": 2,
}
