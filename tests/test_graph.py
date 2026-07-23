"""Tests for the Evidence Graph — the cross-claim intelligence layer.
Run: python tests/test_graph.py  (fully offline)
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["STRATA_HOME"] = tempfile.mkdtemp(prefix="strata-graph-")
for k in ("STRATA_LLM_KEY", "GROQ_API_KEY"):
    os.environ.pop(k, None)

from strata import demo, graph                                    # noqa: E402


def _g():
    return graph.build()


def test_graph_builds_from_accumulated_claims():
    demo.seed_all(force=True)
    g = _g()
    assert len(g["claims"]) >= 7 and len(g["studies"]) >= 10
    s = graph.summary(g=g)
    assert s["edges"] > s["claims"]                 # each claim cites several studies
    assert s["density"] >= 2
    print(f"ok  graph assembles {s['claims']} claims / {s['studies']} studies / {s['edges']} edges")


def test_hub_studies_span_multiple_claims():
    g = _g()
    hubs = graph.hub_studies(g, limit=5)
    assert hubs and hubs[0]["claim_count"] >= 2     # a study underpinning >=2 claims exists
    assert hubs == sorted(hubs, key=lambda h: -h["claim_count"])
    print(f"ok  hub studies: top study underpins {hubs[0]['claim_count']} claims")


def test_contested_study_is_cited_both_ways():
    g = _g()
    contested = graph.contested_studies(g, limit=10)
    assert contested, "expected at least one contested study"
    top = contested[0]
    assert top["support"] >= 1 and top["contradict"] >= 1 and top["contested"] is True
    print("ok  a contested study is cited as support by one claim, contradict by another")


def test_related_claims_share_evidence():
    g = _g()
    rel = graph.related_claims(g, "clm-sglt2-hf")
    assert rel and rel[0]["shared"] >= 1 and rel[0]["weight"] > 0
    assert any(r["id"] == "clm-sglt2-cvd" for r in rel)   # the two SGLT2 claims share trials
    print(f"ok  related claims: SGLT2-HF shares {rel[0]['shared']} studies with a sibling claim")


def test_unstable_claims_reflect_history():
    g = _g()
    unstable = graph.unstable_claims(g, limit=10)
    assert unstable and all(0 <= u["instability"] <= 1 for u in unstable)
    assert unstable == sorted(unstable, key=lambda u: (-u["instability"], -u["version"]))
    print(f"ok  instability scored from version/status churn (top {unstable[0]['instability']})")


def test_reliability_prefers_strong_consistent_studies():
    g = _g()
    detail = None
    for h in graph.hub_studies(g, limit=20):
        if (h["level"] or 9) == 1 and h["support"] >= 1 and h["contradict"] == 0:
            detail = graph.study_detail(g, h["key"])
            break
    assert detail and 0 <= detail["reliability"] <= 1 and detail["reliability"] > 0.6
    assert detail["claims"], "study_detail lists the claims that cite it"
    print(f"ok  a strong, consistently-supporting meta-analysis scores reliability {detail['reliability']}")


def test_summary_counts_the_asset():
    s = graph.summary()
    for k in ("claims", "studies", "edges", "hub_studies", "contested_studies",
              "unstable_claims", "evidence_gaps", "avg_reliability", "density"):
        assert k in s
    assert s["hub_studies"] >= 1 and s["contested_studies"] >= 1
    view = graph.graph_view()
    assert view["claims"] and view["studies"] and view["links"]
    print("ok  graph summary + node-link view expose the accumulated asset")


if __name__ == "__main__":
    for name in ["test_graph_builds_from_accumulated_claims", "test_hub_studies_span_multiple_claims",
                 "test_contested_study_is_cited_both_ways", "test_related_claims_share_evidence",
                 "test_unstable_claims_reflect_history", "test_reliability_prefers_strong_consistent_studies",
                 "test_summary_counts_the_asset"]:
        globals()[name]()
    print("\nall graph tests passed")
