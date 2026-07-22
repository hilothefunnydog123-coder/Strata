"""Tests for Strata's pipeline. Run: ``python tests/test_strata.py``

The PubMed network layer is mocked throughout, so retrieval, de-duplication,
grading, ranking, consensus, pooling and synthesis are all exercised offline.
The one thing not covered here is live E-utilities I/O, which is thin and is
covered by running ``strata ask`` for real.

The fixtures are written to be awkward on purpose: a retracted trial, a duplicate
record of the same study, a paper whose title says "randomised" but whose methods
describe a cohort, and an abstract with no interval to plot.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# These scripts print I-squared, tau and box-drawing characters. A Windows
# console defaulting to cp1252 would raise mid-run, so ask for UTF-8 explicitly.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, OSError):
    pass

from strata import consensus as consensus_mod                  # noqa: E402
from strata import pico as pico_mod                            # noqa: E402
from strata import query, ranking as rank_mod, stats, synthesize  # noqa: E402
from strata.evidence import grade, summarize_body, sample_size  # noqa: E402
from strata.pubmed import Article, Correction, parse_articles   # noqa: E402
from strata.server import to_bibtex, to_markdown                # noqa: E402

YEAR = 2026


def art(pmid, title, ptypes, abstract="", year=2023, **kw):
    return Article(pmid=pmid, title=title, abstract=abstract, journal="J Test",
                   year=year, authors=["Smith J", "Doe A"],
                   publication_types=ptypes, **kw)


META = art(
    "2", "Vitamin D and respiratory infection: a meta-analysis of randomised trials",
    ["Meta-Analysis"],
    "METHODS: We searched MEDLINE and Embase and pooled 25 trials (n = 11,321) "
    "using a random-effects model. The review protocol was registered in PROSPERO "
    "ahead of the search. RESULTS: Supplementation reduced infection risk "
    "(risk ratio 0.88, 95% CI 0.81 to 0.96; p = 0.003). CONCLUSIONS: Vitamin D "
    "modestly reduced respiratory infection.", 2021)

RCT = art(
    "4", "Randomised controlled trial of vitamin D in adults",
    ["Randomized Controlled Trial"],
    "METHODS: In this double-blind, placebo-controlled trial we randomly assigned "
    "5,000 adults to vitamin D or placebo. Participants and outcome assessors were "
    "masked to allocation and all participants were analysed in the group to which "
    "they were assigned. RESULTS: The effect was modest (risk ratio 0.91, 95% CI "
    "0.83 to 0.99; p = 0.03). CONCLUSIONS: Supplementation significantly reduced "
    "infection.", 2023)

COHORT = art(
    "5", "Vitamin D status and infection: a prospective cohort study",
    ["Observational Study"],
    "METHODS: We prospectively followed 40,000 adults. Estimates were adjusted for "
    "age, sex, comorbidity and socioeconomic status. RESULTS: Lower vitamin D was "
    "associated with more infection (hazard ratio 1.35, 95% CI 1.18 to 1.55). "
    "CONCLUSIONS: The association was significant.", 2019)

RCT2 = art(
    "6", "Vitamin D for prevention of acute respiratory infection: a randomised trial",
    ["Randomized Controlled Trial"],
    "METHODS: 2,400 adults were randomly assigned to weekly vitamin D or placebo. "
    "The sample size was calculated in advance to give 90% power. RESULTS: There was "
    "no significant difference in infection rates (risk ratio 0.97, 95% CI 0.88 to "
    "1.07; p = 0.54). CONCLUSIONS: Vitamin D did not reduce infection in this "
    "population and routine use is not supported.", 2022)

CASE = art("3", "A case report of vitamin D toxicity", ["Case Reports"],
           "CASE PRESENTATION: We describe one patient who developed hypercalcaemia. "
           "No causal inference can be drawn from a single case.", 2022)

REVIEW = art("1", "A narrative overview of vitamin D", ["Review"],
             "This narrative review summarises current thinking. No systematic "
             "search was performed and studies were selected at the authors' "
             "discretion.", 2018)

RETRACTED = art(
    "9", "Randomised trial of megadose vitamin D for infection prevention",
    ["Randomized Controlled Trial", "Retracted Publication"],
    "METHODS: We randomly assigned 900 adults. RESULTS: Infection fell sharply "
    "(risk ratio 0.31, 95% CI 0.19 to 0.51; p < 0.001). CONCLUSIONS: Megadose "
    "vitamin D significantly reduced infection.", 2016,
    corrections=[Correction(kind="RetractionIn", pmid="99", note="J Test 2018")])

DUPLICATE = art(
    "4b", "Randomised controlled trial of vitamin D in adults",
    ["Randomized Controlled Trial"],
    "METHODS: In this double-blind, placebo-controlled trial we randomly assigned "
    "5,000 adults to vitamin D or placebo. Participants and outcome assessors were "
    "masked to allocation and all participants were analysed in the group to which "
    "they were assigned. RESULTS: The effect was modest (risk ratio 0.91, 95% CI "
    "0.83 to 0.99; p = 0.03).", 2023)

SAMPLE = [REVIEW, META, CASE, RCT, COHORT, RCT2]


def fake_search(_query, retmax=25, articles=None):
    return list(articles if articles is not None else SAMPLE), 137, "translated"


def _searcher(articles):
    return lambda q, retmax=25: fake_search(q, retmax, articles)


# ------------------------------------------------------------------ grading

def test_grader_places_studies_on_the_pyramid():
    assert grade(META, YEAR).level == 1
    assert grade(RCT, YEAR).level == 2
    assert grade(COHORT, YEAR).level == 3
    assert grade(CASE, YEAR).level == 5
    assert grade(REVIEW, YEAR).level == 6
    assert grade(META, YEAR).sample_size == 11321
    print("ok  grader places studies on the evidence pyramid")


def test_grade_records_why_certainty_moved():
    g = grade(RCT, YEAR)
    assert g.strength == "high", g.strength
    assert g.domains, "a grade must record its GRADE reasoning"
    assert any(d.name == "Risk of bias" for d in g.domains)

    # A cohort starts low under GRADE and has to earn its way up.
    gc = grade(COHORT, YEAR)
    assert gc.base_strength == "low"
    assert all(d.reason for d in gc.domains), "every domain states a reason"
    print("ok  each grade carries its GRADE domains and the reason for each")


def test_retraction_is_detected_and_never_hidden():
    g = grade(RETRACTED, YEAR)
    assert g.retracted is True
    assert g.strength == "very low", "a retracted trial cannot be high certainty"
    assert any(d.name == "Retraction" for d in g.domains)
    print("ok  a retracted paper is flagged and driven to the floor")


def test_sample_size_extraction():
    assert sample_size("we enrolled 4,902 participants") == 4902
    # The largest, not the first: abstracts name a subgroup before the total.
    assert sample_size("n = 88 in the pilot; a cohort of 12,004 was then followed") \
        == 12004
    assert sample_size("21 trials comprising 45,000 participants") == 45000
    # adjectives are allowed between the count and the noun...
    assert sample_size("1,204 ICU patients were assigned") == 1204
    assert sample_size("12,004 community-dwelling older adults") == 12004
    # ...but the match must not leap a clause boundary
    assert sample_size("In 2019, 45 hospitals reported") is None
    assert sample_size("no numbers here") is None
    assert sample_size("") is None
    print("ok  sample size reads the largest plausible participant count")


# ----------------------------------------------------------------- statistics

def test_effect_extraction_and_pooling():
    e = stats.extract_effects(META.abstract)[0]
    assert e.measure == "RR" and abs(e.estimate - 0.88) < 1e-9
    assert e.has_interval and e.is_significant is True
    assert e.direction == "below"

    pooled = stats.pool([stats.EffectSize("RR", 0.88, 0.81, 0.96),
                         stats.EffectSize("RR", 0.91, 0.83, 0.99),
                         stats.EffectSize("RR", 0.79, 0.62, 1.01)])
    assert pooled is not None and pooled.n_studies == 3
    assert 0.80 < pooled.estimate < 0.95
    assert 0 <= pooled.i_squared <= 100
    print(f"ok  effects parse and pool ({pooled.format()})")


def test_pooling_refuses_when_it_should():
    assert stats.pool([stats.EffectSize("RR", 0.88, 0.81, 0.96)]) is None, \
        "two studies is not a meta-analysis"
    # A point estimate with no interval carries no weight and cannot be pooled.
    bare = [stats.EffectSize("RR", 0.8), stats.EffectSize("RR", 0.9),
            stats.EffectSize("RR", 0.7)]
    assert stats.pool(bare) is None
    print("ok  pooling declines rather than inventing precision")


def test_ratios_and_differences_never_mix():
    mixed = [stats.EffectSize("RR", 0.88, 0.81, 0.96),
             stats.EffectSize("RR", 0.91, 0.83, 0.99),
             stats.EffectSize("RR", 0.85, 0.70, 0.99),
             stats.EffectSize("MD", -4.0, -6.0, -2.0),
             stats.EffectSize("MD", -3.0, -5.0, -1.0)]
    pooled = stats.pool(mixed)
    assert pooled is not None and pooled.measure == "RR" and pooled.n_studies == 3
    print("ok  a risk ratio is never pooled with a mean difference")


# --------------------------------------------------------------------- PICO

def test_pico_parsing_and_query_building():
    p = pico_mod.parse("Does vitamin D prevent respiratory infections in children?")
    assert p.intervention == "vitamin d"
    assert "respiratory infection" in p.outcome
    assert p.population == "children"
    q = pico_mod.build_query(p)
    assert "cholecalciferol" in q, "curated synonyms should expand the search"
    assert "hasabstract" in q

    c = pico_mod.parse("Aspirin versus clopidogrel for secondary stroke prevention")
    assert c.intervention == "aspirin" and c.comparator == "clopidogrel"
    assert c.is_comparative and c.outcome
    print("ok  PICO parsing survives questions of several shapes")


def test_long_phrases_do_not_become_exact_match_queries():
    p = pico_mod.parse(
        "Does metformin reduce cardiovascular mortality in type 2 diabetes?")
    q = pico_mod.build_query(p)
    assert '"cardiovascular mortality in type 2 diabetes"[tiab]' not in q, \
        "a five-word literal phrase would match nothing on PubMed"
    print("ok  long phrases are ANDed word-by-word, not searched literally")


# ------------------------------------------------------ dedup, rank, pipeline

def test_duplicate_records_are_merged():
    kept, groups = rank_mod.deduplicate([RCT, DUPLICATE, META])
    assert len(kept) == 2, "the same trial indexed twice must count once"
    assert groups and groups[0].dropped
    print("ok  a study indexed twice is counted once")


def test_ranking_prioritises_strong_evidence():
    grades = [grade(a, YEAR) for a in SAMPLE]
    ranked = query.rank(SAMPLE, grades, YEAR, keywords=["vitamin", "infection"])
    assert ranked[0].article.pmid == "2", "the meta-analysis should rank first"
    assert ranked[-1].grade.level >= 5, "the weakest evidence should sink"
    assert ranked[0].breakdown.evidence > ranked[-1].breakdown.evidence
    print("ok  ranking floats strong, relevant, recent evidence to the top")


def test_retracted_paper_sinks_but_is_still_shown():
    pool_ = [RETRACTED, META, RCT, CASE]
    grades = [grade(a, YEAR) for a in pool_]
    ranked = query.rank(pool_, grades, YEAR, keywords=["vitamin"])
    pmids = [e.article.pmid for e in ranked]
    assert pmids[-1] == "9", "a retracted trial belongs at the bottom"
    assert "9" in pmids, "…but must still be visible"
    print("ok  a retracted trial sinks to last place without disappearing")


def test_ask_returns_a_grounded_cited_digest():
    r = query.ask("Does vitamin D prevent respiratory infections?",
                  current_year=YEAR, _search=_searcher(SAMPLE))
    assert r.grounded is True
    assert r.body.best_level == 1
    assert "[1]" in r.answer and "http" in r.answer
    assert r.evidence[0].article.pmid == "2"
    assert r.total_hits == 137
    assert r.pico is not None and r.query
    print("ok  ask() returns a grounded, cited digest with an honest verdict")


def test_ask_reports_consensus_and_pools_when_it_can():
    r = query.ask("Does vitamin D prevent respiratory infections?",
                  current_year=YEAR, _search=_searcher(SAMPLE))
    assert r.consensus is not None
    assert r.consensus.direction in ("supports", "no_effect", "against",
                                     "mixed", "insufficient")
    assert 0.0 <= r.consensus.agreement <= 1.0
    # three ratio effects with intervals are present, so pooling should fire
    assert r.pooled is not None and r.pooled.n_studies >= 3
    assert "Indicative pooling" in r.answer
    print(f"ok  consensus + indicative pooling ({r.pooled.format()})")


def test_conflicting_evidence_lowers_certainty_and_says_so():
    against = art(
        "7", "Randomised trial of vitamin D showing increased infection",
        ["Randomized Controlled Trial"],
        "METHODS: We randomly assigned 3,000 adults; assessors were masked. "
        "RESULTS: Infection was significantly worse in the vitamin D group "
        "(risk ratio 1.44, 95% CI 1.19 to 1.74; p = 0.001). More frequent serious "
        "adverse events were seen. CONCLUSIONS: Vitamin D was associated with harm "
        "and its use should be reconsidered.", 2024)
    r = query.ask("Does vitamin D prevent respiratory infections?",
                  current_year=YEAR, _search=_searcher([META, RCT, against, COHORT]))
    c = r.consensus
    assert c.counts, "stances should have been assigned"
    idx = consensus_mod.disagreement_index(c)
    assert 0.0 <= idx <= 1.0
    print(f"ok  conflicting trials are measured, not averaged away "
          f"(direction={c.direction}, disagreement={idx:.2f})")


def test_empty_result_is_honest():
    r = query.ask("a question with no hits", current_year=YEAR,
                  _search=lambda q, retmax=25: ([], 0, ""))
    assert r.body.overall_strength == "none"
    assert "no studies" in r.answer.lower()
    assert "evidence of absence" in r.answer.lower()
    assert r.evidence == []
    print("ok  no evidence -> says so, invents nothing")


def test_thin_results_trigger_a_broadened_search():
    calls = []

    def search(q, retmax=25):
        calls.append(q)
        return ([] if len(calls) == 1 else list(SAMPLE)), 5, ""

    r = query.ask("Does vitamin D prevent respiratory infections in children?",
                  current_year=YEAR, _search=search)
    assert len(calls) == 2, "a thin first result should be retried more broadly"
    assert r.broadened is True and r.evidence
    print("ok  an over-specific query is broadened rather than reported as empty")


# ----------------------------------------------------------------- synthesis

def test_model_synthesis_is_anchored_to_the_sources():
    seen = {}

    def fake_model(prompt):
        seen["prompt"] = prompt
        return "Supplementation modestly reduces infection risk [1][2]."

    r = query.ask("vitamin D infections?", current_year=YEAR, generate=fake_model,
                  _search=_searcher(SAMPLE))
    assert r.grounded is False
    assert "SOURCES:" in seen["prompt"]
    assert "meta-analysis" in seen["prompt"].lower()
    assert "ALREADY COMPUTED" in seen["prompt"]
    assert "Evidence certainty:" in r.answer
    print("ok  model synthesis is anchored to retrieved sources and keeps the verdict")


def test_uncited_model_output_is_flagged():
    r = query.ask("vitamin D?", current_year=YEAR,
                  generate=lambda p: "Vitamin D is good for you.",
                  _search=_searcher(SAMPLE))
    assert "no citations" in r.answer.lower()

    r2 = query.ask("vitamin D?", current_year=YEAR,
                   generate=lambda p: "See [99] for details.",
                   _search=_searcher(SAMPLE))
    assert "not provided" in r2.answer.lower()
    print("ok  an uncited or hallucinated citation is called out, not passed through")


def test_model_failure_falls_back_to_the_digest():
    def broken(_):
        raise RuntimeError("model is down")

    r = query.ask("vitamin D?", current_year=YEAR, generate=broken,
                  _search=_searcher(SAMPLE))
    assert "model synthesis failed" in r.answer
    assert "[1]" in r.answer, "the grounded digest should still be there"
    print("ok  a failed model degrades to the digest and says why")


def test_key_finding_prefers_results_over_background():
    text = ("BACKGROUND: Infections are common and costly. METHODS: We did things. "
            "RESULTS: The risk ratio was 0.72 (95% CI 0.60 to 0.87).")
    assert "0.72" in synthesize.key_finding(text)
    print("ok  the quoted line is the finding, not the background")


# -------------------------------------------------------------------- export

def test_markdown_and_bibtex_export():
    r = query.ask("Does vitamin D prevent respiratory infections?",
                  current_year=YEAR, _search=_searcher(SAMPLE + [RETRACTED]))
    md = to_markdown(r)
    assert md.startswith("# Does vitamin D")
    assert "## Sources" in md and "pubmed.ncbi.nlm.nih.gov" in md

    bib = to_bibtex(r)
    assert bib.count("@article{") == len(r.evidence)
    assert "title = {" in bib
    if any(e.grade.retracted for e in r.evidence):
        assert "RETRACTED" in bib, "a retraction must survive into the citation"
    print("ok  Markdown and BibTeX export cleanly, retractions included")


# --------------------------------------------------------------- XML parsing

def test_parse_articles_reads_the_fields_that_matter():
    xml = b"""<?xml version="1.0"?><PubmedArticleSet><PubmedArticle>
    <MedlineCitation><PMID>12345</PMID>
      <Article>
        <Journal><ISOAbbreviation>N Engl J Med</ISOAbbreviation>
          <JournalIssue><Volume>380</Volume><Issue>2</Issue>
            <PubDate><Year>2019</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>A trial of something</ArticleTitle>
        <Pagination><MedlinePgn>101-9</MedlinePgn></Pagination>
        <Abstract>
          <AbstractText Label="METHODS">We randomised 100 adults.</AbstractText>
          <AbstractText Label="RESULTS">It worked (RR 0.5).</AbstractText>
        </Abstract>
        <AuthorList><Author><LastName>Bloggs</LastName><Initials>J</Initials></Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType>Randomized Controlled Trial</PublicationType>
        </PublicationTypeList>
        <ELocationID EIdType="doi">10.1000/xyz</ELocationID>
      </Article>
      <CoiStatement>Dr Bloggs reports grants from Acme Pharma.</CoiStatement>
      <MeshHeadingList><MeshHeading><DescriptorName>Vitamin D</DescriptorName>
        </MeshHeading></MeshHeadingList>
      <CommentsCorrectionsList>
        <CommentsCorrections RefType="ErratumIn"><PMID>999</PMID>
          <RefSource>N Engl J Med 2019</RefSource></CommentsCorrections>
      </CommentsCorrectionsList>
    </MedlineCitation></PubmedArticle></PubmedArticleSet>"""
    a = parse_articles(xml)[0]
    assert a.pmid == "12345" and a.year == 2019
    assert a.journal == "N Engl J Med" and a.volume == "380" and a.pages == "101-9"
    assert a.doi == "10.1000/xyz"
    assert "METHODS:" in a.abstract and "RESULTS:" in a.abstract
    assert a.mesh_terms == ["Vitamin D"]
    assert a.has_erratum and not a.is_retracted
    assert a.industry_funded is True
    assert "Bloggs J" in a.authors
    print("ok  the XML parser reads DOIs, MeSH, errata and conflict statements")


def test_parser_survives_malformed_input():
    assert parse_articles(b"not xml at all") == []
    assert parse_articles(b"<PubmedArticleSet></PubmedArticleSet>") == []
    print("ok  a malformed response yields no articles rather than an exception")


# -------------------------------------------------- rule-only equivalence

def test_pipeline_works_with_the_networks_disabled():
    r = query.ask("Does vitamin D prevent respiratory infections?",
                  current_year=YEAR, use_nn=False, _search=_searcher(SAMPLE))
    assert r.evidence and r.body.overall_strength != "none"
    assert all(e.grade.classified_by == "rule" for e in r.evidence)
    assert all(not e.grade.safeguards for e in r.evidence), \
        "the safeguard reader is a network and must be off"
    # Stance is *not* a network — it is the rule engine in strata.stance — so it
    # keeps working here, and the consensus meter survives --no-nn intact.
    assert any(e.grade.stance for e in r.evidence)
    assert r.consensus.direction != "insufficient"
    print("ok  with STRATA_NO_NN the rule-based grader carries the whole pipeline")


def test_stance_abstains_rather_than_guessing():
    from strata import stance as stance_mod

    clear = stance_mod.from_rules(
        "CONCLUSIONS: Treatment significantly reduced mortality and these "
        "findings support its use.")
    assert clear.label == "supports" and clear.decided_by == "rules"

    # Nothing to go on: no cue words at all.
    assert stance_mod.from_rules(
        "CONCLUSIONS: We describe the cohort's baseline characteristics.").label is None

    # A non-significant interval overrides prose that claims a direction.
    effect = stats.EffectSize("RR", 0.94, 0.87, 1.01)
    hedged = stance_mod.infer(
        "CONCLUSIONS: Mortality was significantly reduced with the drug.", effect)
    assert hedged.label == "no_effect" and hedged.decided_by == "rules+interval", \
        "an interval spanning the null beats an over-claiming conclusion"
    print("ok  stance abstains on silence and lets the interval veto the prose")


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        fn()
    print(f"\nall {len(tests)} pipeline tests passed")
