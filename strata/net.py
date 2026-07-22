"""HTTP transport for the NCBI E-utilities API.

Standard library only. What this adds over a bare ``urlopen``:

**Rate limiting that respects NCBI's terms.** Three requests a second without an
API key, ten with one. The limiter is process-wide and thread-safe, because
``strata serve`` handles requests concurrently and a burst from four browser tabs
is exactly how an IP gets blocked.

**Retries with backoff and jitter.** E-utilities returns 429 and 5xx under load.
Retrying immediately makes that worse; the backoff is exponential with jitter so
concurrent callers do not synchronise into a second thundering herd.

**TLS that works on managed machines.** School and corporate networks intercept
HTTPS with their own root certificate. The context trusts the operating system's
certificate store, which usually resolves it, with an explicit bundle and a
last-resort opt-out available through environment variables.
"""
from __future__ import annotations

import os
import random
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "Strata/0.2 (clinical evidence engine; research use; +strata-evidence)"

_DEFAULT_TIMEOUT = 30
_MAX_ATTEMPTS = 4


class NetworkError(RuntimeError):
    """A request failed after retries, with an explanation fit to show a user."""


# --------------------------------------------------------------- rate limiting

class RateLimiter:
    """Minimum-interval limiter. Blocks the caller rather than dropping work."""

    def __init__(self, per_second: float):
        self._interval = 1.0 / per_second if per_second > 0 else 0.0
        self._lock = threading.Lock()
        self._next = 0.0

    def acquire(self) -> None:
        if self._interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            wait = self._next - now
            if wait > 0:
                time.sleep(wait)
                now = time.monotonic()
            self._next = max(now, self._next) + self._interval

    def set_rate(self, per_second: float) -> None:
        with self._lock:
            self._interval = 1.0 / per_second if per_second > 0 else 0.0


_limiter = RateLimiter(3.0)
_limiter_configured = False
_limiter_lock = threading.Lock()


def _ensure_limiter() -> None:
    """NCBI allows 10 requests/second with a key, 3 without."""
    global _limiter_configured
    with _limiter_lock:
        if not _limiter_configured:
            _limiter.set_rate(10.0 if os.environ.get("NCBI_API_KEY") else 3.0)
            _limiter_configured = True


# ------------------------------------------------------------------------ TLS

def ssl_context() -> ssl.SSLContext:
    """A verifying context that also trusts the OS certificate store.

    On managed Windows and macOS machines this picks up the corporate or school
    root certificate a proxy uses to intercept HTTPS — the usual cause of
    ``CERTIFICATE_VERIFY_FAILED``. ``STRATA_CA_BUNDLE`` overrides with an
    explicit PEM file.
    """
    bundle = os.environ.get("STRATA_CA_BUNDLE")
    ctx = ssl.create_default_context(cafile=bundle) if bundle else ssl.create_default_context()
    try:
        ctx.load_default_certs(ssl.Purpose.SERVER_AUTH)
    except Exception:
        pass
    return ctx


def _insecure_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


_warned_insecure = False


def _maybe_insecure(exc: Exception):
    """Honour ``STRATA_INSECURE=1`` for certificate failures only.

    Deliberately narrow: it applies to a certificate-verification error and
    nothing else, warns once, and stays off by default. The data being read is
    public bibliographic metadata, but a blanket disable would also mask a real
    interception on a network the user does not trust.
    """
    global _warned_insecure
    if os.environ.get("STRATA_INSECURE") != "1":
        return None
    reason = getattr(exc, "reason", None)
    if not isinstance(reason, ssl.SSLCertVerificationError) and \
            not isinstance(exc, ssl.SSLCertVerificationError):
        return None
    if not _warned_insecure:
        print("strata: STRATA_INSECURE=1 — TLS verification disabled for this "
              "session (only safe on a network you trust).", file=sys.stderr)
        _warned_insecure = True
    return _insecure_context()


# ---------------------------------------------------------------- the request

def get(url: str, *, timeout: int = _DEFAULT_TIMEOUT,
        attempts: int = _MAX_ATTEMPTS, rate_limit: bool = True) -> bytes:
    """GET a URL, retrying transient failures. Raises :class:`NetworkError`."""
    if os.environ.get("STRATA_OFFLINE") == "1":
        raise NetworkError(
            "STRATA_OFFLINE=1 is set and this result is not in the cache.")

    _ensure_limiter()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    context = ssl_context()
    last: Exception | None = None

    for attempt in range(attempts):
        if rate_limit:
            _limiter.acquire()
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=context) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            last = exc
            # 429 and 5xx are worth retrying; 400 and 404 never are.
            if exc.code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                raise NetworkError(_explain(exc)) from exc
        except urllib.error.URLError as exc:
            last = exc
            fallback = _maybe_insecure(exc)
            if fallback is not None:
                context = fallback
                continue
            if attempt == attempts - 1:
                raise NetworkError(_explain(exc)) from exc
        except (TimeoutError, OSError) as exc:
            last = exc
            if attempt == attempts - 1:
                raise NetworkError(_explain(exc)) from exc

        # exponential backoff with jitter
        time.sleep(min(8.0, 0.6 * (2 ** attempt)) * (0.5 + random.random()))

    raise NetworkError(_explain(last) if last else "request failed")


def _explain(exc: Exception | None) -> str:
    """Turn a transport failure into something a clinician can act on."""
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code == 429:
            return ("PubMed is rate-limiting this connection. Wait a moment, or "
                    "set NCBI_API_KEY to raise the limit to 10 requests/second.")
        if 500 <= exc.code < 600:
            return f"PubMed returned a server error ({exc.code}). Try again shortly."
        return f"PubMed rejected the request ({exc.code} {exc.reason})."

    reason = getattr(exc, "reason", exc)
    if isinstance(reason, ssl.SSLCertVerificationError) or \
            isinstance(exc, ssl.SSLCertVerificationError):
        return ("The HTTPS certificate could not be verified — this network is "
                "probably intercepting TLS with its own root certificate. Run on "
                "a normal network, point STRATA_CA_BUNDLE at your organisation's "
                "PEM file, or as a last resort on a network you trust set "
                "STRATA_INSECURE=1.")
    if isinstance(reason, TimeoutError) or isinstance(exc, TimeoutError):
        return "PubMed did not respond in time. Check the connection and retry."
    return f"Could not reach PubMed: {reason}"


def build_url(base: str, endpoint: str, params: dict) -> str:
    """URL with the API key folded in when one is configured."""
    params = dict(params)
    key = os.environ.get("NCBI_API_KEY")
    if key:
        params["api_key"] = key
    tool = os.environ.get("NCBI_TOOL", "strata")
    params.setdefault("tool", tool)
    email = os.environ.get("NCBI_EMAIL")
    if email:
        params.setdefault("email", email)
    return f"{base}/{endpoint}?{urllib.parse.urlencode(params)}"


def redact(url: str) -> str:
    """A URL safe to print or log — the API key is a secret."""
    return urllib.parse.urlunparse(
        urllib.parse.urlparse(url)._replace(query="&".join(
            f"{k}={'***' if k == 'api_key' else v}"
            for k, v in urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))))
