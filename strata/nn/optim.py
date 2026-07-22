"""Adam, decoupled weight decay, and a warmup-cosine schedule.

Two wrinkles worth knowing about:

*Sparse rows keep their own clock.* Classic sparse Adam bias-corrects with the
global step count, which is wrong for an embedding row touched twice in a run —
its second-moment estimate is nearly zero but gets divided by ``1 - b2^t`` for a
large ``t``, producing an enormous first update. Each row here carries its own
step counter, so a rare n-gram gets the same well-behaved warm-up a common one
got at the start of training.

*Weight decay is decoupled* (AdamW). Folding L2 into the gradient makes the
effective decay depend on the gradient's magnitude, which for a hashed embedding
varies by orders of magnitude across buckets. Embedding rows are exempt: decaying
a row on the steps where it did not appear would pull unseen n-grams toward zero
purely as a function of corpus order.
"""
from __future__ import annotations

import math


class Adam:
    def __init__(self, params, lr: float = 2e-3, betas=(0.9, 0.999),
                 eps: float = 1e-8, weight_decay: float = 0.0):
        self.params = list(params)
        self.lr = lr
        self.b1, self.b2 = betas
        self.eps = eps
        self.weight_decay = weight_decay
        self.t = 0
        self._dense: dict[int, tuple[list, list]] = {}
        self._sparse: dict[int, tuple[dict, dict, dict]] = {}
        for p in self.params:
            if hasattr(p, "sparse_grad"):
                self._sparse[id(p)] = ({}, {}, {})          # m, v, per-row step
            else:
                self._dense[id(p)] = ([[0.0] * len(r) for r in p.rows],
                                      [[0.0] * len(r) for r in p.rows])

    # ------------------------------------------------------------------ step
    def step(self, lr: float | None = None, grad_scale: float = 1.0) -> None:
        self.t += 1
        lr = self.lr if lr is None else lr
        b1, b2, eps = self.b1, self.b2, self.eps
        bc1 = 1.0 - b1 ** self.t
        bc2 = 1.0 - b2 ** self.t
        wd = self.weight_decay

        for p in self.params:
            if hasattr(p, "sparse_grad"):
                self._step_sparse(p, lr, grad_scale)
                continue
            m_all, v_all = self._dense[id(p)]
            for row, grow, m, v in zip(p.rows, p.grad, m_all, v_all):
                for i in range(len(row)):
                    g = grow[i] * grad_scale
                    mi = m[i] = b1 * m[i] + (1.0 - b1) * g
                    vi = v[i] = b2 * v[i] + (1.0 - b2) * g * g
                    upd = (mi / bc1) / (math.sqrt(vi / bc2) + eps)
                    if wd:
                        upd += wd * row[i]
                    row[i] -= lr * upd

    def _step_sparse(self, p, lr: float, grad_scale: float) -> None:
        m_map, v_map, t_map = self._sparse[id(p)]
        b1, b2, eps = self.b1, self.b2, self.eps
        rows = p.rows
        for idx, grad in p.sparse_grad.items():
            row = rows[idx]
            m = m_map.get(idx)
            if m is None:
                n = len(row)
                m = m_map[idx] = [0.0] * n
                v_map[idx] = [0.0] * n
                t_map[idx] = 0
            v = v_map[idx]
            t = t_map[idx] = t_map[idx] + 1
            bc1 = 1.0 - b1 ** t
            bc2 = 1.0 - b2 ** t
            for i in range(len(row)):
                g = grad[i] * grad_scale
                mi = m[i] = b1 * m[i] + (1.0 - b1) * g
                vi = v[i] = b2 * v[i] + (1.0 - b2) * g * g
                row[i] -= lr * (mi / bc1) / (math.sqrt(vi / bc2) + eps)

    def zero_grad(self) -> None:
        for p in self.params:
            p.zero_grad()


def clip_global_norm(params, max_norm: float) -> float:
    """Rescale all gradients so their joint L2 norm is at most ``max_norm``.

    Returns the pre-clip norm, which the trainer logs — a norm that spikes by an
    order of magnitude is usually a corpus problem, not a model problem.
    """
    total = 0.0
    for p in params:
        if hasattr(p, "sparse_grad"):
            for g in p.sparse_grad.values():
                for v in g:
                    total += v * v
        else:
            for row in p.grad:
                for v in row:
                    total += v * v
    norm = math.sqrt(total)
    if norm <= max_norm or norm == 0.0:
        return norm
    s = max_norm / norm
    for p in params:
        if hasattr(p, "sparse_grad"):
            for g in p.sparse_grad.values():
                for i in range(len(g)):
                    g[i] *= s
        else:
            for row in p.grad:
                for i in range(len(row)):
                    row[i] *= s
    return norm


def warmup_cosine(step: int, total: int, base_lr: float,
                  warmup_frac: float = 0.08, min_frac: float = 0.05) -> float:
    """Linear warmup then cosine decay to ``min_frac * base_lr``."""
    if total <= 0:
        return base_lr
    warm = max(1, int(total * warmup_frac))
    if step < warm:
        return base_lr * (step + 1) / warm
    progress = (step - warm) / max(1, total - warm)
    progress = min(1.0, max(0.0, progress))
    cos = 0.5 * (1.0 + math.cos(math.pi * progress))
    return base_lr * (min_frac + (1.0 - min_frac) * cos)
