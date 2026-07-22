"""An on-disk cache for PubMed responses.

Two reasons this exists, and neither is speed for its own sake.

The first is courtesy. NCBI runs E-utilities for free and asks callers not to
hammer it. Re-asking the same clinical question three times while tuning a query
should cost one round trip, not three.

The second is reproducibility. An evidence answer that silently changes between
two runs is not much use to someone writing it into a note. With the cache warm,
the same question returns the same papers until the entry expires.

Bibliographic metadata only — titles, abstracts, journal names, publication
types. No patient data goes near this, because none ever enters the program.
Entries expire after a fortnight by default; ``strata cache clear`` removes them.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import time

DEFAULT_TTL = 14 * 24 * 3600         # a fortnight
_SCHEMA = 1


def cache_dir() -> str:
    """Where entries live. Honours ``STRATA_CACHE_DIR``, then the platform norm."""
    override = os.environ.get("STRATA_CACHE_DIR")
    if override:
        return override
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(base, "strata", "cache")
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(
        os.path.expanduser("~"), ".cache")
    return os.path.join(base, "strata")


def enabled() -> bool:
    return os.environ.get("STRATA_NO_CACHE") != "1"


def _key(url: str) -> str:
    return hashlib.sha256(f"{_SCHEMA}:{url}".encode("utf-8")).hexdigest()[:40]


def _path(url: str) -> str:
    k = _key(url)
    # One level of fan-out: a busy cache can hold thousands of entries, and some
    # filesystems slow down badly on a single directory that large.
    return os.path.join(cache_dir(), k[:2], k + ".json")


def get(url: str, *, ttl: int = DEFAULT_TTL) -> bytes | None:
    """The cached body for a URL, or None if absent, stale or unreadable."""
    if not enabled():
        return None
    path = _path(url)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            entry = json.load(fh)
    except (OSError, ValueError):
        return None
    if time.time() - entry.get("stored", 0) > ttl:
        return None
    body = entry.get("body")
    if not isinstance(body, str):
        return None
    try:
        return bytes.fromhex(body)
    except ValueError:
        return None


def put(url: str, body: bytes) -> None:
    """Store a response. Failures are swallowed — a cache miss is not an error."""
    if not enabled():
        return
    path = _path(url)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # Written to a temporary file and renamed, so a crash mid-write cannot
        # leave a half-written entry that later parses as valid.
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump({"stored": time.time(), "body": body.hex()}, fh)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    except OSError:
        pass


def stats() -> dict:
    """Entry count and total size, for ``strata cache info``."""
    root = cache_dir()
    n = total = 0
    oldest = None
    for dirpath, _, files in os.walk(root):
        for name in files:
            if not name.endswith(".json"):
                continue
            try:
                st = os.stat(os.path.join(dirpath, name))
            except OSError:
                continue
            n += 1
            total += st.st_size
            oldest = st.st_mtime if oldest is None else min(oldest, st.st_mtime)
    return {"path": root, "entries": n, "bytes": total,
            "oldest_age_days": round((time.time() - oldest) / 86400, 1) if oldest else None}


def clear() -> int:
    """Delete every entry. Returns how many were removed."""
    root = cache_dir()
    n = stats()["entries"]
    if os.path.isdir(root):
        shutil.rmtree(root, ignore_errors=True)
    return n


def prune(ttl: int = DEFAULT_TTL) -> int:
    """Remove expired entries only. Returns how many were removed."""
    root = cache_dir()
    cutoff = time.time() - ttl
    removed = 0
    for dirpath, _, files in os.walk(root):
        for name in files:
            path = os.path.join(dirpath, name)
            try:
                if os.stat(path).st_mtime < cutoff:
                    os.unlink(path)
                    removed += 1
            except OSError:
                continue
    return removed
