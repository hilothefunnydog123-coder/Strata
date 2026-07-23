"""`strata serve` — the Strata web app + the Verify API, standard library only.

Web surfaces
    /            Landing page (what Strata is)
    /app         Verify + Monitor demo (paste a claim → Evidence Receipt)
    /console     Strata Monitor console (therapeutic-area / living-review view)
    /lite        Strata Lite (ask one question)

Verify API (v1)
    GET/POST /v1/verify            {claim}      → Evidence Receipt
    GET      /v1/receipt/<id>                   → a monitored claim's latest receipt
    GET      /v1/monitor                         → list monitored claims
    GET      /v1/monitor/register?claim=&tenant= → register + first check
    GET      /v1/monitor/check?id=               → re-check, return receipt + change feed
    GET      /v1/monitor/get?id=                 → current receipt + history
    GET      /v1/seal/<id>.svg                    → public 'Evidence Verified' badge
    GET      /v1/health

Auth: if ``STRATA_API_KEYS`` (comma-separated) is set, API calls require a matching key via
``Authorization: Bearer <key>``, ``X-API-Key: <key>``, or ``?key=``. If unset, the API is
open (the self-host default). The Seal badge is always public. No patient data is handled.
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import demo, monitor, review, verify
from .pages import CONSOLE_HTML, LITE_HTML
from .pages_web import LANDING_HTML, VERIFY_DEMO_HTML
from .query import ask
from .receipt import Receipt, seal_svg

_LEVEL_COLOR = {1: "#16a34a", 2: "#22a06b", 3: "#d97706",
                4: "#ea580c", 5: "#dc2626", 6: "#9ca3af"}
_VERSION = "0.3.0"
_DEMO_REVIEW = {t["id"]: t for t in demo._TOPICS}
_DEMO_CLAIM = {c["id"]: c for c in demo._CLAIMS}


def _tenant() -> str:
    return os.environ.get("STRATA_TENANT", "Meridian Health (demo)")


def _first_sentences(text, n=2):
    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return " ".join(parts[:n]).strip()


def _ask_payload(result) -> dict:
    sources = [{
        "n": i, "title": e.article.title, "year": e.article.year, "url": e.article.url,
        "study_type": e.grade.label, "strength": e.grade.strength, "level": e.grade.level,
        "sample_size": e.grade.sample_size,
        "snippet": _first_sentences(e.article.abstract) or "(no abstract)",
        "color": _LEVEL_COLOR[e.grade.level],
    } for i, e in enumerate(result.evidence, 1)]
    return {"question": result.question, "overall_strength": result.body.overall_strength,
            "summary": result.body.summary, "sources": sources}


def _run_review(rid: str) -> dict | None:
    t = _DEMO_REVIEW.get(rid)
    if t is not None:
        review.sync(rid, current_year=2026, _search=lambda q, retmax=60, _d=t["data"]: list(_d))
    else:
        review.sync(rid)
    return review.view(rid)


def _check_claim(cid: str):
    c = _DEMO_CLAIM.get(cid)
    if c is not None:
        return monitor.check(cid, _search=lambda q, retmax=40, _d=c["data"]: list(_d))
    return monitor.check(cid)


_DEMO_CLAIM_BY_TEXT = {verify.normalize(c["claim"]): c for c in demo._CLAIMS}


def _verify_claim(claim: str):
    """Verify a claim. Seeded example claims resolve offline (so the hosted demo works with
    no network); everything else hits live PubMed."""
    c = _DEMO_CLAIM_BY_TEXT.get(verify.normalize(claim))
    if c is not None:
        return verify.verify_claim(claim, current_year=2026,
                                   _search=lambda q, retmax=40, _d=c["data"]: list(_d))
    return verify.verify_claim(claim)


def _handler():
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        # ---- io helpers ----
        def _send(self, body: bytes, ctype: str, code=200):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "authorization,content-type,x-api-key")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, code=200):
            self._send(json.dumps(obj).encode(), "application/json", code)

        def _html(self, s):
            self._send(s.encode(), "text/html; charset=utf-8")

        def _body_json(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if not n:
                return {}
            try:
                return json.loads(self.rfile.read(n) or b"{}")
            except json.JSONDecodeError:
                return {}

        def _authorized(self, q) -> bool:
            configured = set(filter(None, (os.environ.get("STRATA_API_KEYS", "")).split(",")))
            if not configured:
                return True                     # open (self-host default)
            auth = self.headers.get("Authorization", "")
            provided = (auth[7:] if auth.lower().startswith("bearer ") else
                        self.headers.get("X-API-Key") or (q.get("key") or [""])[0])
            return provided in configured

        # ---- dispatch ----
        def do_OPTIONS(self):
            self._send(b"", "text/plain")

        def do_POST(self):
            self._route()

        def do_GET(self):
            self._route()

        def _route(self):
            u = urllib.parse.urlparse(self.path)
            path = u.path.rstrip("/") or "/"
            q = urllib.parse.parse_qs(u.query)
            try:
                # -------- public web pages --------
                if path == "/":
                    return self._html(LANDING_HTML)
                if path in ("/app", "/demo", "/verify"):
                    return self._html(VERIFY_DEMO_HTML)
                if path == "/console":
                    return self._html(CONSOLE_HTML)
                if path == "/lite":
                    return self._html(LITE_HTML)

                # -------- public: health + seal badge --------
                if path == "/v1/health":
                    return self._json({"status": "ok", "version": _VERSION,
                                       "auth": bool(os.environ.get("STRATA_API_KEYS"))})
                m = re.match(r"^/v1/seal/([A-Za-z0-9\-_]+)(?:\.svg)?$", path)
                seal_id = m.group(1) if m else (q.get("id") or [None])[0] if path == "/v1/seal" else None
                if seal_id:
                    r = monitor.get_receipt(seal_id)
                    if not r:
                        return self._json({"error": "no receipt for id"}, 404)
                    return self._send(seal_svg(r).encode(), "image/svg+xml")

                # -------- console/lite demo endpoints (open) --------
                if path == "/api/ask":
                    question = (q.get("q") or [""])[0].strip()
                    if not question:
                        return self._json({"error": "empty question"}, 400)
                    return self._json(_ask_payload(ask(question, k=int((q.get("k") or ["8"])[0]))))
                if path == "/api/reviews":
                    return self._json({"tenant": _tenant(), "reviews": review.list_reviews()})
                if path == "/api/review":
                    v = review.view((q.get("id") or [""])[0])
                    return self._json(v) if v else self._json({"error": "no such review"}, 404)
                if path == "/api/review/run":
                    v = _run_review((q.get("id") or [""])[0])
                    return self._json(v) if v else self._json({"error": "no such review"}, 404)

                # -------- Verify API (auth) --------
                if not self._authorized(q):
                    return self._json({"error": "unauthorized — supply a valid API key"}, 401)

                if path == "/v1/verify":
                    body = self._body_json() if self.command == "POST" else {}
                    claim = (body.get("claim") or (q.get("claim") or [""])[0]).strip()
                    if not claim:
                        return self._json({"error": "missing 'claim'"}, 400)
                    return self._json(_verify_claim(claim).to_dict())

                rm = re.match(r"^/v1/receipt/([A-Za-z0-9\-_]+)$", path)
                if rm or path == "/v1/receipt":
                    rid = rm.group(1) if rm else (q.get("id") or [""])[0]
                    r = monitor.get_receipt(rid)
                    return self._json(r.to_dict()) if r else self._json({"error": "not found"}, 404)

                if path == "/v1/monitor":
                    return self._json({"tenant": _tenant(), "claims": monitor.list_claims()})
                if path == "/v1/monitor/register":
                    body = self._body_json() if self.command == "POST" else {}
                    claim = (body.get("claim") or (q.get("claim") or [""])[0]).strip()
                    if not claim:
                        return self._json({"error": "missing 'claim'"}, 400)
                    tenant = (body.get("tenant") or (q.get("tenant") or [_tenant()])[0])
                    p = monitor.register(claim, tenant=tenant)
                    rd, ch = monitor.check(p["id"])
                    return self._json({"id": p["id"], "receipt": rd, "change": ch})
                if path == "/v1/monitor/check":
                    cid = (q.get("id") or [""])[0]
                    try:
                        rd, ch = _check_claim(cid)
                    except KeyError:
                        return self._json({"error": "no such claim"}, 404)
                    return self._json({"id": cid, "receipt": rd, "change": ch})
                if path == "/v1/monitor/get":
                    v = monitor.view((q.get("id") or [""])[0])
                    return self._json(v) if v else self._json({"error": "no such claim"}, 404)

                return self._json({"error": f"not found: {path}"}, 404)
            except Exception as exc:                          # keep the dev server alive
                self._json({"error": str(exc)}, 500)

    return H


def serve(port: int = 8600, *, host: str = "127.0.0.1", demo_seed: bool = True) -> None:
    if demo_seed:
        demo.ensure_seeded()
    httpd = ThreadingHTTPServer((host, port), _handler())
    shown = "127.0.0.1" if host in ("127.0.0.1", "0.0.0.0") else host
    base = f"http://{shown}:{port}"
    print(f"Strata  →  {base}/            (landing)")
    print(f"        →  {base}/app         (Verify + Monitor demo)")
    print(f"        →  {base}/console     (Monitor console)   ·   /lite")
    print(f"        →  {base}/v1/verify   (API — POST {{\"claim\": \"...\"}})")
    if os.environ.get("STRATA_API_KEYS"):
        print("        API key required (STRATA_API_KEYS is set).")
    print("(ctrl-c to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
