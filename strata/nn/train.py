"""Training loops and evaluation.

Everything here runs on CPU in pure Python, so the loops are written for a
budget of minutes, not hours: small embeddings, capped feature counts, and
minibatches accumulated by hand.

Three things this trainer does that a quick script would skip, and each one
exists because leaving it out produced a worse shipped model:

**Topic-disjoint validation.** See :func:`strata.nn.corpus.split`. Random splits
reported several points of accuracy that vanished on unseen subject matter.

**Calibration after fitting.** The weights are frozen, then a single temperature
is fitted on the validation logits. Strata prints confidence to a clinician; an
uncalibrated softmax peak is not a probability and should not be shown as one.

**Quantised evaluation.** The final metrics are computed after the int8
round-trip that :mod:`strata.nn.store` will perform on save, so the numbers in
the checkpoint's metadata describe the file that ships, not a float model that
only ever existed in memory.
"""
from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field

from . import store
from .corpus import Example
from .losses import binary_cross_entropy, cross_entropy, info_nce, sigmoid
from .model import (BiEncoder, MultiLabelClassifier, TextClassifier,
                    expected_calibration_error, fit_temperature)
from .optim import Adam, clip_global_norm, warmup_cosine


# ---------------------------------------------------------------------- report

@dataclass
class Report:
    labels: list[str]
    accuracy: float = 0.0
    macro_f1: float = 0.0
    ece: float = 0.0
    temperature: float = 1.0
    confusion: list[list[int]] = field(default_factory=list)
    per_class: dict[str, dict[str, float]] = field(default_factory=dict)
    n_train: int = 0
    n_val: int = 0
    n_params: int = 0
    epochs: int = 0
    seconds: float = 0.0
    history: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"accuracy": round(self.accuracy, 4), "macro_f1": round(self.macro_f1, 4),
                "ece": round(self.ece, 4), "temperature": self.temperature,
                "n_train": self.n_train, "n_val": self.n_val,
                "n_params": self.n_params, "epochs": self.epochs,
                "seconds": round(self.seconds, 1),
                "per_class": self.per_class, "labels": self.labels}

    def table(self) -> str:
        w = max(len(l) for l in self.labels) if self.labels else 8
        lines = [f"{'class':<{w}}  {'prec':>6} {'rec':>6} {'f1':>6} {'n':>6}"]
        lines.append("-" * len(lines[0]))
        for lab in self.labels:
            m = self.per_class.get(lab, {})
            lines.append(f"{lab:<{w}}  {m.get('precision', 0):>6.3f} "
                         f"{m.get('recall', 0):>6.3f} {m.get('f1', 0):>6.3f} "
                         f"{int(m.get('support', 0)):>6}")
        lines.append("-" * len(lines[0]))
        lines.append(f"{'overall':<{w}}  {'':>6} {'':>6} {self.macro_f1:>6.3f} {self.n_val:>6}")
        return "\n".join(lines)

    def confusion_table(self) -> str:
        short = [l[:9] for l in self.labels]
        w = max((len(s) for s in short), default=6)
        head = " " * (w + 2) + " ".join(f"{s[:6]:>6}" for s in short)
        rows = [head]
        for i, lab in enumerate(short):
            cells = " ".join(f"{self.confusion[i][j]:>6}" for j in range(len(short)))
            rows.append(f"{lab:<{w}}  {cells}")
        return "\n".join(rows)


def evaluate(model: TextClassifier, examples: list[Example], field_name: str,
             *, temperature: float | None = None) -> Report:
    labels = model.labels
    index = {l: i for i, l in enumerate(labels)}
    n = len(labels)
    conf = [[0] * n for _ in range(n)]
    confs: list[float] = []
    correct_flags: list[bool] = []
    t = temperature if temperature is not None else model.temperature

    for ex in examples:
        gold = getattr(ex, field_name)
        if gold not in index:
            continue
        logits = model.logits(ex.text)
        scaled = [v / t for v in logits]
        m = max(scaled)
        exps = [math.exp(v - m) for v in scaled]
        s = sum(exps) or 1.0
        probs = [e / s for e in exps]
        pred = max(range(n), key=lambda i: probs[i])
        conf[index[gold]][pred] += 1
        confs.append(probs[pred])
        correct_flags.append(pred == index[gold])

    total = sum(sum(r) for r in conf) or 1
    acc = sum(conf[i][i] for i in range(n)) / total

    per_class = {}
    f1s = []
    for i, lab in enumerate(labels):
        tp = conf[i][i]
        fp = sum(conf[r][i] for r in range(n)) - tp
        fn = sum(conf[i]) - tp
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        per_class[lab] = {"precision": round(prec, 4), "recall": round(rec, 4),
                          "f1": round(f1, 4), "support": sum(conf[i])}
        if sum(conf[i]):
            f1s.append(f1)

    return Report(labels=labels, accuracy=acc,
                  macro_f1=sum(f1s) / len(f1s) if f1s else 0.0,
                  ece=expected_calibration_error(confs, correct_flags),
                  temperature=t, confusion=conf, per_class=per_class,
                  n_val=total, n_params=model.n_params())


# ------------------------------------------------------------------ classifier

def _class_weights(examples: list[Example], field_name: str,
                   labels: list[str]) -> list[float]:
    """Inverse-frequency weights, normalised to mean 1 and clamped.

    Uncapped inverse frequency lets a class with a handful of examples dominate
    every gradient; the clamp keeps the correction meaningful without letting the
    rarest class rewrite the embedding table on its own.
    """
    counts = {l: 0 for l in labels}
    for e in examples:
        v = getattr(e, field_name)
        if v in counts:
            counts[v] += 1
    total = sum(counts.values()) or 1
    raw = [total / (len(labels) * max(1, counts[l])) for l in labels]
    mean = sum(raw) / len(raw)
    return [min(4.0, max(0.25, w / mean)) for w in raw]


def train_classifier(train: list[Example], val: list[Example], *,
                     field_name: str, labels: list[str], dim: int = 32,
                     hidden: int = 64, epochs: int = 12, batch_size: int = 16,
                     lr: float = 4e-3, dropout: float = 0.15,
                     smoothing: float = 0.05, weight_decay: float = 1e-5,
                     seed: int = 7, log=print) -> tuple[TextClassifier, Report]:
    started = time.time()
    index = {l: i for i, l in enumerate(labels)}
    train = [e for e in train if getattr(e, field_name) in index]
    val = [e for e in val if getattr(e, field_name) in index]
    if not train:
        raise ValueError(f"no training examples carry a {field_name} label")

    model = TextClassifier(labels, dim=dim, hidden=hidden, dropout=dropout, seed=seed)
    weights = _class_weights(train, field_name, labels)
    opt = Adam(model.params(), lr=lr, weight_decay=weight_decay)
    rng = random.Random(seed)

    # Feature extraction is a meaningful share of the run time and the corpus is
    # static, so ids are hashed once up front rather than every epoch.
    cache = [(model.vectorizer.buckets(e.text), index[getattr(e, field_name)])
             for e in train]

    log(f"  {len(train):,} train / {len(val):,} val · {len(labels)} classes · "
        f"{model.n_params():,} params")

    steps_per_epoch = max(1, len(cache) // batch_size)
    total_steps = steps_per_epoch * epochs
    step = 0
    best_f1, best_tensors, best_epoch = -1.0, None, 0
    history = []

    for epoch in range(epochs):
        rng.shuffle(cache)
        running = 0.0
        seen = 0
        for b in range(steps_per_epoch):
            batch = cache[b * batch_size:(b + 1) * batch_size]
            if not batch:
                continue
            opt.zero_grad()
            for ids, target in batch:
                logits = model.forward_ids(ids, training=True)
                loss, dlogits = cross_entropy(logits, target, class_weight=weights,
                                              smoothing=smoothing)
                running += loss
                seen += 1
                model.backward(dlogits)
            clip_global_norm(model.params(), 1.0)
            opt.step(lr=warmup_cosine(step, total_steps, lr),
                     grad_scale=1.0 / len(batch))
            step += 1

        rep = evaluate(model, val, field_name, temperature=1.0) if val else None
        train_loss = running / max(1, seen)
        entry = {"epoch": epoch + 1, "loss": round(train_loss, 4),
                 "val_acc": round(rep.accuracy, 4) if rep else None,
                 "val_f1": round(rep.macro_f1, 4) if rep else None}
        history.append(entry)
        log(f"  epoch {epoch + 1:>2}/{epochs}  loss {train_loss:.4f}"
            + (f"  val acc {rep.accuracy:.3f}  macro-F1 {rep.macro_f1:.3f}" if rep else ""))

        if rep and rep.macro_f1 > best_f1:
            best_f1, best_epoch = rep.macro_f1, epoch + 1
            best_tensors = {k: [list(r) for r in v] for k, v in model.tensors().items()}

    if best_tensors is not None:
        model.load_tensors(best_tensors)
        log(f"  restored best checkpoint from epoch {best_epoch} (macro-F1 {best_f1:.3f})")

    # Calibrate on held-out logits, with the weights already frozen.
    if val:
        logit_sets = [model.logits(e.text) for e in val]
        targets = [index[getattr(e, field_name)] for e in val]
        model.temperature = fit_temperature(logit_sets, targets)
        log(f"  fitted temperature T = {model.temperature}")

    # Score the model as it will actually be served: after int8 quantisation.
    model.load_tensors({k: store.quantize_roundtrip(v)
                        for k, v in model.tensors().items()})
    report = evaluate(model, val, field_name) if val else Report(labels=labels)
    report.n_train = len(train)
    report.n_params = model.n_params()
    report.epochs = epochs
    report.seconds = time.time() - started
    report.history = history
    report.temperature = model.temperature
    return model, report


# ------------------------------------------------------------- multi-label

@dataclass
class MultiLabelReport:
    labels: list[str]
    per_label: dict[str, dict[str, float]] = field(default_factory=dict)
    macro_f1: float = 0.0
    micro_f1: float = 0.0
    subset_accuracy: float = 0.0
    thresholds: dict[str, float] = field(default_factory=dict)
    n_train: int = 0
    n_val: int = 0
    n_params: int = 0
    epochs: int = 0
    seconds: float = 0.0
    history: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"macro_f1": round(self.macro_f1, 4), "micro_f1": round(self.micro_f1, 4),
                "subset_accuracy": round(self.subset_accuracy, 4),
                "thresholds": {k: round(v, 3) for k, v in self.thresholds.items()},
                "per_label": self.per_label, "n_train": self.n_train,
                "n_val": self.n_val, "n_params": self.n_params,
                "epochs": self.epochs, "seconds": round(self.seconds, 1),
                "labels": self.labels}

    def table(self) -> str:
        w = max((len(l) for l in self.labels), default=8)
        lines = [f"{'safeguard':<{w}}  {'prec':>6} {'rec':>6} {'f1':>6} {'thr':>5} {'pos':>5}"]
        lines.append("-" * len(lines[0]))
        for lab in self.labels:
            m = self.per_label.get(lab, {})
            lines.append(f"{lab:<{w}}  {m.get('precision', 0):>6.3f} "
                         f"{m.get('recall', 0):>6.3f} {m.get('f1', 0):>6.3f} "
                         f"{self.thresholds.get(lab, 0.5):>5.2f} "
                         f"{int(m.get('support', 0)):>5}")
        lines.append("-" * len(lines[0]))
        lines.append(f"{'macro':<{w}}  {'':>6} {'':>6} {self.macro_f1:>6.3f}")
        lines.append(f"{'micro':<{w}}  {'':>6} {'':>6} {self.micro_f1:>6.3f}")
        return "\n".join(lines)


def _label_scores(probs_by_label, gold_by_label, thresholds):
    per_label, f1s = {}, []
    tp_all = fp_all = fn_all = 0
    for i, lab in enumerate(probs_by_label):
        tp = fp = fn = 0
        for p, y in zip(probs_by_label[lab], gold_by_label[lab]):
            hit = p >= thresholds[i]
            if hit and y:
                tp += 1
            elif hit and not y:
                fp += 1
            elif not hit and y:
                fn += 1
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        per_label[lab] = {"precision": round(prec, 4), "recall": round(rec, 4),
                          "f1": round(f1, 4), "support": tp + fn}
        f1s.append(f1)
        tp_all, fp_all, fn_all = tp_all + tp, fp_all + fp, fn_all + fn
    mp = tp_all / (tp_all + fp_all) if tp_all + fp_all else 0.0
    mr = tp_all / (tp_all + fn_all) if tp_all + fn_all else 0.0
    micro = 2 * mp * mr / (mp + mr) if mp + mr else 0.0
    return per_label, (sum(f1s) / len(f1s) if f1s else 0.0), micro


#: Thresholds are never allowed below this. An F-optimal threshold fitted on a
#: corpus where a label appears a third of the time can drop very low, and a low
#: threshold is fine in-distribution and badly trigger-happy outside it — a
#: narrative review scoring 0.25 for "adjusted for confounding" should not be
#: credited with having adjusted for anything.
MIN_THRESHOLD = 0.35

#: Precision is weighted above recall. Strata renders a safeguard as a positive
#: claim about a paper ("✓ blinded"), so crediting a study with rigour it never
#: reported is a worse error than staying quiet about rigour it did.
THRESHOLD_BETA = 0.5


def _fit_thresholds(probs_by_label, gold_by_label, labels,
                    beta: float = THRESHOLD_BETA) -> list[float]:
    """Per-label decision threshold, fitted on held-out data.

    Maximises F-beta rather than F1, and never returns a value below
    :data:`MIN_THRESHOLD`. A flat 0.5 would be right only if every label were
    balanced and the model perfectly calibrated, and neither holds here.
    """
    b2 = beta * beta
    out = []
    for lab in labels:
        probs, gold = probs_by_label[lab], gold_by_label[lab]
        best_t, best_score = MIN_THRESHOLD, -1.0
        for step in range(int(MIN_THRESHOLD * 100), 96):
            t = step / 100.0
            tp = sum(1 for p, y in zip(probs, gold) if p >= t and y)
            fp = sum(1 for p, y in zip(probs, gold) if p >= t and not y)
            fn = sum(1 for p, y in zip(probs, gold) if p < t and y)
            prec = tp / (tp + fp) if tp + fp else 0.0
            rec = tp / (tp + fn) if tp + fn else 0.0
            denom = b2 * prec + rec
            score = (1 + b2) * prec * rec / denom if denom else 0.0
            if score > best_score:
                best_t, best_score = t, score
        out.append(best_t)
    return out


def _collect(model, examples, labels):
    probs_by_label = {l: [] for l in labels}
    gold_by_label = {l: [] for l in labels}
    for ex in examples:
        logits = model.forward_ids(model.vectorizer.buckets(ex.text), training=False)
        for i, lab in enumerate(labels):
            probs_by_label[lab].append(sigmoid(logits[i]))
            gold_by_label[lab].append(lab in ex.rigour)
    return probs_by_label, gold_by_label


def train_multilabel(train: list[Example], val: list[Example], *,
                     labels: list[str], dim: int = 32, hidden: int = 64,
                     epochs: int = 12, batch_size: int = 16, lr: float = 4e-3,
                     dropout: float = 0.15, smoothing: float = 0.03,
                     weight_decay: float = 1e-5, seed: int = 13,
                     log=print) -> tuple[MultiLabelClassifier, MultiLabelReport]:
    started = time.time()
    model = MultiLabelClassifier(labels, dim=dim, hidden=hidden,
                                 dropout=dropout, seed=seed)

    positives = [sum(1 for e in train if l in e.rigour) for l in labels]
    n = len(train)
    pos_weight = [min(6.0, max(1.0, (n - p) / max(1, p))) if p else 1.0
                  for p in positives]
    log(f"  {n:,} train / {len(val):,} val · {len(labels)} safeguards · "
        f"{model.n_params():,} params")
    log("  base rates: " + ", ".join(f"{l}={p / max(1, n):.0%}"
                                     for l, p in zip(labels, positives)))

    opt = Adam(model.params(), lr=lr, weight_decay=weight_decay)
    rng = random.Random(seed)
    cache = [(model.vectorizer.buckets(e.text),
              [1.0 if l in e.rigour else 0.0 for l in labels]) for e in train]

    steps_per_epoch = max(1, len(cache) // batch_size)
    total_steps = steps_per_epoch * epochs
    step = 0
    best_f1, best_tensors, best_epoch = -1.0, None, 0
    history = []

    for epoch in range(epochs):
        rng.shuffle(cache)
        running, seen = 0.0, 0
        for b in range(steps_per_epoch):
            batch = cache[b * batch_size:(b + 1) * batch_size]
            if not batch:
                continue
            opt.zero_grad()
            for ids, targets in batch:
                logits = model.forward_ids(ids, training=True)
                loss, dlogits = binary_cross_entropy(
                    logits, targets, pos_weight=pos_weight, smoothing=smoothing)
                running += loss
                seen += 1
                model.backward(dlogits)
            clip_global_norm(model.params(), 1.0)
            opt.step(lr=warmup_cosine(step, total_steps, lr),
                     grad_scale=1.0 / len(batch))
            step += 1

        macro = 0.0
        if val:
            pv, gv = _collect(model, val, labels)
            _, macro, _ = _label_scores(pv, gv, [0.5] * len(labels))
        history.append({"epoch": epoch + 1, "loss": round(running / max(1, seen), 4),
                        "val_macro_f1": round(macro, 4)})
        log(f"  epoch {epoch + 1:>2}/{epochs}  loss {running / max(1, seen):.4f}"
            + (f"  val macro-F1 {macro:.3f}" if val else ""))
        if val and macro > best_f1:
            best_f1, best_epoch = macro, epoch + 1
            best_tensors = {k: [list(r) for r in v] for k, v in model.tensors().items()}

    if best_tensors is not None:
        model.load_tensors(best_tensors)
        log(f"  restored best checkpoint from epoch {best_epoch} (macro-F1 {best_f1:.3f})")

    model.load_tensors({k: store.quantize_roundtrip(v)
                        for k, v in model.tensors().items()})

    report = MultiLabelReport(labels=labels, n_train=n, n_val=len(val),
                              n_params=model.n_params(), epochs=epochs,
                              history=history)
    if val:
        pv, gv = _collect(model, val, labels)
        model.thresholds = _fit_thresholds(pv, gv, labels)
        per_label, macro, micro = _label_scores(pv, gv, model.thresholds)
        report.per_label, report.macro_f1, report.micro_f1 = per_label, macro, micro
        report.thresholds = dict(zip(labels, model.thresholds))
        exact = 0
        for i, ex in enumerate(val):
            pred = {l for j, l in enumerate(labels)
                    if pv[l][i] >= model.thresholds[j]}
            exact += (pred == set(ex.rigour))
        report.subset_accuracy = exact / len(val)
        log(f"  fitted thresholds: "
            + ", ".join(f"{l}={t:.2f}" for l, t in report.thresholds.items()))
    report.seconds = time.time() - started
    return model, report


# ----------------------------------------------------------------- bi-encoder

def _distinct_topic_batches(examples: list[Example], batch_size: int,
                            rng: random.Random) -> list[list[Example]]:
    """Batch so that no two examples share a topic.

    In-batch contrastive training treats every other document as a negative. Two
    abstracts about vitamin D and respiratory infection are *not* negatives for
    each other, and training on that pair teaches the encoder to pull apart texts
    it should be pulling together. Where topic ids are unavailable (harvested
    data) this degrades gracefully to plain shuffling.
    """
    by_topic: dict[int, list[Example]] = {}
    for e in examples:
        by_topic.setdefault(e.topic_id, []).append(e)
    if len(by_topic) < 2 or -1 in by_topic:
        pool = list(examples)
        rng.shuffle(pool)
        return [pool[i:i + batch_size] for i in range(0, len(pool), batch_size)]

    for group in by_topic.values():
        rng.shuffle(group)
    batches = []
    pools = {t: list(g) for t, g in by_topic.items()}
    while True:
        available = [t for t, g in pools.items() if g]
        if len(available) < 2:
            break
        rng.shuffle(available)
        take = available[:batch_size]
        batch = [pools[t].pop() for t in take]
        if len(batch) < 2:
            break
        batches.append(batch)
    return batches


def train_relevance(train: list[Example], val: list[Example], *, dim: int = 32,
                    out_dim: int = 32, epochs: int = 8, batch_size: int = 16,
                    lr: float = 3e-3, temperature: float = 0.07, seed: int = 11,
                    log=print) -> tuple[BiEncoder, dict]:
    """Contrastive training of the question-to-abstract encoder.

    Each step runs the tower twice over the batch: once to collect embeddings for
    the loss, then once more per item to restore the activations the backward
    pass needs. Caching activations for a whole batch would cost more memory than
    the second forward costs time, at these sizes.
    """
    started = time.time()
    model = BiEncoder(dim=dim, out_dim=out_dim, seed=seed)
    opt = Adam(model.params(), lr=lr)
    rng = random.Random(seed)

    cache = [(model.vectorizer.buckets(e.question),
              model.vectorizer.buckets(e.text), e.topic_id) for e in train]
    by_id = {i: ex for i, ex in enumerate(train)}
    log(f"  {len(train):,} pairs · {model.n_params():,} params")

    total_steps = epochs * max(1, len(cache) // batch_size)
    step = 0
    history = []

    for epoch in range(epochs):
        batches = _distinct_topic_batches([by_id[i] for i in range(len(train))],
                                          batch_size, rng)
        running, nb = 0.0, 0
        for batch in batches:
            if len(batch) < 2:
                continue
            q_ids = [model.vectorizer.buckets(e.question) for e in batch]
            d_ids = [model.vectorizer.buckets(e.text) for e in batch]
            q_emb = [list(model.forward_ids(i)) for i in q_ids]
            d_emb = [list(model.forward_ids(i)) for i in d_ids]

            loss, dq, dd = info_nce(q_emb, d_emb, temperature=temperature)
            running += loss
            nb += 1

            opt.zero_grad()
            for ids, grad in zip(q_ids, dq):
                model.forward_ids(ids)
                model.backward(grad)
            for ids, grad in zip(d_ids, dd):
                model.forward_ids(ids)
                model.backward(grad)
            clip_global_norm(model.params(), 1.0)
            opt.step(lr=warmup_cosine(step, total_steps, lr))
            step += 1

        acc = recall_at_1(model, val) if val else 0.0
        history.append({"epoch": epoch + 1, "loss": round(running / max(1, nb), 4),
                        "val_recall@1": round(acc, 4)})
        log(f"  epoch {epoch + 1:>2}/{epochs}  loss {running / max(1, nb):.4f}"
            + (f"  val recall@1 {acc:.3f}" if val else ""))

    model.load_tensors({k: store.quantize_roundtrip(v)
                        for k, v in model.tensors().items()})
    final = recall_at_1(model, val) if val else 0.0
    return model, {"recall_at_1": round(final, 4), "n_train": len(train),
                   "n_val": len(val), "n_params": model.n_params(),
                   "epochs": epochs, "seconds": round(time.time() - started, 1),
                   "history": history}


def recall_at_1(model: BiEncoder, examples: list[Example], limit: int = 160) -> float:
    """Share of questions whose own abstract is the nearest of the candidates.

    A pure ranking metric over a held-out pool: the encoder has to prefer the
    right abstract over every other one it is shown, which is exactly the job it
    does inside :func:`strata.query.ask`.
    """
    pool = examples[:limit]
    if len(pool) < 2:
        return 0.0
    docs = [model.encode(e.text) for e in pool]
    hits = 0
    for i, e in enumerate(pool):
        q = model.encode(e.question)
        best, best_score = -1, -2.0
        for j, d in enumerate(docs):
            s = sum(a * b for a, b in zip(q, d))
            if s > best_score:
                best, best_score = j, s
        if best == i:
            hits += 1
    return hits / len(pool)
