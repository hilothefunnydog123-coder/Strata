"""Strata's neural layer — small networks, written from scratch, no dependencies.

Strata ships with no third-party packages, so the networks here are implemented
directly: forward and backward passes by hand, Adam by hand, int8-quantised
weights in the repo. They are small on purpose. The job is not to be a language
model; it is to do three narrow things better than a keyword rule can:

    design   — what kind of study is this?      (8 classes, single-label)
    rigour   — which safeguards does it report? (6 labels, independent sigmoids)

Direction-of-finding is *not* here. A stance classifier was trained, measured on
the adversarial probes, and beaten by forty lines of regex — see
:mod:`strata.stance` for the numbers and the reasoning. ``stance_net()`` still
loads a checkpoint if you train one; nothing in the pipeline calls it.

Every model is a bag-of-ngrams embedding with attention pooling, so a prediction
always comes with the spans that drove it. Strata never shows a label without
being able to show why.

    from strata.nn import design_net
    p = design_net().predict("A double-blind, placebo-controlled randomised trial …")
    p.label, p.confidence, p.evidence_spans

A fourth model, :class:`~strata.nn.model.BiEncoder`, is implemented and tested
but deliberately not shipped — see its docstring for why it failed to generalise
and what Strata uses instead.

Weights load lazily and are cached per-process. If a weight file is missing the
caller gets ``None`` and Strata falls back to its rule-based grader — the neural
layer is an upgrade, never a hard dependency. Set ``STRATA_NO_NN=1`` to force
that fallback and compare the two.
"""
from __future__ import annotations

import os
import threading

from .model import (BiEncoder, MultiLabelClassifier, MultiLabelPrediction,
                    Prediction, TextClassifier)
from .text import Vectorizer

__all__ = [
    "TextClassifier", "MultiLabelClassifier", "BiEncoder", "Prediction",
    "MultiLabelPrediction", "Vectorizer", "design_net", "stance_net",
    "rigour_net", "available", "clear_cache",
]

_WEIGHT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "weights")
_cache: dict[str, object] = {}
_lock = threading.Lock()


def _weight_path(name: str) -> str:
    return os.path.join(_WEIGHT_DIR, f"{name}.json")


def _load(name: str, cls):
    """Load a trained model by name, or None if it hasn't been trained yet."""
    if os.environ.get("STRATA_NO_NN") == "1":
        return None
    with _lock:
        if name in _cache:
            return _cache[name]
        path = _weight_path(name)
        model = None
        if os.path.exists(path):
            try:
                model = cls.load(path)
            except Exception:          # a corrupt checkpoint must not break `ask`
                model = None
        _cache[name] = model
        return model


def design_net() -> TextClassifier | None:
    """Study-design classifier. Labels match the evidence pyramid levels."""
    return _load("design", TextClassifier)


def stance_net() -> TextClassifier | None:
    """Direction-of-finding classifier — **not shipped**.

    Returns None unless you have trained one yourself with
    ``strata nn train --only stance``. Strata's pipeline uses the rule engine in
    :mod:`strata.stance` instead, which measured 90% precision against this
    model's 36% on the adversarial probes.
    """
    return _load("stance", TextClassifier)


def rigour_net() -> MultiLabelClassifier | None:
    """Methodological-safeguard reader: randomisation, blinding, registration…"""
    return _load("rigour", MultiLabelClassifier)


def available() -> dict[str, bool]:
    """Which trained networks are present on disk."""
    return {n: os.path.exists(_weight_path(n)) for n in ("design", "rigour")}


def clear_cache() -> None:
    """Drop loaded weights — used by the trainer after writing new checkpoints."""
    with _lock:
        _cache.clear()
