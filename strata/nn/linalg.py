"""Dense float primitives, pure Python.

Matrices are lists of row-lists; vectors are flat lists. Everything is written
as a tight loop rather than a comprehension chain because these run inside the
training loop and readability at the cost of a 3x slowdown is a bad trade here.

Only what the models actually need lives in this file. There is no broadcasting,
no shape checking beyond assertions in debug paths, and no general autodiff —
each module in :mod:`strata.nn.modules` carries its own hand-derived backward.
"""
from __future__ import annotations

import math

# ---------------------------------------------------------------- construction

def zeros(n: int) -> list[float]:
    return [0.0] * n


def zeros_mat(rows: int, cols: int) -> list[list[float]]:
    return [[0.0] * cols for _ in range(rows)]


def randn(rng, n: int, scale: float) -> list[float]:
    return [rng.gauss(0.0, scale) for _ in range(n)]


def randn_mat(rng, rows: int, cols: int, scale: float) -> list[list[float]]:
    g = rng.gauss
    return [[g(0.0, scale) for _ in range(cols)] for _ in range(rows)]


def glorot(rng, rows: int, cols: int) -> list[list[float]]:
    """Xavier/Glorot normal — keeps activation variance stable through depth."""
    return randn_mat(rng, rows, cols, math.sqrt(2.0 / (rows + cols)))


# ------------------------------------------------------------------- vector ops

def dot(a: list[float], b: list[float]) -> float:
    s = 0.0
    for x, y in zip(a, b):
        s += x * y
    return s


def axpy(dst: list[float], src: list[float], a: float) -> None:
    """dst += a * src, in place."""
    if a == 0.0:
        return
    for i, v in enumerate(src):
        dst[i] += a * v


def scale_(v: list[float], a: float) -> None:
    for i in range(len(v)):
        v[i] *= a


def l2(v: list[float]) -> float:
    s = 0.0
    for x in v:
        s += x * x
    return math.sqrt(s)


def normalize(v: list[float], eps: float = 1e-9) -> list[float]:
    n = l2(v) + eps
    return [x / n for x in v]


def cosine(a: list[float], b: list[float]) -> float:
    na, nb = l2(a), l2(b)
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot(a, b) / (na * nb)


# ------------------------------------------------------------------- matrix ops

def matvec(W: list[list[float]], x: list[float]) -> list[float]:
    """y = W x  for W of shape (out, in)."""
    out = []
    for row in W:
        s = 0.0
        for w, v in zip(row, x):
            s += w * v
        out.append(s)
    return out


def matvec_bias(W: list[list[float]], x: list[float], b: list[float]) -> list[float]:
    out = []
    for row, bi in zip(W, b):
        s = bi
        for w, v in zip(row, x):
            s += w * v
        out.append(s)
    return out


def vecmat(dy: list[float], W: list[list[float]]) -> list[float]:
    """dx = W^T dy  — the input gradient of a Linear layer."""
    n_in = len(W[0]) if W else 0
    dx = [0.0] * n_in
    for g, row in zip(dy, W):
        if g == 0.0:
            continue
        for j, w in enumerate(row):
            dx[j] += g * w
    return dx


def accumulate_outer(G: list[list[float]], dy: list[float], x: list[float]) -> None:
    """G += outer(dy, x), in place — the weight gradient of a Linear layer."""
    for i, g in enumerate(dy):
        if g == 0.0:
            continue
        row = G[i]
        for j, v in enumerate(x):
            row[j] += g * v


# ---------------------------------------------------------------- nonlinearity

_SQRT_2_OVER_PI = math.sqrt(2.0 / math.pi)


def gelu(x: list[float]) -> list[float]:
    """Tanh approximation of GELU — smooth, and cheap enough to run per token."""
    out = []
    for v in x:
        c = _SQRT_2_OVER_PI * (v + 0.044715 * v * v * v)
        out.append(0.5 * v * (1.0 + math.tanh(c)))
    return out


def gelu_backward(x: list[float], dy: list[float]) -> list[float]:
    out = []
    for v, g in zip(x, dy):
        c = _SQRT_2_OVER_PI * (v + 0.044715 * v * v * v)
        t = math.tanh(c)
        dc = _SQRT_2_OVER_PI * (1.0 + 3 * 0.044715 * v * v)
        out.append(g * (0.5 * (1.0 + t) + 0.5 * v * (1.0 - t * t) * dc))
    return out


def softmax(x: list[float]) -> list[float]:
    m = max(x) if x else 0.0
    exps = [math.exp(v - m) for v in x]
    s = sum(exps) or 1.0
    return [e / s for e in exps]


def log_softmax(x: list[float]) -> list[float]:
    m = max(x) if x else 0.0
    shifted = [v - m for v in x]
    lse = math.log(sum(math.exp(v) for v in shifted) or 1e-300)
    return [v - lse for v in shifted]
