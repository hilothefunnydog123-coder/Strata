"""The two model shapes Strata trains.

Both share one trunk:

    hashed n-grams -> embedding -> [attention pool ‖ mean pool] -> layer norm

The attention pool is what a reader would call the model's *focus*; the mean pool
is its *impression of the whole document*. Concatenating them fixes a failure the
attention-only version had on this corpus: a single phrase like "we randomly
assigned" would swamp an abstract that is otherwise plainly a retrospective chart
review, because nothing in the pooled vector remembered the rest of the text.

:class:`TextClassifier` adds an MLP head and a temperature. The temperature is
fitted on held-out data after training, so the number Strata prints as
"confidence" is a calibrated probability rather than an unnormalised softmax peak
— when the classifier says 70% it should be right about 70% of the time, and the
trainer reports the expected calibration error to show whether it is.

:class:`BiEncoder` replaces the head with a projection to a unit sphere and is
trained contrastively. Strata uses it for two things: scoring how well an abstract
actually answers the question asked, and collapsing near-duplicate papers (the
same trial reported twice) so a consensus is not manufactured out of one study.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from . import store
from .linalg import cosine, normalize, softmax
from .losses import normalize_backward
from .modules import (AttentionPool, Dropout, Embedding, GELU, LayerNorm,
                      Linear, MeanPool)
from .text import Vectorizer, merge_spans


@dataclass
class Prediction:
    label: str
    index: int
    confidence: float
    probs: dict[str, float]
    margin: float                                  # top prob minus runner-up
    evidence_spans: list[tuple[str, float]] = field(default_factory=list)

    @property
    def is_confident(self) -> bool:
        """The threshold Strata uses before letting a network override a rule."""
        return self.confidence >= 0.55 and self.margin >= 0.15


class _Trunk:
    def __init__(self, n_buckets: int, dim: int, rng):
        self.emb = Embedding(n_buckets, dim, rng)
        self.attn = AttentionPool(dim, rng)
        self.mean = MeanPool(dim)
        self.norm = LayerNorm(2 * dim)
        self.dim = dim
        self._E: list[list[float]] = []

    def params(self):
        return (self.emb.params() + self.attn.params()
                + self.mean.params() + self.norm.params())

    def forward(self, ids: list[int]) -> tuple[list[float], list[float]]:
        if not ids:
            self._E = []
            return [0.0] * (2 * self.dim), []
        E = self.emb.forward(ids)
        self._E = E
        pooled, a = self.attn.forward(E)
        avg = self.mean.forward(E)
        return self.norm.forward(pooled + avg), a

    def backward(self, dy: list[float]) -> None:
        if not self._E:
            return
        dh = self.norm.backward(dy)
        d = self.dim
        dE = [[0.0] * d for _ in self._E]
        self.attn.backward(dh[:d], dE)
        self.mean.backward(dh[d:], dE)
        self.emb.backward(dE)


class TextClassifier:
    """Attention-pooled n-gram classifier with a calibrated confidence."""

    KIND = "TextClassifier"

    def __init__(self, labels: list[str], *, dim: int = 32, hidden: int = 64,
                 dropout: float = 0.15, vectorizer: Vectorizer | None = None,
                 seed: int = 7, temperature: float = 1.0, meta: dict | None = None):
        rng = random.Random(seed)
        self.labels = list(labels)
        self.vectorizer = vectorizer or Vectorizer()
        self.dim = dim
        self.hidden = hidden
        self.temperature = temperature
        self.meta = meta or {}
        self.trunk = _Trunk(self.vectorizer.n_buckets, dim, rng)
        self.fc1 = Linear(2 * dim, hidden, rng, "fc1")
        self.act = GELU()
        self.drop = Dropout(dropout, rng)
        self.fc2 = Linear(hidden, len(labels), rng, "fc2")
        self._attn: list[float] = []
        self._ids: list[int] = []

    # ---------------------------------------------------------------- params
    def params(self):
        return (self.trunk.params() + self.fc1.params()
                + self.act.params() + self.fc2.params())

    def n_params(self) -> int:
        return sum(len(r) for p in self.params() for r in p.rows)

    # --------------------------------------------------------------- forward
    def forward_ids(self, ids: list[int], training: bool = False) -> list[float]:
        self._ids = ids
        h, a = self.trunk.forward(ids)
        self._attn = a
        z = self.fc1.forward(h)
        z = self.act.forward(z)
        z = self.drop.forward(z, training)
        return self.fc2.forward(z)

    def backward(self, dlogits: list[float]) -> None:
        d = self.fc2.backward(dlogits)
        d = self.drop.backward(d)
        d = self.act.backward(d)
        d = self.fc1.backward(d)
        self.trunk.backward(d)

    # ------------------------------------------------------------- inference
    def logits(self, text: str) -> list[float]:
        return self.forward_ids(self.vectorizer.buckets(text), training=False)

    def predict(self, text: str, *, explain: bool = True,
                top_spans: int = 4) -> Prediction:
        feats = self.vectorizer.features(text)
        logits = self.forward_ids([f.bucket for f in feats], training=False)
        t = self.temperature if self.temperature > 0 else 1.0
        probs = softmax([v / t for v in logits])
        order = sorted(range(len(probs)), key=lambda i: -probs[i])
        best = order[0]
        runner = probs[order[1]] if len(order) > 1 else 0.0

        spans: list[tuple[str, float]] = []
        if explain and feats and self._attn:
            spans = self._spans(text, feats, top_spans)

        return Prediction(
            label=self.labels[best], index=best, confidence=probs[best],
            probs={lab: probs[i] for i, lab in enumerate(self.labels)},
            margin=probs[best] - runner, evidence_spans=spans)

    def _spans(self, text: str, feats, top_spans: int) -> list[tuple[str, float]]:
        """Turn attention weights back into quoted phrases from the source text."""
        pairs = sorted(zip(self._attn, feats), key=lambda p: -p[0])
        peak = pairs[0][0] if pairs else 0.0
        if peak <= 0.0:
            return []
        keep = [(f.start, f.end, w) for w, f in pairs[:top_spans * 3]
                if w >= peak * 0.25]
        if not keep:
            return []
        weights = {(s, e): w for s, e, w in keep}
        merged = merge_spans([(s, e) for s, e, _ in keep])
        out = []
        for s, e in merged:
            w = max((wt for (ws, we), wt in weights.items()
                     if ws >= s and we <= e), default=0.0)
            phrase = " ".join(text[s:e].split())
            if phrase:
                out.append((phrase, round(w / peak, 3)))
        out.sort(key=lambda p: -p[1])
        return out[:top_spans]

    # ------------------------------------------------------- serialisation
    def config(self) -> dict:
        return {"dim": self.dim, "hidden": self.hidden,
                "temperature": self.temperature,
                "vectorizer": self.vectorizer.config()}

    def tensors(self) -> dict:
        return {
            "emb": self.trunk.emb.weight.rows,
            "attn_q": self.trunk.attn.query.rows,
            "ln_g": self.trunk.norm.gain.rows,
            "ln_b": self.trunk.norm.bias.rows,
            "fc1_w": self.fc1.weight.rows, "fc1_b": self.fc1.bias.rows,
            "fc2_w": self.fc2.weight.rows, "fc2_b": self.fc2.bias.rows,
        }

    def load_tensors(self, t: dict) -> None:
        self.trunk.emb.weight.rows = t["emb"]
        self.trunk.attn.query.rows = t["attn_q"]
        self.trunk.norm.gain.rows = t["ln_g"]
        self.trunk.norm.bias.rows = t["ln_b"]
        self.fc1.weight.rows, self.fc1.bias.rows = t["fc1_w"], t["fc1_b"]
        self.fc2.weight.rows, self.fc2.bias.rows = t["fc2_w"], t["fc2_b"]

    def save(self, path: str, *, dtype: str = "int8", meta: dict | None = None) -> None:
        store.save(path, kind=self.KIND, config=self.config(), labels=self.labels,
                   tensors=self.tensors(), meta=meta or self.meta, dtype=dtype)

    @classmethod
    def load(cls, path: str) -> "TextClassifier":
        doc = store.load(path)
        if doc["kind"] != cls.KIND:
            raise ValueError(f"{path}: expected {cls.KIND}, found {doc['kind']}")
        cfg = doc["config"]
        m = cls(doc["labels"], dim=cfg["dim"], hidden=cfg["hidden"],
                vectorizer=Vectorizer.from_config(cfg["vectorizer"]),
                temperature=cfg.get("temperature", 1.0), meta=doc.get("meta", {}))
        m.load_tensors(doc["tensors"])
        return m


@dataclass
class MultiLabelPrediction:
    """Independent per-label decisions, plus the spans behind them."""
    present: list[str]
    probs: dict[str, float]
    thresholds: dict[str, float]
    evidence_spans: list[tuple[str, float]] = field(default_factory=list)

    def score(self, weights: dict[str, float]) -> float:
        """Weighted share of safeguards judged present, in [0, 1]."""
        total = sum(weights.get(k, 0.0) for k in self.probs)
        if total <= 0:
            return 0.0
        got = sum(weights.get(k, 0.0) for k in self.present)
        return got / total


class MultiLabelClassifier(TextClassifier):
    """Same trunk, independent sigmoid outputs.

    Reads a methods section for the safeguards that decide a study's internal
    validity. Each label carries its own decision threshold, fitted on held-out
    data to maximise F1 rather than left at 0.5 — the labels have very different
    base rates, and a single threshold sacrifices the rare ones entirely.
    """

    KIND = "MultiLabelClassifier"

    def __init__(self, labels, *, thresholds: list[float] | None = None, **kw):
        super().__init__(labels, **kw)
        self.thresholds = list(thresholds) if thresholds else [0.5] * len(labels)

    def predict_labels(self, text: str, *, explain: bool = True,
                       top_spans: int = 4) -> MultiLabelPrediction:
        feats = self.vectorizer.features(text)
        logits = self.forward_ids([f.bucket for f in feats], training=False)
        probs = [_sigmoid(v) for v in logits]
        present = [lab for lab, p, t in zip(self.labels, probs, self.thresholds)
                   if p >= t]
        spans = self._spans(text, feats, top_spans) if explain and feats and self._attn else []
        return MultiLabelPrediction(
            present=present,
            probs={lab: round(p, 4) for lab, p in zip(self.labels, probs)},
            thresholds=dict(zip(self.labels, self.thresholds)),
            evidence_spans=spans)

    def config(self) -> dict:
        cfg = super().config()
        cfg["thresholds"] = self.thresholds
        return cfg

    @classmethod
    def load(cls, path: str) -> "MultiLabelClassifier":
        doc = store.load(path)
        if doc["kind"] != cls.KIND:
            raise ValueError(f"{path}: expected {cls.KIND}, found {doc['kind']}")
        cfg = doc["config"]
        m = cls(doc["labels"], dim=cfg["dim"], hidden=cfg["hidden"],
                vectorizer=Vectorizer.from_config(cfg["vectorizer"]),
                thresholds=cfg.get("thresholds"), meta=doc.get("meta", {}))
        m.load_tensors(doc["tensors"])
        return m


def _sigmoid(z: float) -> float:
    if z >= 0.0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


class BiEncoder:
    """Shared-tower encoder mapping text to a unit vector.

    **Not shipped.** This class is complete, gradient-checked and usable, but no
    trained checkpoint is committed. On the seed corpus it overfits decisively —
    training loss reaches ~0.0005 while held-out recall@1 sits near chance —
    because relevance between a question and an abstract is, for a bag-of-ngrams
    model, lexical overlap, and the embedding rows for a topic it has never seen
    are still at their initialisation. Forty-odd synthetic topics cannot fix that.

    Strata therefore scores question-abstract relevance with BM25 (see
    :mod:`strata.ranking`), which needs no training and does not pretend to
    understand. Retrain this on harvested PubMed data across a few thousand real
    topics and the picture may change; that is what ``strata nn train --source
    pubmed`` exists for.

    One tower, not two: questions and abstracts are both clinical English, and a
    shared tower halves the parameters while making the embedding space
    symmetric, so abstract-to-abstract similarity (used for de-duplication) is
    meaningful without a second training objective.
    """

    KIND = "BiEncoder"

    def __init__(self, *, dim: int = 32, out_dim: int = 32,
                 vectorizer: Vectorizer | None = None, seed: int = 11,
                 meta: dict | None = None):
        rng = random.Random(seed)
        self.vectorizer = vectorizer or Vectorizer()
        self.dim = dim
        self.out_dim = out_dim
        self.meta = meta or {}
        self.trunk = _Trunk(self.vectorizer.n_buckets, dim, rng)
        self.proj = Linear(2 * dim, out_dim, rng, "proj")
        self.labels: list[str] = []
        self._raw: list[float] = []

    def params(self):
        return self.trunk.params() + self.proj.params()

    def n_params(self) -> int:
        return sum(len(r) for p in self.params() for r in p.rows)

    def forward_ids(self, ids: list[int]) -> list[float]:
        h, _ = self.trunk.forward(ids)
        raw = self.proj.forward(h)
        self._raw = raw
        return normalize(raw)

    def backward(self, d_unit: list[float]) -> None:
        d_raw = normalize_backward(self._raw, d_unit)
        self.trunk.backward(self.proj.backward(d_raw))

    def encode(self, text: str) -> list[float]:
        return self.forward_ids(self.vectorizer.buckets(text))

    def similarity(self, a: str, b: str) -> float:
        """Cosine in [-1, 1]; rescaled to [0, 1] by callers that need a score."""
        return cosine(self.encode(a), self.encode(b))

    def config(self) -> dict:
        return {"dim": self.dim, "out_dim": self.out_dim,
                "vectorizer": self.vectorizer.config()}

    def tensors(self) -> dict:
        return {
            "emb": self.trunk.emb.weight.rows,
            "attn_q": self.trunk.attn.query.rows,
            "ln_g": self.trunk.norm.gain.rows,
            "ln_b": self.trunk.norm.bias.rows,
            "proj_w": self.proj.weight.rows, "proj_b": self.proj.bias.rows,
        }

    def load_tensors(self, t: dict) -> None:
        self.trunk.emb.weight.rows = t["emb"]
        self.trunk.attn.query.rows = t["attn_q"]
        self.trunk.norm.gain.rows = t["ln_g"]
        self.trunk.norm.bias.rows = t["ln_b"]
        self.proj.weight.rows, self.proj.bias.rows = t["proj_w"], t["proj_b"]

    def save(self, path: str, *, dtype: str = "int8", meta: dict | None = None) -> None:
        store.save(path, kind=self.KIND, config=self.config(), labels=[],
                   tensors=self.tensors(), meta=meta or self.meta, dtype=dtype)

    @classmethod
    def load(cls, path: str) -> "BiEncoder":
        doc = store.load(path)
        if doc["kind"] != cls.KIND:
            raise ValueError(f"{path}: expected {cls.KIND}, found {doc['kind']}")
        cfg = doc["config"]
        m = cls(dim=cfg["dim"], out_dim=cfg["out_dim"],
                vectorizer=Vectorizer.from_config(cfg["vectorizer"]),
                meta=doc.get("meta", {}))
        m.load_tensors(doc["tensors"])
        return m


def expected_calibration_error(probs: list[float], correct: list[bool],
                               bins: int = 10) -> float:
    """Mean gap between confidence and accuracy, bucketed by confidence.

    Reported by the trainer because Strata shows confidence to a clinician. A
    model with 88% accuracy and an ECE of 0.20 is not a model worth deferring to.
    """
    if not probs:
        return 0.0
    total = len(probs)
    err = 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        idx = [i for i, p in enumerate(probs)
               if (p > lo or (b == 0 and p >= lo)) and p <= hi]
        if not idx:
            continue
        conf = sum(probs[i] for i in idx) / len(idx)
        acc = sum(1 for i in idx if correct[i]) / len(idx)
        err += (len(idx) / total) * abs(conf - acc)
    return err


def fit_temperature(logit_sets: list[list[float]], targets: list[int],
                    lo: float = 0.1, hi: float = 8.0, iters: int = 60) -> float:
    """Golden-section search for the temperature minimising held-out NLL.

    One parameter, fitted after the weights are frozen — Platt scaling's simplest
    useful form, and the only honest way to put a number next to a label.

    The range spans both directions on purpose. Label smoothing leaves this model
    systematically *under*-confident, so the fitted temperature usually comes out
    below 1 (sharpening) rather than above it; a range that started at 1.0 would
    silently clip and leave the reported confidence wrong in the other direction.
    """
    if not logit_sets:
        return 1.0

    def nll(t: float) -> float:
        total = 0.0
        for z, y in zip(logit_sets, targets):
            scaled = [v / t for v in z]
            m = max(scaled)
            lse = m + math.log(sum(math.exp(v - m) for v in scaled))
            total += lse - scaled[y]
        return total / len(targets)

    phi = (math.sqrt(5.0) - 1.0) / 2.0
    a, b = lo, hi
    c, d = b - phi * (b - a), a + phi * (b - a)
    fc, fd = nll(c), nll(d)
    for _ in range(iters):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - phi * (b - a)
            fc = nll(c)
        else:
            a, c, fc = c, d, fd
            d = a + phi * (b - a)
            fd = nll(d)
        if b - a < 1e-4:
            break
    return round((a + b) / 2.0, 4)
