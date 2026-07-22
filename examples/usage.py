"""Using Strata as a library.

    python examples/usage.py            # sections 1-4 query live PubMed
    python examples/usage.py --offline  # only the sections that need no network
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# A Windows console on cp1252 cannot encode the rules and arrows below.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, OSError):
    pass

from strata import EffectSize, ask, compare, extract_effects, pool   # noqa: E402
from strata.evidence import grade                                    # noqa: E402
from strata.pico import build_query, parse                           # noqa: E402
from strata.pubmed import Article                                    # noqa: E402

OFFLINE = "--offline" in sys.argv


def rule(title):
    print(f"\n{'─' * 72}\n{title}\n{'─' * 72}")


# 1 ─ the basic call ---------------------------------------------------------
live = None
if not OFFLINE:
    rule("1. Ask a question")
    live = ask("Does vitamin D supplementation prevent respiratory infections?")
    print(f"certainty : {live.body.overall_strength}")
    print(f"verdict   : {live.body.summary}")
    for caveat in live.body.caveats:
        print(f"  caveat  : {caveat}")
    print(f"consensus : {live.consensus.summary}")
    if live.pooled:
        print(f"pooled    : {live.pooled.format()}")
    if live.evidence:
        top = live.evidence[0]
        print(f"\ntop source: {top.article.title}")
        print(f"            {top.grade.label} · {top.grade.strength} certainty")


# 2 ─ inspecting why a paper got the grade it did ----------------------------
if live is not None:
    rule("2. Why did each paper get its grade?")
    for e in live.evidence[:3]:
        g = e.grade
        print(f"\n{e.article.title[:66]}")
        print(f"  level {g.level} · {g.label} · classified by {g.classified_by} "
              f"({g.confidence:.0%} confident)")
        print(f"  starts at {g.base_strength}, ends at {g.strength}")
        for d in g.domains:
            arrow = "↓" if d.delta < 0 else ("↑" if d.delta > 0 else "·")
            print(f"    {arrow} {d.name}: {d.reason}")
        if g.safeguards:
            print(f"  reports: {', '.join(g.safeguards)}")


# 3 ─ narrative mode with your own model -------------------------------------
if not OFFLINE:
    rule("3. Narrative mode — bring your own model")

    def my_model(prompt: str) -> str:
        """Any text-in/text-out callable; yours would call an API here.

        Strata has already put *only* the retrieved abstracts into `prompt`,
        along with the certainty grade and consensus it computed. The model's job
        is to summarise that appraisal — it is never the source of a fact, and an
        answer that arrives without citations gets flagged rather than shown.
        """
        return ("Supplementation modestly reduces respiratory infection risk "
                "[1][2], with a smaller effect in already-replete populations.")

    narrated = ask("Does vitamin D prevent respiratory infections?",
                   generate=my_model)
    print(narrated.answer)


# 4 ─ comparing two evidence bases -------------------------------------------
if not OFFLINE:
    rule("4. Compare two evidence bases")
    c = compare("metformin", "sulfonylurea", outcome="cardiovascular mortality")
    print(c.verdict)


# 5 ─ grading a paper you already have (no network) --------------------------
rule("5. Grade a single paper offline")
paper = Article(
    pmid="00000000",
    title="Effect of a nurse-led protocol on delirium: a randomised trial",
    abstract=("METHODS: 1,204 ICU patients were assigned to the protocol or usual "
              "care using a computer-generated sequence concealed from the "
              "enrolling nurse. Assessors were unaware of allocation and all "
              "patients were analysed in their assigned group. RESULTS: Delirium "
              "was less frequent (risk ratio 0.71, 95% CI 0.56 to 0.90; p = 0.005)."),
    journal="Crit Care Med", year=2024, authors=["Bloggs J", "Smith A"],
    publication_types=["Randomized Controlled Trial"])

g = grade(paper, 2026)
print(f"level      : {g.level} — {g.label}")
print(f"certainty  : {g.base_strength} → {g.strength}")
print(f"sample size: {g.sample_size:,}" if g.sample_size else "sample size: —")
print(f"effect     : {g.effect.format() if g.effect else '—'}")
print(f"safeguards : {', '.join(g.safeguards) or '(none detected)'}")
print(f"stance     : {g.stance or '(direction could not be read)'}")
for d in g.domains:
    print(f"  {d.name}: {d.verdict} — {d.reason}")


# 6 ─ effect sizes and pooling (no network) ----------------------------------
rule("6. Read effect sizes and pool them")
text = ("The hazard ratio for mortality was 0.82 (95% CI 0.71 to 0.95; p = 0.008). "
        "A secondary analysis gave an odds ratio of 1.04 (95% CI 0.88-1.23).")
for e in extract_effects(text):
    print(f"  {e.format():<48} significant={e.is_significant}")

pooled = pool([EffectSize("RR", 0.82, 0.71, 0.95),
               EffectSize("RR", 0.90, 0.78, 1.04),
               EffectSize("RR", 0.74, 0.60, 0.91),
               EffectSize("RR", 0.88, 0.80, 0.97)])
print(f"\n  {pooled.format()}")
print(f"  p = {pooled.p_value:.4f} · tau² = {pooled.tau_squared:.4f} · "
      f"{pooled.heterogeneity} heterogeneity")
print(f"  excludes no effect: {pooled.excludes_null}")


# 7 ─ question parsing (no network) ------------------------------------------
rule("7. See how a question becomes a PubMed query")
for q in ["Does vitamin D prevent respiratory infections in children?",
          "Aspirin versus clopidogrel for secondary stroke prevention"]:
    p = parse(q)
    print(f"\n{q}")
    print(f"  {p.summary()}")
    print(f"  {build_query(p)}")


# 8 ─ the neural layer, if it is trained (no network) -------------------------
rule("8. What the networks saw")
try:
    from strata.nn import design_net, rigour_net, stance_net
    net = design_net()
    if net is None:
        print("  no weights on disk — run `strata nn train`")
    else:
        # paper.text() — title *and* abstract, exactly what the pipeline feeds
        # in. On the abstract alone this trial reads as preclinical; the title
        # is doing real work and the classifier should be given it.
        p = net.predict(paper.text())
        print(f"  design : {p.label} ({p.confidence:.0%} confident)")
        for phrase, w in p.evidence_spans:
            print(f'      {w:>5.2f}  "{phrase}"')
        s = stance_net()
        if s is not None:
            sp = s.predict(paper.text(), explain=False)
            print(f"  stance : {sp.label} ({sp.confidence:.0%})")
        rg = rigour_net()
        if rg is not None:
            rp = rg.predict_labels(paper.text(), explain=False)
            print(f"  reports: {', '.join(rp.present) or '(none)'}")
except Exception as exc:                       # a missing checkpoint is not fatal
    print(f"  neural layer unavailable: {exc}")

print()
