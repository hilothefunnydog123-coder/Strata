"""`strata serve` — the web application and the public API in one process.

Three surfaces on one server, standard library only:

* **Marketing + Strata Verify** — the public demonstration of the engine. Ask a
  claim, watch it get structured, searched, graded, and split into supporting vs
  contradicting evidence with an inspectable strength verdict.
* **The Console** — the enterprise dashboard over a monitored evidence base:
  what changed, what weakened, what is newly contradicted.
* **The API** (`/v1/*`) — the same engine behind real, hashed API keys, with
  per-key rate limiting and usage logging.

Nothing about a public visitor is stored; the Console reads a clearly-labelled
synthetic demo workspace. Secrets never reach the browser.
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional

from . import api as _api
from . import web as _web
from .db import Database, get_db
from .notify import deliver_demo_request
from .seed import seed_demo
from .verify import verify as _verify

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_BODY = 64 * 1024


def _json_bytes(obj: Any) -> bytes:
    return json.dumps(obj, default=str).encode("utf-8")


def _handler(db: Database, demo_ws: int):
    class H(BaseHTTPRequestHandler):
        server_version = "Strata/1.0"

        def log_message(self, *a):  # keep the console quiet
            pass

        # -- response helpers ------------------------------------------------
        def _send(self, body: bytes, ctype: str, code: int = 200,
                  headers: Optional[Dict[str, str]] = None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _html(self, html: str, code: int = 200):
            self._send(html.encode("utf-8"), "text/html; charset=utf-8", code)

        def _json(self, obj: Any, code: int = 200):
            self._send(_json_bytes(obj), "application/json", code)

        def _read_body(self) -> Dict[str, Any]:
            n = int(self.headers.get("Content-Length", "0") or "0")
            if n <= 0 or n > MAX_BODY:
                return {}
            raw = self.rfile.read(n)
            try:
                return json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return {}

        # -- routing ---------------------------------------------------------
        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            path, qs = u.path, urllib.parse.parse_qs(u.query)
            try:
                if path == "/":
                    return self._html(_web.homepage())
                if path == "/verify":
                    return self._html(_web.verify_page())
                if path == "/console":
                    return self._html(_web.console_page())
                if path == "/docs":
                    return self._html(_web.docs_page())
                if path == "/healthz":
                    return self._json({"status": "ok"})

                # built-in app JSON (public demo; nothing stored)
                if path == "/app/verify":
                    return self._app_verify(qs)
                if path == "/app/console/overview":
                    return self._json(_web.console_overview(db, demo_ws))
                if path == "/app/console/claims":
                    return self._json(_web.console_claims(db, demo_ws, qs))
                if path == "/app/console/claim":
                    return self._app_claim(qs)

                # public API (GET)
                if path.startswith("/v1/claims/"):
                    return self._api_get_claim(path)
                if path == "/v1/changes":
                    return self._api(lambda ctx: _api.get_changes_handler(
                        db, {k: v[0] for k, v in qs.items()}, ctx), "GET", path)

                return self._json({"error": "not found"}, 404)
            except BrokenPipeError:
                return
            except Exception as exc:  # never leak a stack trace to the client
                return self._json({"error": "internal error", "detail": str(exc)}, 500)

        def do_POST(self):
            u = urllib.parse.urlparse(self.path)
            path = u.path
            try:
                if path == "/app/demo":
                    return self._app_demo()
                if path == "/v1/verify":
                    return self._api(lambda ctx: _api.verify_handler(db, self._read_body(), ctx),
                                     "POST", path)
                if path == "/v1/search":
                    return self._api(lambda ctx: _api.search_handler(db, self._read_body(), ctx),
                                     "POST", path)
                if path == "/v1/compare":
                    return self._api(lambda ctx: _api.compare_handler(db, self._read_body(), ctx),
                                     "POST", path)
                if path == "/v1/monitor":
                    return self._api(lambda ctx: _api.monitor_handler(db, self._read_body(), ctx),
                                     "POST", path)
                return self._json({"error": "not found"}, 404)
            except BrokenPipeError:
                return
            except Exception as exc:
                return self._json({"error": "internal error", "detail": str(exc)}, 500)

        # -- built-in app endpoints -----------------------------------------
        def _app_verify(self, qs):
            q = (qs.get("q") or [""])[0].strip()
            if not q:
                return self._json({"error": "empty question"}, 400)
            try:
                verdict = _verify(q, k=int((qs.get("k") or ["10"])[0]))
                return self._json(verdict.to_dict())
            except Exception as exc:
                return self._json({"error": str(exc)}, 502)

        def _app_claim(self, qs):
            try:
                cid = int((qs.get("id") or ["0"])[0])
            except ValueError:
                return self._json({"error": "bad id"}, 400)
            payload = _web.console_claim_detail(db, cid)
            if payload is None:
                return self._json({"error": "not found"}, 404)
            return self._json(payload)

        def _app_demo(self):
            body = self._read_body()
            email = (body.get("email") or "").strip()
            if not _EMAIL_RE.match(email):
                return self._json({"ok": False, "error": "A valid work email is required."}, 400)
            req = {k: (body.get(k) or "").strip()[:500] for k in
                   ("name", "email", "organization", "role", "company", "use_case")}
            demo_id = db.create_demo_request(source="web", **req)
            delivered, note = deliver_demo_request(req)
            db.mark_demo_delivered(demo_id, note) if delivered else None
            return self._json({"ok": True,
                               "message": "Thanks — your request is in. We'll be in touch.",
                               "delivered": delivered})

        # -- API plumbing: auth, rate limit, usage logging ------------------
        def _bearer(self) -> Optional[str]:
            h = self.headers.get("Authorization", "")
            if h.startswith("Bearer "):
                return h[7:]
            return self.headers.get("X-API-Key")

        def _api(self, fn, method: str, endpoint: str):
            start = time.time()
            status = 200
            key_id = None
            try:
                ctx = _api.authenticate(db, self._bearer())
                key_id = ctx.key_id
                _api.enforce_rate_limit(db, ctx)
                result = fn(ctx)
                self._json(result, 200)
            except _api.ApiError as e:
                status = e.status
                self._json({"error": {"code": e.code, "message": e.message}}, e.status)
            except Exception as e:
                status = 500
                self._json({"error": {"code": "internal", "message": str(e)}}, 500)
            finally:
                db.log_usage(key_id, endpoint=endpoint, method=method, status_code=status,
                             latency_ms=int((time.time() - start) * 1000))

        def _api_get_claim(self, path: str):
            try:
                cid = int(path.rsplit("/", 1)[-1])
            except ValueError:
                return self._json({"error": {"code": "bad_id", "message": "invalid claim id"}}, 400)
            return self._api(lambda ctx: _api.get_claim_handler(db, cid, ctx), "GET", path)

    return H


def serve(port: int = 8600, host: str = "127.0.0.1", *, db_path: Optional[str] = None,
          seed: bool = True) -> None:
    db = get_db(db_path)
    demo_ws = seed_demo(db) if seed else 0
    httpd = ThreadingHTTPServer((host, port), _handler(db, demo_ws))
    print(f"Strata running on http://{host}:{port}")
    print(f"  ·  /          marketing + live Strata Verify")
    print(f"  ·  /verify    the evidence engine, full trail")
    print(f"  ·  /console   enterprise evidence-change dashboard (synthetic demo data)")
    print(f"  ·  /docs      API reference")
    print("  (ctrl-c to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
