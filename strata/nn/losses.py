"""Objectives.

``cross_entropy`` — with label smoothing and per-class weights. Both matter for
this corpus: study designs are heavily imbalanced (PubMed has far more reviews
than meta-analyses), and an over-confident design classifier is worse than a
hesitant one, because Strata surfaces the confidence to the clinician.

``info_nce`` — in-batch contrastive loss for the relevance bi-encoder. Every
other abstract in the batch is a negative for the current question, so a batch of
32 gives 31 free negatives per example without needing labelled non-matches.
"""
from __future__ import annotations

import math

from .linalg import log_softmax


def cross_entropy(logits: list[float], target: int,
                  class_weight: list[float] | None = None,
                  smoothing: float = 0.0) -> tuple[float, list[float]]:
    """Returns (loss, dlogits).

    With smoothing ``s`` and ``C`` classes the target distribution is
    ``1 - s`` on the true class and ``s / (C - 1)`` spread over the rest.
    """
    c = len(logits)
    logp = log_softmax(logits)
    p = [math.exp(v) for v in logp]
    w = class_weight[target] if class_weight else 1.0

    if smoothing <= 0.0:
        loss = -logp[target] * w
        d = [w * pi for pi in p]
        d[target] -= w
        return loss, d

    off = smoothing / max(1, c - 1)
    loss = 0.0
    d = [0.0] * c
    for i in range(c):
        q = (1.0 - smoothing) if i == target else off
        loss -= q * logp[i]
        d[i] = w * (p[i] - q)
    return loss * w, d


def binary_cross_entropy(logits: list[float], targets: list[float],
                         pos_weight: list[float] | None = None,
                         smoothing: float = 0.0) -> tuple[float, list[float]]:
    """Independent sigmoid cross-entropy — one decision per label.

    Used for the methodological safeguards, which genuinely co-occur: a trial can
    be randomised *and* blinded *and* registered, and a softmax would force those
    to compete for one unit of probability mass.

    Computed in the numerically stable form
    ``max(z, 0) - z*y + log(1 + exp(-|z|))`` so a confident logit of -40 does not
    overflow on the way to a loss of essentially zero.

    ``pos_weight`` scales the positive term per label. Prospective registration
    appears in a minority of abstracts, and without this the model learns that
    predicting "not registered" everywhere is an excellent strategy.
    """
    n = len(logits)
    loss = 0.0
    d = [0.0] * n
    for i in range(n):
        z = logits[i]
        y = targets[i]
        if smoothing > 0.0:
            y = y * (1.0 - smoothing) + 0.5 * smoothing
        w = 1.0
        if pos_weight is not None and targets[i] > 0.5:
            w = pos_weight[i]
        az = z if z >= 0.0 else -z
        loss += w * (max(z, 0.0) - z * y + math.log1p(math.exp(-az)))
        sig = 1.0 / (1.0 + math.exp(-z)) if z >= 0 else math.exp(z) / (1.0 + math.exp(z))
        d[i] = w * (sig - y)
    return loss / max(1, n), [g / max(1, n) for g in d]


def sigmoid(z: float) -> float:
    if z >= 0.0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def info_nce(q_emb: list[list[float]], d_emb: list[list[float]],
             temperature: float = 0.07) -> tuple[float, list[list[float]], list[list[float]]]:
    """Symmetric InfoNCE over L2-normalised embeddings.

    ``q_emb[i]`` is paired with ``d_emb[i]``; every ``d_emb[j != i]`` is a
    negative, and the loss is averaged over both directions so the two towers
    receive balanced signal. Returns (loss, dq, dd).
    """
    n = len(q_emb)
    if n < 2:
        return 0.0, [[0.0] * len(v) for v in q_emb], [[0.0] * len(v) for v in d_emb]

    inv_t = 1.0 / temperature
    sim = [[sum(a * b for a, b in zip(q, d)) * inv_t for d in d_emb] for q in q_emb]

    dsim = [[0.0] * n for _ in range(n)]
    loss = 0.0

    # question -> document
    for i in range(n):
        lp = log_softmax(sim[i])
        loss -= lp[i]
        for j in range(n):
            dsim[i][j] += (math.exp(lp[j]) - (1.0 if j == i else 0.0)) / (2 * n)

    # document -> question (columns)
    for j in range(n):
        col = [sim[i][j] for i in range(n)]
        lp = log_softmax(col)
        loss -= lp[j]
        for i in range(n):
            dsim[i][j] += (math.exp(lp[i]) - (1.0 if i == j else 0.0)) / (2 * n)

    loss /= (2 * n)

    dim = len(q_emb[0])
    dq = [[0.0] * dim for _ in range(n)]
    dd = [[0.0] * dim for _ in range(n)]
    for i in range(n):
        for j in range(n):
            g = dsim[i][j] * inv_t
            if g == 0.0:
                continue
            qi, dj = q_emb[i], d_emb[j]
            dqi, ddj = dq[i], dd[j]
            for k in range(dim):
                dqi[k] += g * dj[k]
                ddj[k] += g * qi[k]
    return loss, dq, dd


def normalize_backward(v: list[float], dy: list[float], eps: float = 1e-9) -> list[float]:
    """Gradient through ``x / ||x||`` — needed because the bi-encoder normalises
    before the loss sees it, and skipping this term quietly biases training."""
    n2 = sum(x * x for x in v)
    n = math.sqrt(n2) + eps
    proj = sum(x * g for x, g in zip(v, dy)) / (n2 + eps)
    return [(g - x * proj) / n for x, g in zip(v, dy)]
