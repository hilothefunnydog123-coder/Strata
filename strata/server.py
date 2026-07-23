"""`strata serve` — the Strata web app + the Verify API, standard library only.

Web:   /  landing   /app  Verify+Compare demo   /platform  self-host platform
       /console  Monitor console   /lite  ask one question

API (v1):
    GET/POST /v1/verify            {claim, cohort?}     Evidence Receipt
    POST     /v1/compare           {claim_a, claim_b}   which claim has stronger evidence
    GET      /v1/receipt/<id>                            a monitored claim's latest receipt
    GET      /v1/monitor (+ /register /check /get)       continuous claim watching
    POST     /v1/keys                                    generate a working API key
    GET      /v1/keys  ·  GET /v1/keys/revoke?id=        list / revoke keys
    POST     /v1/cohort  ·  GET /v1/cohort               import a population profile (local)
    GET      /v1/seal/<id>.svg                            public trust badge
    POST     /v1/demo-request                             email a demo request
    GET      /v1/sources  ·  GET /v1/health

Auth: a generated key (Authorization: Bearer / X-API-Key / ?key=) always authorizes. If
``STRATA_API_KEYS`` is set, only listed or generated keys pass; if unset, the API is open
(self-host default). Key creation is gated by ``STRATA_ADMIN_KEY`` when set. No patient data
is handled by the hosted API; cohort import runs locally only.
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import cohort, demo, keys, models, monitor, pipeline, review, sources, verify
from .console_page import CONSOLE_HTML
from .pages import LITE_HTML
from .pages_web import LANDING_HTML, PLATFORM_HTML, VERIFY_DEMO_HTML
from .query import ask
from .receipt import seal_svg

_LEVEL_COLOR = {1: "#16a34a", 2: "#22a06b", 3: "#d97706", 4: "#ea580c", 5: "#dc2626", 6: "#9ca3af"}
_VERSION = "0.5.1"
_DEMO_EMAIL = "dlake003@gmail.com"
_DEMO_REVIEW = {t["id"]: t for t in demo._TOPICS}
_DEMO_CLAIM = {c["id"]: c for c in demo._CLAIMS}
_DEMO_CLAIM_BY_TEXT = {verify.normalize(c["claim"]): c for c in demo._CLAIMS}
_DEMO_CLAIM_BY_TEXT.update({          # question phrasings used by the Console resolve offline too
    verify.normalize("Do SGLT2 inhibitors reduce heart-failure hospitalization"): _DEMO_CLAIM["clm-sglt2-hf"],
    verify.normalize("Does metformin reduce cardiovascular mortality in type 2 diabetes"): _DEMO_CLAIM["clm-metformin-cvd"],
    verify.normalize("Does vitamin D supplementation reduce acute respiratory infections"): _DEMO_CLAIM["clm-vitd-ari"],
    verify.normalize("Does intermittent fasting reduce cardiovascular mortality"): _DEMO_CLAIM["clm-fasting-cvd"],
})


def _tenant() -> str:
    return os.environ.get("STRATA_TENANT", "Meridian Health (demo)")


def _first_sentences(text, n=2):
    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return " ".join(parts[:n]).strip()


def _ask_payload(result) -> dict:
    sources_ = [{
        "n": i, "title": e.article.title, "year": e.article.year, "url": e.article.url,
        "study_type": e.grade.label, "strength": e.grade.strength, "level": e.grade.level,
        "sample_size": e.grade.sample_size,
        "snippet": _first_sentences(e.article.abstract) or "(no abstract)",
        "color": _LEVEL_COLOR[e.grade.level]} for i, e in enumerate(result.evidence, 1)]
    return {"question": result.question, "overall_strength": result.body.overall_strength,
            "summary": result.body.summary, "sources": sources_}


def _run_review(rid: str):
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


def _demo_search(claim: str):
    """Return an offline search fn + fixed year for a seeded claim, else (None, None) for live."""
    c = _DEMO_CLAIM_BY_TEXT.get(verify.normalize(claim))
    if c is not None:
        return (lambda q, retmax=40, _d=c["data"]: list(_d)), 2026
    return None, None


def _verify_claim(claim: str, context=None, pico=None):
    """Seeded example claims verify offline; everything else hits the live multi-source search."""
    search, yr = _demo_search(claim)
    return verify.verify_claim(claim, context=context, pico=pico, current_year=yr, _search=search)


def _compare(claim_a: str, claim_b: str) -> dict:
    ra, rb = _verify_claim(claim_a), _verify_claim(claim_b)
    sa, sb = verify._score(ra), verify._score(rb)
    if abs(sa - sb) < 0.4:
        winner, rationale = "tie", "Both claims have comparably strong (or weak) evidence behind them."
    else:
        winner = "a" if sa > sb else "b"
        strong, weak = (ra, rb) if winner == "a" else (rb, ra)
        rationale = (f'"{verify._short(strong.claim)}" has the stronger evidence base '
                     f"({strong.status}, {strong.strength}, {strong.supporting} supporting) versus "
                     f"({weak.status}, {weak.strength}, {weak.supporting} supporting).")
    return {"claim_a": claim_a, "claim_b": claim_b, "a": ra.to_dict(), "b": rb.to_dict(),
            "winner": winner, "rationale": rationale}


def _email_demo_request(payload: dict) -> bool:
    """Append the request locally and email it to the founder when SMTP is configured."""
    try:
        with open(store_home() / "demo_requests.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass
    host = os.environ.get("STRATA_SMTP_HOST")
    if not host:
        return False
    try:
        import smtplib
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["Subject"] = f"[Strata] Demo request from {payload.get('name') or payload.get('email')}"
        msg["From"] = os.environ.get("STRATA_SMTP_FROM", payload.get("email", "noreply@strata"))
        msg["To"] = _DEMO_EMAIL
        msg.set_content("\n".join(f"{k}: {v}" for k, v in payload.items()))
        with smtplib.SMTP(host, int(os.environ.get("STRATA_SMTP_PORT", "587"))) as s:
            s.starttls()
            if os.environ.get("STRATA_SMTP_USER"):
                s.login(os.environ["STRATA_SMTP_USER"], os.environ.get("STRATA_SMTP_PASS", ""))
            s.send_message(msg)
        return True
    except Exception:
        return False


def store_home():
    from . import store
    return store.home()


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DEMO_FIELDS = ("name", "email", "organization", "role", "company_size", "use_case")


def _validate_demo(b: dict) -> str | None:
    if not (b.get("name") or "").strip():
        return "name is required"
    email = (b.get("email") or "").strip()
    if not _EMAIL_RE.match(email):
        return "a valid work email is required"
    if not (b.get("organization") or "").strip():
        return "organization is required"
    return None


def _handler():
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, body: bytes, ctype: str, code=200):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "authorization,content-type,x-api-key,x-admin-key")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, code=200):
            self._send(json.dumps(obj).encode(), "application/json", code)

        def _html(self, s):
            self._send(s.encode(), "text/html; charset=utf-8")

        def _stream_verify(self, claim, ctx, pico):
            """Stream the pipeline stage-by-stage as newline-delimited JSON."""
            search, yr = _demo_search(claim)
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                for ev in pipeline.stream(claim, context=ctx, pico=pico, current_year=yr, _search=search):
                    out = {k: v for k, v in ev.items() if k != "_receipt"}
                    self.wfile.write((json.dumps(out) + "\n").encode())
                    self.wfile.flush()
            except Exception as exc:
                try:
                    self.wfile.write((json.dumps({"type": "error", "error": str(exc)}) + "\n").encode())
                except Exception:
                    pass

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if not n:
                return {}
            try:
                return json.loads(self.rfile.read(n) or b"{}")
            except json.JSONDecodeError:
                return {}

        def _provided_key(self, q):
            auth = self.headers.get("Authorization", "")
            return (auth[7:] if auth.lower().startswith("bearer ") else
                    self.headers.get("X-API-Key") or (q.get("key") or [""])[0])

        def _authorized(self, q) -> bool:
            key = self._provided_key(q)
            if key and keys.validate(key):
                return True                                  # a real generated key always passes
            configured = set(filter(None, (os.environ.get("STRATA_API_KEYS", "")).split(",")))
            if not configured:
                return True                                  # open self-host default
            return key in configured

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
                # ---- web pages (public) ----
                if path == "/":
                    return self._html(LANDING_HTML)
                if path in ("/app", "/demo", "/verify"):
                    return self._html(VERIFY_DEMO_HTML)
                if path == "/platform":
                    return self._html(PLATFORM_HTML)
                if path == "/console":
                    return self._html(CONSOLE_HTML)
                if path == "/lite":
                    return self._html(LITE_HTML)

                # ---- public API ----
                if path == "/v1/health":
                    return self._json({"status": "ok", "version": _VERSION,
                                       "sources": sources.enabled_sources(),
                                       "ai": models.available(),
                                       "auth": bool(os.environ.get("STRATA_API_KEYS"))})
                if path == "/v1/sources":
                    return self._json({"enabled": sources.enabled_sources(),
                                       "available": list(sources._SOURCES.keys())})
                if path == "/v1/models":
                    return self._json(models.status())
                m = re.match(r"^/v1/seal/([A-Za-z0-9\-_]+?)(?:\.svg)?$", path)
                seal_id = m.group(1) if m else ((q.get("id") or [None])[0] if path == "/v1/seal" else None)
                if seal_id:
                    r = monitor.get_receipt(seal_id)
                    if not r:
                        return self._json({"error": "no receipt for id"}, 404)
                    return self._send(seal_svg(r).encode(), "image/svg+xml")
                if path == "/v1/demo-request":
                    b = self._body()
                    err = _validate_demo(b)
                    if err:
                        return self._json({"error": err}, 400)
                    emailed = _email_demo_request({k: b.get(k) for k in _DEMO_FIELDS if b.get(k)}
                                                  | {"source": b.get("source", "web")})
                    return self._json({"ok": True, "emailed": emailed, "to": _DEMO_EMAIL})

                # ---- key creation (admin-gated if STRATA_ADMIN_KEY set) ----
                if path == "/v1/keys" and self.command == "POST":
                    admin = os.environ.get("STRATA_ADMIN_KEY")
                    if admin and (self.headers.get("X-Admin-Key") or (q.get("admin") or [""])[0]) != admin:
                        return self._json({"error": "admin key required to issue keys"}, 403)
                    b = self._body()
                    raw, rec = keys.generate(b.get("label") or (q.get("label") or ["default"])[0])
                    out = keys._redact(rec)
                    out["key"] = raw           # shown once
                    return self._json(out)

                # ---- console / lite demo endpoints (open) ----
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
                if path == "/api/review/new":
                    question = (q.get("q") or [""])[0].strip()
                    if not question:
                        return self._json({"error": "empty question"}, 400)
                    title = (q.get("title") or [question[:48]])[0].strip() or question[:48]
                    p = review.create(title, question, include_levels=(1, 2, 3))
                    review.sync(p.id)
                    return self._json(review.view(p.id))

                # ---- gated Verify API (authenticate -> rate limit -> log) ----
                _key = self._provided_key(q)
                _rec = keys.validate(_key) if _key else None
                _configured = set(filter(None, (os.environ.get("STRATA_API_KEYS", "")).split(",")))
                if _configured and _rec is None and _key not in _configured:
                    return self._json({"error": "unauthorized. Generate a key at /app or set STRATA_API_KEYS."}, 401)
                if _rec is not None:
                    _ok, _retry = keys.check_rate(_rec)
                    if not _ok:
                        return self._json({"error": "rate limit exceeded", "retry_after": _retry}, 429)
                    keys.log_request(_rec["id"], path, 200)

                if path == "/v1/keys":                       # GET list
                    return self._json({"keys": keys.list_keys()})
                if path == "/v1/keys/revoke":
                    return self._json({"revoked": keys.revoke((q.get("id") or [""])[0])})
                if path == "/v1/keys/rotate":
                    raw, rec = keys.rotate((q.get("id") or [""])[0])
                    return self._json({"key": raw, **(rec or {})}) if raw else self._json({"error": "no such key"}, 404)
                if path == "/v1/keys/logs":
                    return self._json({"logs": keys.get_logs((q.get("id") or [""])[0])})

                if path in ("/v1/verify", "/v1/verify/stream"):
                    b = self._body() if self.command == "POST" else {}
                    claim = (b.get("claim") or (q.get("claim") or [""])[0]).strip()
                    if not claim:
                        return self._json({"error": "missing 'claim'"}, 400)
                    cid = b.get("cohort") or (q.get("cohort") or [None])[0]
                    ctx = (cohort.get(cid) or {}).get("profile") if cid else None
                    pico = {k: b.get(k) for k in ("population", "intervention", "comparator", "outcome") if b.get(k)}
                    if path.endswith("/stream"):
                        return self._stream_verify(claim, ctx, pico or None)
                    return self._json(_verify_claim(claim, context=ctx, pico=pico or None).to_dict())
                if path == "/v1/verify/batch":
                    b = self._body()
                    claims = b.get("claims") or []
                    if not isinstance(claims, list) or not claims:
                        return self._json({"error": "provide 'claims' (a list)"}, 400)
                    if len(claims) > 25:
                        return self._json({"error": "batch limited to 25 claims"}, 400)
                    return self._json({"results": [_verify_claim(str(c)).to_dict() for c in claims]})

                if path == "/v1/compare":
                    b = self._body() if self.command == "POST" else {}
                    a = (b.get("claim_a") or (q.get("a") or [""])[0]).strip()
                    c = (b.get("claim_b") or (q.get("b") or [""])[0]).strip()
                    if not a or not c:
                        return self._json({"error": "need 'claim_a' and 'claim_b'"}, 400)
                    return self._json(_compare(a, c))

                rm = re.match(r"^/v1/receipt/([A-Za-z0-9\-_]+)$", path)
                if rm or path == "/v1/receipt":
                    rid = rm.group(1) if rm else (q.get("id") or [""])[0]
                    r = monitor.get_receipt(rid)
                    return self._json(r.to_dict()) if r else self._json({"error": "not found"}, 404)

                if path == "/v1/monitor":
                    return self._json({"tenant": _tenant(), "claims": monitor.list_claims()})
                if path == "/v1/monitor/register":
                    b = self._body() if self.command == "POST" else {}
                    claim = (b.get("claim") or (q.get("claim") or [""])[0]).strip()
                    if not claim:
                        return self._json({"error": "missing 'claim'"}, 400)
                    p = monitor.register(claim, tenant=(b.get("tenant") or (q.get("tenant") or [_tenant()])[0]))
                    rd, ch = monitor.check(p["id"])
                    return self._json({"id": p["id"], "receipt": rd, "change": ch})
                if path == "/v1/monitor/check":
                    try:
                        rd, ch = _check_claim((q.get("id") or [""])[0])
                    except KeyError:
                        return self._json({"error": "no such claim"}, 404)
                    return self._json({"id": (q.get("id") or [""])[0], "receipt": rd, "change": ch})
                if path == "/v1/monitor/get":
                    v = monitor.view((q.get("id") or [""])[0])
                    return self._json(v) if v else self._json({"error": "no such claim"}, 404)

                if path == "/v1/cohort":
                    if self.command == "POST":
                        b = self._body()
                        rows = b.get("rows") or []
                        if not isinstance(rows, list) or not rows:
                            return self._json({"error": "provide 'rows' (list of patient records)"}, 400)
                        rec = cohort.import_cohort(b.get("name") or "cohort", rows)
                        return self._json(rec)
                    return self._json({"cohorts": cohort.list_cohorts()})

                return self._json({"error": f"not found: {path}"}, 404)
            except Exception as exc:
                self._json({"error": str(exc)}, 500)

    return H


def serve(port: int = 8600, *, host: str = "127.0.0.1", demo_seed: bool = True) -> None:
    if demo_seed:
        demo.ensure_seeded()
    httpd = ThreadingHTTPServer((host, port), _handler())
    shown = "127.0.0.1" if host in ("127.0.0.1", "0.0.0.0") else host
    base = f"http://{shown}:{port}"
    print(f"Strata  ->  {base}/            landing")
    print(f"        ->  {base}/app         Verify + Compare demo")
    print(f"        ->  {base}/platform    self-host platform")
    print(f"        ->  {base}/console     Monitor console   ·   /lite")
    print(f"        ->  {base}/v1/verify   API (POST {{\"claim\": \"...\"}})")
    if os.environ.get("STRATA_API_KEYS"):
        print("        API key required (STRATA_API_KEYS is set).")
    print("(ctrl-c to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
