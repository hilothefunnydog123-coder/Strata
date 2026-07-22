"""Checkpoint format.

A trained Strata model lives in the repository, so the file has to be small
enough to belong in a git history and stable enough to diff meaningfully. The
format is JSON with the bulk data as compressed base64:

    {"format": "strata-nn/1", "kind": ..., "config": {...}, "labels": [...],
     "meta": {...}, "tensors": {"emb": {"shape": [8192, 32], "dtype": "int8",
                                        "scales": "<b64 f32>", "data": "<b64 i8>"}}}

**Row-wise int8.** Every tensor is quantised per row, ``scale = max|w| / 127``.
A single scale for the whole embedding table would be set by whichever n-gram
happened to grow the largest vector and would flatten thousands of rarer rows to
zero; per-row scales cost four bytes a row and keep them intact. The trainer
evaluates the model *after* a quantisation round-trip, so the accuracy printed at
the end of training is the accuracy of the file that actually ships.

``dtype: "f32"`` is available for exact round-trips when debugging; it is roughly
four times larger and is not what gets committed.
"""
from __future__ import annotations

import base64
import json
import zlib
from array import array

FORMAT = "strata-nn/1"
_INT8_MAX = 127.0


def _encode_rows(rows: list[list[float]], dtype: str) -> dict:
    n_rows = len(rows)
    n_cols = len(rows[0]) if n_rows else 0

    if dtype == "f32":
        flat = array("f", [v for row in rows for v in row])
        if flat.itemsize != 4:
            raise RuntimeError("unexpected float size on this platform")
        payload = flat.tobytes()
        return {"shape": [n_rows, n_cols], "dtype": "f32",
                "data": base64.b64encode(zlib.compress(payload, 9)).decode()}

    q = array("b")
    scales = array("f")
    for row in rows:
        peak = 0.0
        for v in row:
            av = v if v >= 0.0 else -v
            if av > peak:
                peak = av
        s = peak / _INT8_MAX if peak > 0.0 else 1.0
        scales.append(s)
        inv = 1.0 / s
        for v in row:
            qi = int(round(v * inv))
            q.append(127 if qi > 127 else (-127 if qi < -127 else qi))

    return {"shape": [n_rows, n_cols], "dtype": "int8",
            "scales": base64.b64encode(zlib.compress(scales.tobytes(), 9)).decode(),
            "data": base64.b64encode(zlib.compress(q.tobytes(), 9)).decode()}


def _decode_rows(spec: dict) -> list[list[float]]:
    n_rows, n_cols = spec["shape"]
    raw = zlib.decompress(base64.b64decode(spec["data"]))

    if spec["dtype"] == "f32":
        flat = array("f")
        flat.frombytes(raw)
        return [list(flat[i * n_cols:(i + 1) * n_cols]) for i in range(n_rows)]

    q = array("b")
    q.frombytes(raw)
    scales = array("f")
    scales.frombytes(zlib.decompress(base64.b64decode(spec["scales"])))
    out = []
    for r in range(n_rows):
        s = scales[r]
        base = r * n_cols
        out.append([q[base + c] * s for c in range(n_cols)])
    return out


def quantize_roundtrip(rows: list[list[float]]) -> list[list[float]]:
    """Apply the shipped quantisation without writing a file.

    The trainer uses this to score the model exactly as it will be served.
    """
    return _decode_rows(_encode_rows(rows, "int8"))


def save(path: str, *, kind: str, config: dict, labels: list[str],
         tensors: dict[str, list[list[float]]], meta: dict | None = None,
         dtype: str = "int8") -> None:
    doc = {
        "format": FORMAT,
        "kind": kind,
        "config": config,
        "labels": labels,
        "meta": meta or {},
        "tensors": {name: _encode_rows(rows, dtype) for name, rows in tensors.items()},
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, sort_keys=True)
        fh.write("\n")


def load(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    if doc.get("format") != FORMAT:
        raise ValueError(f"{path}: unsupported checkpoint format {doc.get('format')!r}")
    doc["tensors"] = {name: _decode_rows(spec) for name, spec in doc["tensors"].items()}
    return doc
