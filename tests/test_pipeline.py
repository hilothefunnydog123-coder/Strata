"""Tests for the staged pipeline, model router, and key hardening.
Run: python tests/test_pipeline.py  (fully offline)
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["STRATA_HOME"] = tempfile.mkdtemp(prefix="strata-pl-")
for k in ("STRATA_LLM_KEY", "GROQ_API_KEY"):        # ensure heuristic path by default
    os.environ.pop(k, None)

from strata import pipeline, models, keys           # noqa: E402
from strata.pubmed import Article                    # noqa: E402

_STAGES = ["understand", "expand", "retrieve", "dedup", "rank", "classify",
           "extract", "contradiction", "grade", "synthesize", "audit"]


def _art(pmid, title, pt, ab, yr, cb=0):
    return Article(pmid, title, ab, "J", yr, ["S"], pt, cited_by=cb)


SUPPORT = [
    _art("1", "Meta-analysis: drug X reduces hospitalization in heart failure",
         ["Meta-Analysis"], "HR 0.70 (95% CI 0.62 to 0.79).", 2023, 400),
    _art("2", "RCT of drug X in heart failure", ["Randomized Controlled Trial"],
         "HR 0.74 (95% CI 0.65 to 0.85).", 2021, 220),
    _art("3", "Cohort of drug X", ["Observational Study"], "aHR 0.80 (95% CI 0.70 to 0.92).", 2020, 90),
]


def test_stream_emits_every_stage():
    evs = list(pipeline.stream("Drug X reduces hospitalization in patients with heart failure",
                               now="2026-01-01T00:00:00+00:00", current_year=2026,
                               _search=lambda q, retmax=40: SUPPORT))
    stages = [e["stage"] for e in evs if e["type"] == "stage"]
    assert stages == _STAGES, stages
    assert evs[-1]["type"] == "done"
    print("ok  pipeline streams all 11 stages then done")


def test_receipt_is_structured():
    r = pipeline.run("Drug X reduces hospitalization in patients with heart failure",
                     now="2026-01-01T00:00:00+00:00", current_year=2026,
                     _search=lambda q, retmax=40: SUPPORT)
    assert r.claim_status in ("SUPPORTED", "PARTIALLY_SUPPORTED")
    assert 0.0 <= r.confidence <= 1.0 and r.confidence > 0.3
    assert r.pico["intervention"] and r.pico["outcome"]
    assert len(r.effect_estimates) == 3
    assert len(r.audit_trail) == 11 and r.audit_trail[0]["stage"] == "understand"
    assert r.elapsed_ms >= 0 and r.models_used == []       # no model configured
    print("ok  receipt carries claim_status, confidence, PICO, effects, audit trail")


def test_pico_can_be_provided():
    r = pipeline.run("Drug X reduces hospitalization",
                     pico={"population": "adults over 65", "comparator": "standard care"},
                     now="2026-01-01T00:00:00+00:00", current_year=2026,
                     _search=lambda q, retmax=40: SUPPORT)
    assert r.pico["population"] == "adults over 65" and r.pico["comparator"] == "standard care"
    print("ok  caller-supplied PICO is honoured")


def test_model_router_offline():
    assert models.available() is False                     # no key configured
    assert models.tier_for("synthesis") == "reason"
    assert models.tier_for("study_classification") == "fast"
    os.environ["STRATA_TASK_SYNTHESIS"] = "fast"
    assert models.tier_for("synthesis") == "fast"          # env override
    del os.environ["STRATA_TASK_SYNTHESIS"]

    def fake_post(url, headers, body):                     # injected transport
        return {"choices": [{"message": {"content": '{"stance":"support","confidence":0.9}'}}]}
    out, used = models.run_json("study_classification", [{"role": "user", "content": "x"}], _post=fake_post)
    assert out["stance"] == "support" and used is not None
    print("ok  model router: task routing, env override, injected transport + JSON parse")


def test_key_hardening():
    raw, rec = keys.generate("prod", rate_limit=2)
    assert keys.has_scope(rec, "verify") and rec["rate_limit"] == 2
    ok1, _ = keys.check_rate(rec)
    ok2, _ = keys.check_rate(rec)
    ok3, retry = keys.check_rate(rec)
    assert ok1 and ok2 and not ok3 and retry >= 1          # third call over the 2/min limit
    keys.log_request(rec["id"], "/v1/verify", 200)
    assert len(keys.get_logs(rec["id"])) == 1
    new_raw, red = keys.rotate(rec["id"])
    assert new_raw != raw and keys.validate(raw) is None    # old secret invalid after rotation
    assert keys.validate(new_raw) is not None               # new secret works
    print("ok  keys: rate limit, request log, rotation invalidates old secret")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nall pipeline + models + keys tests passed")
