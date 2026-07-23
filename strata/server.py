"""`strata serve` — the local web app.

Two surfaces, both standard-library only, both live against public PubMed (or the seeded
demo data offline):

* ``/``       Strata Console — the B2B dashboard for a clinical evidence team.
* ``/lite``   Strata Lite — the simple ask-one-question B2C page.

JSON endpoints power them:

    GET /api/ask?q=            one-shot graded answer (Lite)
    GET /api/reviews           all living reviews + status
    GET /api/review?id=        one review's full render payload
    GET /api/review/run?id=    re-sync a review, return the fresh payload
    GET /api/review/new?q=...  create a review + first sync

Nothing is stored server-side beyond the living-review JSON on disk. No patient data.
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import demo, review
from .pages import CONSOLE_HTML, LITE_HTML
from .query import ask

_LEVEL_COLOR = {1: "#16a34a", 2: "#22a06b", 3: "#d97706",
                4: "#ea580c", 5: "#dc2626", 6: "#9ca3af"}


def _first_sentences(text, n=2):
    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return " ".join(parts[:n]).strip()


def _ask_payload(result) -> dict:
    sources = []
    for i, e in enumerate(result.evidence, 1):
        sources.append({
            "n": i, "title": e.article.title, "year": e.article.year,
            "url": e.article.url, "study_type": e.grade.label,
            "strength": e.grade.strength, "level": e.grade.level,
            "sample_size": e.grade.sample_size,
            "snippet": _first_sentences(e.article.abstract) or "(no abstract)",
            "color": _LEVEL_COLOR[e.grade.level],
        })
    return {"question": result.question, "overall_strength": result.body.overall_strength,
            "summary": result.body.summary, "sources": sources}


def _tenant() -> str:
    return os.environ.get("STRATA_TENANT", "Demo Health System")


_DEMO_BY_ID = {t["id"]: t for t in demo._TOPICS}


def _run_review(review_id: str) -> dict | None:
    """Re-sync a review. Demo reviews re-run offline against their fixed dataset (so a
    live demo never needs the network); real reviews hit PubMed."""
    t = _DEMO_BY_ID.get(review_id)
    if t is not None:
        review.sync(review_id, current_year=2026,
                    _search=lambda q, retmax=60, _d=t["data"]: list(_d))
    else:
        review.sync(review_id)
    return review.view(review_id)


def _handler():
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, body: bytes, ctype: str, code=200):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, code=200):
            self._send(json.dumps(obj).encode(), "application/json", code)

        def _q(self, u):
            return urllib.parse.parse_qs(u.query)

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            path, q = u.path, None
            try:
                if path == "/api/ask":
                    q = self._q(u)
                    question = (q.get("q") or [""])[0].strip()
                    if not question:
                        return self._json({"error": "empty question"}, 400)
                    return self._json(_ask_payload(ask(question, k=int((q.get("k") or ["8"])[0]))))

                if path == "/api/reviews":
                    return self._json({"tenant": _tenant(), "reviews": review.list_reviews()})

                if path == "/api/review":
                    rid = (self._q(u).get("id") or [""])[0]
                    v = review.view(rid)
                    return self._json(v) if v else self._json({"error": "no such review"}, 404)

                if path == "/api/review/run":
                    rid = (self._q(u).get("id") or [""])[0]
                    v = _run_review(rid)
                    return self._json(v) if v else self._json({"error": "no such review"}, 404)

                if path == "/api/review/new":
                    q = self._q(u)
                    question = (q.get("q") or [""])[0].strip()
                    if not question:
                        return self._json({"error": "empty question"}, 400)
                    title = (q.get("title") or [question[:48]])[0].strip() or question[:48]
                    levels = tuple(int(x) for x in (q.get("levels") or ["1", "2", "3"])[0].split(",") if x)
                    since = q.get("since")
                    p = review.create(title, question, include_levels=levels,
                                      since_year=int(since[0]) if since and since[0].isdigit() else None)
                    review.sync(p.id)
                    return self._json(review.view(p.id))

                if path == "/lite":
                    return self._send(LITE_HTML.encode(), "text/html; charset=utf-8")

                return self._send(CONSOLE_HTML.encode(), "text/html; charset=utf-8")
            except Exception as exc:                       # keep the dev server alive
                self._json({"error": str(exc)}, 500)

    return H


def serve(port: int = 8600, *, demo_seed: bool = True) -> None:
    if demo_seed:
        demo.ensure_seeded()           # only seeds if the store is empty
    httpd = ThreadingHTTPServer(("127.0.0.1", port), _handler())
    print(f"Strata Console  →  http://127.0.0.1:{port}/")
    print(f"Strata Lite     →  http://127.0.0.1:{port}/lite")
    print("(ctrl-c to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
