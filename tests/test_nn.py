"""Gradient checks and invariants for the neural layer.

Run: ``python tests/test_nn.py``

The backward passes in ``strata/nn/modules.py`` are hand-derived, which means the
only thing standing between a sign error and a model that trains to 40% accuracy
for mysterious reasons is this file. Every parameter of every module is compared
against a central finite difference; the tolerance is tight enough to catch a
dropped term and loose enough to survive float64 cancellation.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# These scripts print I-squared, tau and box-drawing characters. A Windows
# console defaulting to cp1252 would raise mid-run, so ask for UTF-8 explicitly.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, OSError):
    pass

import math                                                    # noqa: E402
import random                                                  # noqa: E402

from strata.nn import store                                    # noqa: E402
from strata.nn.losses import (cross_entropy, info_nce,          # noqa: E402
                              normalize_backward)
from strata.nn.model import (BiEncoder, TextClassifier,         # noqa: E402
                             expected_calibration_error, fit_temperature)
from strata.nn.optim import Adam, clip_global_norm, warmup_cosine  # noqa: E402
from strata.nn.text import Vectorizer, merge_spans, tokenize    # noqa: E402

EPS = 1e-5
TOL = 2e-4

TEXT = ("METHODS: In this double-blind, placebo-controlled randomised trial we "
        "assigned 1,204 adults to vitamin D or placebo. RESULTS: The hazard "
        "ratio was 0.86 (95% CI 0.74-0.99; p = 0.04).")


def _rel_err(a, b):
    return abs(a - b) / max(1.0, abs(a), abs(b))


def _numeric_grad(loss_fn, rows, i, j):
    original = rows[i][j]
    rows[i][j] = original + EPS
    plus = loss_fn()
    rows[i][j] = original - EPS
    minus = loss_fn()
    rows[i][j] = original
    return (plus - minus) / (2 * EPS)


# ------------------------------------------------------------------ tokeniser

def test_tokenizer_is_deterministic_and_spanned():
    a = Vectorizer().features(TEXT)
    b = Vectorizer().features(TEXT)
    assert [f.bucket for f in a] == [f.bucket for f in b], "hashing must be stable"
    assert all(0 <= f.start < f.end <= len(TEXT) for f in a), "spans must index text"
    # numbers collapse by magnitude, not identity
    toks = dict((t, (s, e)) for t, s, e in tokenize("we enrolled 1204 and 9 people"))
    assert "<num4>" in toks and "<num1>" in toks
    assert merge_spans([(0, 5), (6, 9), (30, 34)]) == [(0, 9), (30, 34)]
    print("ok  tokeniser: stable hashing, magnitude-bucketed numbers, merged spans")


# ------------------------------------------------------------ classifier grads

def test_classifier_gradients_match_finite_differences():
    model = TextClassifier(["a", "b", "c"], dim=6, hidden=8, dropout=0.0, seed=3)
    ids = model.vectorizer.buckets(TEXT)
    target = 1

    def loss():
        return cross_entropy(model.forward_ids(ids, training=False), target,
                             smoothing=0.05)[0]

    logits = model.forward_ids(ids, training=False)
    _, dlogits = cross_entropy(logits, target, smoothing=0.05)
    for p in model.params():
        p.zero_grad()
    model.backward(dlogits)

    checked = 0
    rnd = random.Random(0)
    for p in model.params():
        if hasattr(p, "sparse_grad"):
            for idx, g in list(p.sparse_grad.items())[:4]:
                for j in range(len(g)):
                    num = _numeric_grad(loss, p.rows, idx, j)
                    assert _rel_err(num, g[j]) < TOL, \
                        f"emb[{idx}][{j}]: analytic {g[j]:.8f} vs numeric {num:.8f}"
                    checked += 1
        else:
            for i in range(len(p.rows)):
                cols = range(len(p.rows[i]))
                sample = rnd.sample(list(cols), min(4, len(p.rows[i])))
                for j in sample:
                    num = _numeric_grad(loss, p.rows, i, j)
                    assert _rel_err(num, p.grad[i][j]) < TOL, \
                        f"{p.name}[{i}][{j}]: analytic {p.grad[i][j]:.8f} vs numeric {num:.8f}"
                    checked += 1
    assert checked > 60
    print(f"ok  classifier: {checked} gradients match central differences")


def test_biencoder_gradients_match_finite_differences():
    model = BiEncoder(dim=6, out_dim=5, seed=5)
    ids = model.vectorizer.buckets(TEXT)
    direction = [0.31, -0.62, 0.15, 0.44, -0.28]

    def loss():
        return sum(u * d for u, d in zip(model.forward_ids(ids), direction))

    model.forward_ids(ids)
    for p in model.params():
        p.zero_grad()
    model.backward(direction)

    checked = 0
    for p in model.params():
        if hasattr(p, "sparse_grad"):
            for idx, g in list(p.sparse_grad.items())[:3]:
                for j in range(len(g)):
                    assert _rel_err(_numeric_grad(loss, p.rows, idx, j), g[j]) < TOL
                    checked += 1
        else:
            for i in range(len(p.rows)):
                for j in range(min(3, len(p.rows[i]))):
                    num = _numeric_grad(loss, p.rows, i, j)
                    assert _rel_err(num, p.grad[i][j]) < TOL, \
                        f"{p.name}[{i}][{j}] mismatch"
                    checked += 1
    assert checked > 40
    print(f"ok  bi-encoder: {checked} gradients match (incl. the normalise term)")


def test_normalize_backward_is_the_true_jacobian():
    v = [0.4, -1.2, 0.7, 0.05]
    dy = [0.9, 0.3, -0.5, 0.22]

    def unit(x):
        n = math.sqrt(sum(t * t for t in x)) + 1e-9
        return [t / n for t in x]

    analytic = normalize_backward(v, dy)
    for i in range(len(v)):
        up, dn = list(v), list(v)
        up[i] += EPS
        dn[i] -= EPS
        num = (sum(a * b for a, b in zip(unit(up), dy))
               - sum(a * b for a, b in zip(unit(dn), dy))) / (2 * EPS)
        assert _rel_err(num, analytic[i]) < TOL
    print("ok  normalise backward matches the analytic Jacobian")


# ----------------------------------------------------------------- objectives

def test_cross_entropy_smoothing_and_weights():
    logits = [2.0, 0.5, -1.0]
    loss, d = cross_entropy(logits, 0)
    assert loss > 0 and abs(sum(d)) < 1e-9, "gradients of a softmax CE sum to zero"

    smooth_loss, _ = cross_entropy(logits, 0, smoothing=0.2)
    assert smooth_loss > loss, "smoothing penalises a confident correct answer"

    weighted, _ = cross_entropy(logits, 0, class_weight=[3.0, 1.0, 1.0])
    assert abs(weighted - 3.0 * loss) < 1e-9
    print("ok  cross-entropy: smoothing, class weights, zero-sum gradient")


def test_info_nce_prefers_the_paired_document():
    q = [[1.0, 0.0], [0.0, 1.0]]
    aligned, _, _ = info_nce(q, [[1.0, 0.0], [0.0, 1.0]])
    swapped, _, _ = info_nce(q, [[0.0, 1.0], [1.0, 0.0]])
    assert aligned < swapped, "matched pairs must score better than swapped ones"

    # gradient check against the loss surface itself
    qs = [[0.6, -0.3], [0.1, 0.9], [-0.5, 0.2]]
    ds = [[0.2, 0.7], [-0.4, 0.1], [0.8, 0.3]]
    _, dq, _ = info_nce(qs, ds)
    for i in range(len(qs)):
        for j in range(2):
            up = [list(r) for r in qs]
            dn = [list(r) for r in qs]
            up[i][j] += EPS
            dn[i][j] -= EPS
            num = (info_nce(up, ds)[0] - info_nce(dn, ds)[0]) / (2 * EPS)
            assert _rel_err(num, dq[i][j]) < 1e-3
    print("ok  InfoNCE: ranks pairs correctly and its gradient checks out")


# ------------------------------------------------------------------ optimiser

def test_adam_sparse_rows_use_their_own_clock():
    """A row seen for the first time at step 500 must not receive a huge update."""
    model = TextClassifier(["a", "b"], dim=4, hidden=4, dropout=0.0, seed=1)
    emb = model.trunk.emb.weight
    opt = Adam(model.params(), lr=0.01)

    for _ in range(500):                     # advance the global clock only
        opt.zero_grad()
        opt.step()

    before = list(emb.rows[100])
    opt.zero_grad()
    emb.accumulate(100, [0.5] * 4)
    opt.step()
    moved = max(abs(a - b) for a, b in zip(before, emb.rows[100]))
    assert moved < 0.02, f"first-touch update was {moved:.4f}, expected ~lr"
    print("ok  sparse Adam bias-corrects per row, not per global step")


def test_clipping_and_schedule():
    model = TextClassifier(["a", "b"], dim=4, hidden=4, dropout=0.0, seed=2)
    for p in model.params():
        p.zero_grad()
    model.fc2.weight.grad[0][0] = 1000.0
    norm = clip_global_norm(model.params(), 1.0)
    assert norm >= 1000.0
    total = math.sqrt(sum(v * v for p in model.params()
                          if not hasattr(p, "sparse_grad")
                          for row in p.grad for v in row))
    assert abs(total - 1.0) < 1e-6, f"clipped norm was {total}"

    lrs = [warmup_cosine(s, 100, 1.0) for s in range(100)]
    assert lrs[0] < lrs[7] and abs(max(lrs) - 1.0) < 1e-6
    assert lrs[-1] < 0.1, "cosine must decay"
    print("ok  gradient clipping hits the target norm; schedule warms then decays")


# ------------------------------------------------- calibration & serialisation

def test_temperature_fitting_reduces_overconfidence():
    logits = [[6.0, 0.0], [6.0, 0.0], [6.0, 0.0], [0.0, 6.0]]
    targets = [0, 0, 1, 1]                     # one confident answer is wrong
    t = fit_temperature(logits, targets)
    assert t > 1.2, f"expected softening, got T={t}"

    hot = [0.99, 0.99, 0.99, 0.99]
    ece = expected_calibration_error(hot, [True, True, False, True])
    assert 0.2 < ece < 0.3
    print(f"ok  temperature fitting softens overconfidence (T={t}), ECE computed")


def test_checkpoint_roundtrip_is_faithful_and_small():
    model = TextClassifier(["meta", "rct", "review"], dim=8, hidden=12,
                           dropout=0.0, seed=9)
    model.temperature = 1.37
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tmp_ckpt.json")
    try:
        model.save(path, meta={"note": "roundtrip"})
        loaded = TextClassifier.load(path)
        assert loaded.labels == model.labels
        assert abs(loaded.temperature - 1.37) < 1e-6
        assert loaded.meta["note"] == "roundtrip"

        a = model.logits(TEXT)
        b = loaded.logits(TEXT)
        assert max(abs(x - y) for x, y in zip(a, b)) < 0.05, \
            "int8 quantisation must not move logits meaningfully"

        exact = os.path.join(os.path.dirname(path), "_tmp_ckpt_f32.json")
        model.save(exact, dtype="f32")
        c = TextClassifier.load(exact).logits(TEXT)
        assert max(abs(x - y) for x, y in zip(a, c)) < 1e-4, "f32 must be exact"
        assert os.path.getsize(path) < os.path.getsize(exact)
        os.remove(exact)
    finally:
        if os.path.exists(path):
            os.remove(path)
    print("ok  checkpoints round-trip; int8 is small and faithful, f32 is exact")


def test_quantize_roundtrip_helper():
    rows = [[0.5, -0.25, 0.125], [1e-6, -1e-6, 0.0]]
    back = store.quantize_roundtrip(rows)
    assert abs(back[0][0] - 0.5) < 1e-3
    assert all(abs(v) < 1e-5 for v in back[1]), "tiny rows keep their own scale"
    print("ok  row-wise quantisation preserves small-magnitude rows")


# ---------------------------------------------------- explanation & inference

def test_prediction_carries_quoted_evidence():
    model = TextClassifier(["a", "b"], dim=8, hidden=8, dropout=0.0, seed=4)
    p = model.predict(TEXT)
    assert 0.0 <= p.confidence <= 1.0
    assert abs(sum(p.probs.values()) - 1.0) < 1e-9
    assert p.evidence_spans, "a prediction must be able to point at the text"
    for phrase, weight in p.evidence_spans:
        assert phrase.lower() in " ".join(TEXT.lower().split())
        assert 0.0 <= weight <= 1.0
    print("ok  predictions quote the spans that drove them")


def test_empty_input_does_not_explode():
    model = TextClassifier(["a", "b"], dim=6, hidden=6, dropout=0.0, seed=6)
    p = model.predict("")
    assert abs(sum(p.probs.values()) - 1.0) < 1e-9
    enc = BiEncoder(dim=6, out_dim=4, seed=8).encode("")
    assert len(enc) == 4 and all(v == 0.0 for v in enc)
    print("ok  empty text yields a valid distribution and a zero embedding")


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        fn()
    print(f"\nall {len(tests)} neural-layer tests passed")
