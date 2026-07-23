"""Smoke tests for the web surfaces — every route returns HTML with its key content.
Runs a live localhost server, fully offline. Run: python tests/test_pages.py
"""
import os
import sys
import tempfile
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["STRATA_HOME"] = tempfile.mkdtemp(prefix="strata-pages-")
for k in ("STRATA_LLM_KEY", "GROQ_API_KEY", "STRATA_API_KEYS"):
    os.environ.pop(k, None)

from http.server import ThreadingHTTPServer                        # noqa: E402
from strata import server, demo                                   # noqa: E402

_PORT = 8794
_ROUTES = {
    "/": "when it matters",
    "/app": "backed by evidence",
    "/console": "Evidence Health",
    "/graph": "Evidence Graph",
    "/search": "Live evidence search",
    "/why": "update periodically",
    "/pricing": "300k",
    "/trust": "Not yet audited",
    "/security": "first-class feature",
    "/docs": "Quickstart",
    "/platform": "inside your walls",
    "/lite": "Strata",
}


def _boot():
    demo.seed_all(force=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", _PORT), server._handler())
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.5)
    return httpd


def test_all_routes_render():
    for path, marker in _ROUTES.items():
        body = urllib.request.urlopen(f"http://127.0.0.1:{_PORT}{path}", timeout=15).read().decode()
        assert "<html" in body.lower(), f"{path} is not HTML"
        assert len(body) > 3000, f"{path} suspiciously short"
        assert marker in body, f"{path} missing expected content {marker!r}"
    print(f"ok  all {len(_ROUTES)} web routes render with their key content")


def test_no_false_compliance_claims():
    """The Trust page must never assert an uncertified compliance status as fact."""
    trust = urllib.request.urlopen(f"http://127.0.0.1:{_PORT}/trust", timeout=15).read().decode()
    assert "Not yet audited" in trust and "No HIPAA claim today" in trust
    # honesty guard: no POSITIVE certification claim (negations like "not SOC 2 certified" are fine)
    low = trust.lower()
    for positive in ("is soc 2 certified", "are soc 2 certified", "we are hipaa compliant",
                     "fda cleared", "fda clearance obtained", "hipaa compliant.", "gxp validated"):
        assert positive not in low, f"false compliance claim: {positive!r}"
    assert "not soc 2 certified" in low             # the honest negation is present
    print("ok  Trust page is honest — no false SOC 2 / HIPAA / FDA claims")


if __name__ == "__main__":
    _boot()
    test_all_routes_render()
    test_no_false_compliance_claims()
    print("\nall page tests passed")
