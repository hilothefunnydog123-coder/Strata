"""Prove the Gemini side works before trusting it during a session.

    export GEMINI_API_KEY=...
    python3 tools/check_gemini.py
    python3 tools/check_gemini.py --list          # what your key can actually call

Three things go wrong with this and they look identical from inside the engine,
because every failure is a veto and the deterministic classifier quietly takes
over. This tells them apart:

  the key is missing or wrong
  the model name has moved on, which it does
  the response came back but did not match the schema

It sends one real request with a fabricated but realistic session state and
prints what came back, so a working setup is a thing you have seen rather than
assumed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from strata_vp.gemini import (  # noqa: E402
    DEFAULT_MODEL,
    GeminiJudge,
    deterministic_verdict,
    key_search_path,
    read_api_key,
)
from strata_vp.regime import RegimeFeatures  # noqa: E402


SAMPLE = RegimeFeatures(
    price=20_000.0,
    atr=12.0,
    open_type="below_value",
    position_vs_reference="below_value",
    position_vs_developing="below_value",
    atr_to_reference_poc=1.9,
    atr_to_reference_val=0.4,
    atr_to_reference_vah=3.4,
    atr_to_developing_poc=0.8,
    poc_migration=-0.35,
    slope=-0.9,
    higher_lows=0,
    lower_highs=3,
    range_expansion=1.4,
    bars_into_session=28,
)


def list_models(key: str) -> int:
    request = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/models",
        headers={"x-goog-api-key": key},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")[:400]
        print(f"HTTP {error.code} listing models: {body}")
        return 1
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        print(f"could not reach the API: {error}")
        return 1

    usable = [
        model["name"].removeprefix("models/")
        for model in payload.get("models", [])
        if "generateContent" in model.get("supportedGenerationMethods", [])
    ]
    print(f"{len(usable)} models your key can call with generateContent:\n")
    for name in sorted(usable):
        marker = "  <- the default" if name == DEFAULT_MODEL else ""
        print(f"  {name}{marker}")
    if DEFAULT_MODEL not in usable:
        print(
            f"\n{DEFAULT_MODEL} is NOT in that list. Set GEMINI_MODEL to one that is, "
            "or the engine will fall back to the deterministic classifier on every bar "
            "and never tell you why."
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--list", action="store_true", help="list callable models and exit")
    parser.add_argument("--model", default=None, help="override GEMINI_MODEL for this check")
    args = parser.parse_args()

    key = read_api_key()
    if not key:
        print("No API key found. Looked in, in order:\n")
        for place in key_search_path():
            print(f"  {place}")
        print("\nGet a free key at https://aistudio.google.com/apikey, then either")
        print("write it to a file, which survives closing the terminal:\n")
        print("  echo 'YOUR_KEY_HERE' > trading/.env")
        print("\nor set it for this shell only:\n")
        print("  export GEMINI_API_KEY=YOUR_KEY_HERE        # macOS, Linux")
        print("  setx GEMINI_API_KEY YOUR_KEY_HERE          # Windows, new terminals")
        print("\nThe file is already gitignored. Do not paste the key into a")
        print("source file, because that is the one place it will get committed.")
        return 1
    source = "environment" if os.environ.get("GEMINI_API_KEY", "").strip() else "key file"
    print(f"key: {key[:6]}...{key[-4:]}  ({len(key)} chars, from the {source})")
    if key.startswith(("'", '"')) or key.endswith(("'", '"')):
        print("  the key still has quotes around it, which the API rejects as a 400")

    if args.list:
        return list_models(key)

    model = args.model or DEFAULT_MODEL
    print(f"model: {model}\n")

    judge = GeminiJudge(api_key=key, model=model, enabled=True)
    verdict = judge.judge(SAMPLE)

    fallback = deterministic_verdict(SAMPLE)
    print("deterministic classifier, with no model at all:")
    print(f"  {fallback.regime}  confidence {fallback.confidence}")
    print(f"  long {fallback.long_allowed} at {fallback.preferred_long_zone}, "
          f"short {fallback.short_allowed} at {fallback.preferred_short_zone}")
    print()

    if verdict.source != "gemini":
        print("THE CALL FAILED. The engine fell back to the classifier above.")
        print(f"  attempts: {judge.calls} succeeded, {judge.failures} failed")
        print("\nRun with --list to see which models the key can actually call.")
        print("If the list looks fine, the failure was the network or a timeout.")
        return 1

    print(f"Gemini answered in {verdict.latency_ms} ms:")
    print(f"  {verdict.regime}  confidence {verdict.confidence}")
    print(f"  long {verdict.long_allowed} at {verdict.preferred_long_zone} "
          f"-> {verdict.long_target}")
    print(f"  short {verdict.short_allowed} at {verdict.preferred_short_zone} "
          f"-> {verdict.short_target}")
    print(f"  rationale: {verdict.rationale}")
    print()
    print("That verdict is already through the cage in gemini.py: a side is only")
    print("tradable if the model and the classifier both allow it, and the model")
    print("can move an entry zone to the point of control but never further out.")
    print()
    print("Working. The engine will use it whenever GEMINI_API_KEY is set.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
