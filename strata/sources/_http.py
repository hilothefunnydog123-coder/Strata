"""Shared HTTP for source adapters — reuses Strata's TLS-hardened context.

The same operating-system trust-store handling that keeps PubMed working behind
a school or corporate proxy is reused here, so every source degrades the same
predictable way on a managed network.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict

from ..pubmed import UA, _ssl_context

TIMEOUT = 30


def get(url: str, params: Dict[str, Any] | None = None, *, headers: Dict[str, str] | None = None,
        timeout: int = TIMEOUT) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as r:
        return r.read()


def get_json(url: str, params: Dict[str, Any] | None = None, **kw) -> Any:
    return json.loads(get(url, params, **kw).decode("utf-8", "replace"))
