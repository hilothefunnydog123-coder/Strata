"""Tests for the calibration/accuracy harness — the trust proof stays honest and regressions
are caught. Run: python tests/test_eval.py  (fully offline)
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["STRATA_HOME"] = tempfile.mkdtemp(prefix="strata-eval-")
for k in ("STRATA_LLM_KEY", "GROQ_API_KEY"):
    os.environ.pop(k, None)

from strata import evaluation as ev                               # noqa: E402


def test_gold_set_is_labelled_and_balanced():
    labels = [s["gold"] for item in ev.GOLD for s in item["studies"]]
    assert len(ev.GOLD) >= 6 and len(labels) >= 18
    for c in ("support", "contradict", "neutral"):
        assert labels.count(c) >= 3, f"gold set thin on {c}"
    # every labelled study is a valid class
    assert set(labels) <= {"support", "contradict", "neutral"}
    print(f"ok  gold set: {len(ev.GOLD)} claims, {len(labels)} labelled studies, all three classes present")


def test_stance_accuracy_meets_floor():
    r = ev.run_stance_eval()
    assert r["n"] >= 18
    assert r["accuracy"] >= 0.9, f"stance accuracy regressed to {r['accuracy']}"
    assert r["macro_f1"] >= 0.9
    # confusion diagonal dominates
    for c in ("support", "contradict", "neutral"):
        assert r["confusion"][c][c] >= 1
    print(f"ok  stance accuracy {r['accuracy']*100:.0f}% (macro-F1 {r['macro_f1']}) — regression floor held")


def test_status_accuracy_meets_floor():
    r = ev.run_status_eval()
    assert r["n"] == len(ev.GOLD)
    assert r["accuracy"] >= 0.8, f"status accuracy regressed to {r['accuracy']}"
    print(f"ok  status accuracy {r['accuracy']*100:.0f}% across {r['n']} gold claims")


def test_report_is_honest_about_the_path():
    rep = ev.run()
    assert "heuristic" in rep["path"] and "floor" in rep["path"]
    assert 0.0 <= rep["stance_accuracy"] <= 1.0 and 0.0 <= rep["status_accuracy"] <= 1.0
    assert rep["gold_claims"] == len(ev.GOLD)
    print("ok  report labels itself the heuristic offline floor (no model) — no overclaiming")


if __name__ == "__main__":
    for name in ["test_gold_set_is_labelled_and_balanced", "test_stance_accuracy_meets_floor",
                 "test_status_accuracy_meets_floor", "test_report_is_honest_about_the_path"]:
        globals()[name]()
    print("\nall eval tests passed")
