"""Layers, with hand-derived backward passes.

There is no autograd here. Each module implements ``forward`` and ``backward``
explicitly and stashes whatever the backward needs on the instance. That is a
deliberate choice: a scalar-graph autodiff in pure Python would be roughly two
orders of magnitude slower than these loops, and the model zoo is small enough
that four derivations fit in one readable file.

Every gradient in this module is verified against central finite differences in
``tests/test_nn.py``. If you change a backward pass, that test is the contract.

Parameters come in two flavours:

``Param``        dense; the whole gradient is zeroed and updated each step.
``SparseParam``  the embedding table; only the rows an example actually touched
                 get a gradient, and Adam keeps per-row moment state and per-row
                 step counts. Zeroing a 8192x32 table on every step would cost
                 more than the rest of the network combined.
"""
from __future__ import annotations

import math

from .linalg import (accumulate_outer, dot, gelu, gelu_backward, glorot,
                     matvec_bias, softmax, vecmat, zeros, zeros_mat)


# ------------------------------------------------------------------ parameters

class Param:
    """A dense parameter. Always stored as a list of rows; a vector is one row."""
    __slots__ = ("rows", "grad", "name")

    def __init__(self, rows: list[list[float]], name: str):
        self.rows = rows
        self.grad = [[0.0] * len(r) for r in rows]
        self.name = name

    @classmethod
    def vector(cls, n: int, name: str) -> "Param":
        return cls([zeros(n)], name)

    @property
    def vec(self) -> list[float]:
        return self.rows[0]

    @property
    def dvec(self) -> list[float]:
        return self.grad[0]

    def zero_grad(self) -> None:
        for row in self.grad:
            for i in range(len(row)):
                row[i] = 0.0


class SparseParam:
    """An embedding table with per-row gradients."""
    __slots__ = ("rows", "sparse_grad", "name")

    def __init__(self, rows: list[list[float]], name: str):
        self.rows = rows
        self.sparse_grad: dict[int, list[float]] = {}
        self.name = name

    def zero_grad(self) -> None:
        self.sparse_grad = {}

    def accumulate(self, index: int, delta: list[float], weight: float = 1.0) -> None:
        g = self.sparse_grad.get(index)
        if g is None:
            g = [0.0] * len(delta)
            self.sparse_grad[index] = g
        if weight == 1.0:
            for i, v in enumerate(delta):
                g[i] += v
        else:
            for i, v in enumerate(delta):
                g[i] += weight * v


# --------------------------------------------------------------------- modules

class Embedding:
    """Hashed-bucket lookup table. Forward is a gather, so cost scales with the
    number of features in the document, not with the size of the table."""

    def __init__(self, n_buckets: int, dim: int, rng):
        # Small init: the attention pool takes dot products of these vectors, and
        # a large init saturates the softmax before training starts.
        self.weight = SparseParam(
            [[rng.gauss(0.0, 0.08) for _ in range(dim)] for _ in range(n_buckets)],
            "emb")
        self.dim = dim
        self.n_buckets = n_buckets
        self._ids: list[int] = []

    def params(self):
        return [self.weight]

    def forward(self, ids: list[int]) -> list[list[float]]:
        self._ids = ids
        rows = self.weight.rows
        return [rows[i] for i in ids]

    def backward(self, d_rows: list[list[float]]) -> None:
        acc = self.weight.accumulate
        for i, d in zip(self._ids, d_rows):
            acc(i, d)


class AttentionPool:
    """Single-head additive-free attention over token embeddings.

        s_t = <q, e_t> / sqrt(d)      a = softmax(s)      p = sum_t a_t e_t

    A learned query vector scores every token; the softmax over those scores is
    both the pooling weight and, downstream, the explanation. Using a plain dot
    product rather than a projected additive score keeps the per-token cost at d
    multiplies, which is what makes a 160-feature document affordable in Python.
    """

    def __init__(self, dim: int, rng):
        self.query = Param([[rng.gauss(0.0, 0.1) for _ in range(dim)]], "attn_q")
        self.dim = dim
        self.scale = 1.0 / math.sqrt(dim)
        self._E: list[list[float]] = []
        self._a: list[float] = []

    def params(self):
        return [self.query]

    def forward(self, E: list[list[float]]) -> tuple[list[float], list[float]]:
        q = self.query.vec
        sc = self.scale
        scores = []
        for e in E:
            s = 0.0
            for qi, ei in zip(q, e):
                s += qi * ei
            scores.append(s * sc)
        a = softmax(scores)
        pooled = [0.0] * self.dim
        for w, e in zip(a, E):
            if w < 1e-6:
                continue
            for i, v in enumerate(e):
                pooled[i] += w * v
        self._E, self._a = E, a
        return pooled, a

    def backward(self, d_pooled: list[float], dE: list[list[float]]) -> None:
        """Accumulates into ``dE`` in place and into the query gradient."""
        E, a = self._E, self._a
        # d a_t = <d_pooled, e_t> ; and the direct path d e_t += a_t * d_pooled
        da = []
        for w, e, de in zip(a, E, dE):
            da.append(dot(d_pooled, e))
            if w != 0.0:
                for i, v in enumerate(d_pooled):
                    de[i] += w * v
        # softmax Jacobian
        s = 0.0
        for w, g in zip(a, da):
            s += w * g
        ds = [w * (g - s) for w, g in zip(a, da)]
        # scores = <q, e> * scale
        dq = self.query.dvec
        sc = self.scale
        q = self.query.vec
        for g, e, de in zip(ds, E, dE):
            if g == 0.0:
                continue
            gs = g * sc
            for i, v in enumerate(e):
                dq[i] += gs * v
            for i, v in enumerate(q):
                de[i] += gs * v


class MeanPool:
    """Unweighted average over tokens. Concatenated with the attention pool so a
    single dominant phrase cannot erase the document's overall character."""

    def __init__(self, dim: int):
        self.dim = dim
        self._n = 0

    def params(self):
        return []

    def forward(self, E: list[list[float]]) -> list[float]:
        self._n = len(E) or 1
        out = [0.0] * self.dim
        for e in E:
            for i, v in enumerate(e):
                out[i] += v
        inv = 1.0 / self._n
        return [v * inv for v in out]

    def backward(self, d_out: list[float], dE: list[list[float]]) -> None:
        inv = 1.0 / (self._n or 1)
        for de in dE:
            for i, v in enumerate(d_out):
                de[i] += v * inv


class LayerNorm:
    def __init__(self, dim: int, eps: float = 1e-5):
        self.gain = Param([[1.0] * dim], "ln_g")
        self.bias = Param([[0.0] * dim], "ln_b")
        self.eps = eps
        self.dim = dim
        self._xhat: list[float] = []
        self._inv: float = 1.0

    def params(self):
        return [self.gain, self.bias]

    def forward(self, x: list[float]) -> list[float]:
        n = len(x)
        mu = sum(x) / n
        var = sum((v - mu) ** 2 for v in x) / n
        inv = 1.0 / math.sqrt(var + self.eps)
        xhat = [(v - mu) * inv for v in x]
        self._xhat, self._inv = xhat, inv
        return [g * h + b for g, h, b in zip(self.gain.vec, xhat, self.bias.vec)]

    def backward(self, dy: list[float]) -> list[float]:
        xhat, inv, n = self._xhat, self._inv, len(dy)
        dg, db = self.gain.dvec, self.bias.dvec
        dxhat = []
        for i, (g, h, d) in enumerate(zip(self.gain.vec, xhat, dy)):
            dg[i] += d * h
            db[i] += d
            dxhat.append(d * g)
        mean_dxhat = sum(dxhat) / n
        mean_prod = sum(d * h for d, h in zip(dxhat, xhat)) / n
        return [inv * (d - mean_dxhat - h * mean_prod) for d, h in zip(dxhat, xhat)]


class Linear:
    def __init__(self, n_in: int, n_out: int, rng, name: str = "fc"):
        self.weight = Param(glorot(rng, n_out, n_in), name + "_w")
        self.bias = Param([[0.0] * n_out], name + "_b")
        self._x: list[float] = []

    def params(self):
        return [self.weight, self.bias]

    def forward(self, x: list[float]) -> list[float]:
        self._x = x
        return matvec_bias(self.weight.rows, x, self.bias.vec)

    def backward(self, dy: list[float]) -> list[float]:
        accumulate_outer(self.weight.grad, dy, self._x)
        db = self.bias.dvec
        for i, g in enumerate(dy):
            db[i] += g
        return vecmat(dy, self.weight.rows)


class GELU:
    def __init__(self):
        self._x: list[float] = []

    def params(self):
        return []

    def forward(self, x: list[float]) -> list[float]:
        self._x = x
        return gelu(x)

    def backward(self, dy: list[float]) -> list[float]:
        return gelu_backward(self._x, dy)


class Dropout:
    """Inverted dropout: scaling happens at train time so inference is a no-op."""

    def __init__(self, p: float, rng):
        self.p = p
        self.rng = rng
        self._mask: list[float] | None = None

    def params(self):
        return []

    def forward(self, x: list[float], training: bool) -> list[float]:
        if not training or self.p <= 0.0:
            self._mask = None
            return x
        keep = 1.0 - self.p
        inv = 1.0 / keep
        r = self.rng.random
        mask = [inv if r() < keep else 0.0 for _ in x]
        self._mask = mask
        return [v * m for v, m in zip(x, mask)]

    def backward(self, dy: list[float]) -> list[float]:
        if self._mask is None:
            return dy
        return [g * m for g, m in zip(dy, self._mask)]


def concat(a: list[float], b: list[float]) -> list[float]:
    return a + b


def split(d: list[float], n: int) -> tuple[list[float], list[float]]:
    return d[:n], d[n:]
