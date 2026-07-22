"""Tokenisation and hashed feature extraction for the Strata networks.

Design notes, because the choices here are load-bearing:

**Stable hashing.** Python's builtin ``hash`` is salted per process, so a model
trained in one run would be gibberish in the next. Features are hashed with
CRC32 instead — deterministic across processes, machines and Python versions,
and implemented in C so it costs nothing.

**No vocabulary file.** The hashing trick maps any n-gram into a fixed bucket
range, so the weight file has no vocabulary to ship or drift. Collisions are
real but harmless at this scale; the embedding simply learns the mixture.

**Spans are carried through.** Every emitted feature remembers the character
range of the text it came from. That is what lets attention weights be turned
back into highlighted phrases in the UI — a label Strata cannot point at is a
label Strata will not show.

**Number canonicalisation.** ``n = 11,321`` and ``n = 4,902`` should share a
feature; the magnitude matters, the exact digits do not. Numbers collapse to
order-of-magnitude buckets (``<num4>`` for four digits), which keeps "large
trial" and "small trial" separable without memorising sample sizes.
"""
from __future__ import annotations

import re
import zlib
from dataclasses import dataclass

# Feature-space size. 2^13 buckets against a working vocabulary of a few tens of
# thousands of clinical n-grams: enough that high-signal terms rarely collide,
# small enough that the shipped weight file stays under a megabyte.
N_BUCKETS = 1 << 13

_TOKEN_RE = re.compile(r"[a-z]+(?:-[a-z]+)*|\d+(?:\.\d+)?|[%<>=≤≥]")
_WS = re.compile(r"\s+")

# Structured-abstract headings are among the most informative tokens available:
# text under METHODS reads very differently from text under CONCLUSIONS. A heading
# is marked in the token string only — never by rewriting the source — because the
# character offsets have to keep pointing at the text the user will see highlighted.
_SECTION_WORDS = frozenset("""
background objective objectives aim aims purpose introduction method methods
methodology design setting participants patients intervention interventions
outcome outcomes result results finding findings conclusion conclusions
interpretation discussion limitation limitations
""".split())


def _bucket(token: str) -> int:
    return zlib.crc32(token.encode("utf-8")) % N_BUCKETS


def _canon_number(tok: str) -> str:
    """Collapse a number to its order of magnitude: 11321 -> '<num5>'."""
    digits = tok.split(".")[0]
    return f"<num{min(len(digits), 7)}>"


@dataclass(frozen=True)
class Feature:
    """One hashed n-gram plus the character span it came from."""
    bucket: int
    start: int
    end: int
    text: str


def tokenize(text: str) -> list[tuple[str, int, int]]:
    """Lowercase tokens as (token, start, end) character offsets.

    Offsets always index the *original* string, so a caller can slice the text a
    token came from. A structured-abstract heading — a section word followed by a
    colon — is emitted as ``§methods`` rather than ``methods``; only the token
    string changes, the span still covers the bare word.
    """
    lowered = text.lower()
    n = len(lowered)
    out = []
    for m in _TOKEN_RE.finditer(lowered):
        tok = m.group(0)
        if tok[0].isdigit():
            tok = _canon_number(tok)
        elif tok in _SECTION_WORDS:
            j = m.end()
            while j < n and lowered[j] == " ":
                j += 1
            if j < n and lowered[j] == ":":
                tok = "§" + tok
        out.append((tok, m.start(), m.end()))
    return out


class Vectorizer:
    """Turns text into a bounded sequence of hashed, span-tagged features.

    The sequence is unigrams followed by bigrams. Both are capped: an abstract is
    truncated rather than allowed to dominate the attention budget, and the cap is
    generous enough to cover a full structured abstract's methods and results.
    """

    def __init__(self, max_unigrams: int = 128, max_bigrams: int = 96,
                 n_buckets: int = N_BUCKETS):
        self.max_unigrams = max_unigrams
        self.max_bigrams = max_bigrams
        self.n_buckets = n_buckets

    # -- serialisation ------------------------------------------------------
    def config(self) -> dict:
        return {"max_unigrams": self.max_unigrams, "max_bigrams": self.max_bigrams,
                "n_buckets": self.n_buckets}

    @classmethod
    def from_config(cls, cfg: dict) -> "Vectorizer":
        return cls(max_unigrams=cfg.get("max_unigrams", 128),
                   max_bigrams=cfg.get("max_bigrams", 96),
                   n_buckets=cfg.get("n_buckets", N_BUCKETS))

    # -- extraction ---------------------------------------------------------
    def features(self, text: str) -> list[Feature]:
        toks = tokenize(text or "")
        if not toks:
            return []

        feats: list[Feature] = []
        for tok, s, e in toks[: self.max_unigrams]:
            feats.append(Feature(_bucket(tok), s, e, tok))

        window = toks[: self.max_unigrams + 1]
        for i in range(min(len(window) - 1, self.max_bigrams)):
            a, s, _ = window[i]
            b, _, e = window[i + 1]
            feats.append(Feature(_bucket(a + "_" + b), s, e, f"{a} {b}"))
        return feats

    def buckets(self, text: str) -> list[int]:
        """Just the hashed ids — the hot path when spans aren't needed."""
        return [f.bucket for f in self.features(text)]


def clean(text: str) -> str:
    """Collapse whitespace; abstracts arrive from XML with ragged spacing."""
    return _WS.sub(" ", (text or "").replace(" ", " ")).strip()


def merge_spans(spans: list[tuple[int, int]], gap: int = 2) -> list[tuple[int, int]]:
    """Merge overlapping or near-touching character ranges.

    Attention lands on several adjacent n-grams at once ("double", "blind",
    "double blind"); merging turns that into one highlight instead of three.
    """
    if not spans:
        return []
    spans = sorted(spans)
    out = [list(spans[0])]
    for s, e in spans[1:]:
        if s - out[-1][1] <= gap:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(s, e) for s, e in out]
