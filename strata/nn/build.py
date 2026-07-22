"""Orchestration for ``strata nn train`` — build a corpus, fit all three
networks, write checkpoints, and record how they scored.

Every checkpoint carries its own provenance in ``meta``: which corpus it came
from, how many examples, what it scored on held-out data, and when it was built.
``strata nn info`` reads that back, so a user can always tell whether the model
answering their question was trained on real PubMed records or on the shipped
bootstrap corpus.
"""
from __future__ import annotations

import os
import time

from . import corpus as corpus_mod
from .corpus import DESIGN_LABELS, RIGOUR_LABELS, STANCE_LABELS, Example
from .train import train_classifier, train_multilabel

MODELS = ("design", "rigour")

WEIGHT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "weights")


def _stamp(source: str, extra: dict) -> dict:
    meta = {"corpus": source, "built": time.strftime("%Y-%m-%d %H:%M:%S"),
            "strata_nn": "1"}
    meta.update(extra)
    return meta


def build(*, source: str = "seed", per_class: int = 240, epochs: int = 12,
          out_dir: str | None = None, only: set[str] | None = None,
          dtype: str = "int8", log=print) -> dict:
    """Train and save the networks. Returns a summary dict of the run."""
    out_dir = out_dir or WEIGHT_DIR
    os.makedirs(out_dir, exist_ok=True)
    only = set(only) if only else set(MODELS)

    if source == "pubmed":
        log("Harvesting labelled records from PubMed…")
        examples = corpus_mod.harvest(per_class=per_class, verbose=True)
        if not examples:
            raise RuntimeError("harvest returned nothing — check network access")
    else:
        log(f"Generating the seed corpus ({per_class} per design)…")
        examples = corpus_mod.seed_corpus(n_per_design=per_class)

    train, val = corpus_mod.split(examples)
    disjoint = examples and examples[0].template_id >= 0
    log(f"{len(examples):,} examples · {len(train):,} train / {len(val):,} val "
        + ("(held out by topic, method template and safeguard phrasing)\n"
           if disjoint else "(random split)\n"))

    summary: dict = {"source": source, "n_examples": len(examples), "models": {}}

    if "design" in only:
        log("── design classifier " + "─" * 40)
        model, report = train_classifier(
            train, val, field_name="design", labels=DESIGN_LABELS,
            epochs=epochs, log=log)
        path = os.path.join(out_dir, "design.json")
        model.save(path, dtype=dtype,
                   meta=_stamp(source, {"task": "study design", **report.as_dict()}))
        log("\n" + report.table())
        log(f"\n  ECE {report.ece:.3f} · saved {path} "
            f"({os.path.getsize(path) / 1024:.0f} KB)\n")
        summary["models"]["design"] = report.as_dict()

    if "stance" in only:
        labelled = [e for e in train if e.stance]
        val_labelled = [e for e in val if e.stance]
        log("── stance classifier " + "─" * 40)
        if len(labelled) < 50:
            log("  too few stance labels to train — skipping\n")
        else:
            model, report = train_classifier(
                labelled, val_labelled, field_name="stance", labels=STANCE_LABELS,
                epochs=epochs, log=log)
            path = os.path.join(out_dir, "stance.json")
            model.save(path, dtype=dtype,
                       meta=_stamp(source, {"task": "finding direction",
                                            "weakly_labelled": source == "pubmed",
                                            **report.as_dict()}))
            log("\n" + report.table())
            log(f"\n  ECE {report.ece:.3f} · saved {path} "
                f"({os.path.getsize(path) / 1024:.0f} KB)\n")
            summary["models"]["stance"] = report.as_dict()

    if "rigour" in only:
        log("── methodological-safeguard reader " + "─" * 26)
        model, report = train_multilabel(
            train, val, labels=RIGOUR_LABELS, epochs=epochs, log=log)
        path = os.path.join(out_dir, "rigour.json")
        model.save(path, dtype=dtype,
                   meta=_stamp(source, {"task": "methodological safeguards",
                                        **report.as_dict()}))
        log("\n" + report.table())
        log(f"\n  exact-set match {report.subset_accuracy:.3f} · saved {path} "
            f"({os.path.getsize(path) / 1024:.0f} KB)\n")
        summary["models"]["rigour"] = report.as_dict()

    from . import clear_cache
    clear_cache()
    return summary


def describe() -> list[dict]:
    """Metadata for every checkpoint on disk — backs ``strata nn info``."""
    from . import store
    out = []
    for name in MODELS:
        path = os.path.join(WEIGHT_DIR, f"{name}.json")
        if not os.path.exists(path):
            out.append({"name": name, "present": False})
            continue
        try:
            doc = store.load(path)
            out.append({"name": name, "present": True, "kind": doc["kind"],
                        "labels": doc["labels"], "meta": doc.get("meta", {}),
                        "size_kb": round(os.path.getsize(path) / 1024, 1)})
        except Exception as exc:
            out.append({"name": name, "present": True, "error": str(exc)})
    return out
