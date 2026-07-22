"""Adversarial probes: the cases a keyword rule gets wrong.

The seed corpus scores very high, and a high score on a corpus you generated
yourself is not evidence of much. This file is the counterweight — a small set of
hand-written passages where the *surface vocabulary points at the wrong answer*
and only reading the sentence gets it right.

Every probe is deliberately unfair to keyword matching:

* a cohort study that says "randomised" three times, because it followed the
  participants of a trial after the trial ended
* a narrative review that discusses randomised trials at length
* a systematic review whose included studies are cohorts, so it reads
  observational throughout
* a trial that never uses the word "randomised", only "allocated by a
  computer-generated sequence"
* an animal study randomised to vehicle, which is a real randomisation and still
  not clinical evidence

These are written by hand and are not real PubMed abstracts; they are a
regression test for a specific failure mode, not a benchmark. Run them with
``strata nn eval --probes``. A rule-based grader scores far worse here than on
the seed corpus, which is the point: the gap is what the network is buying.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Probe:
    text: str
    design: str
    why: str
    stance: str | None = None
    rigour: frozenset = frozenset()


PROBES: list[Probe] = [
    Probe(
        text=("Long-term outcomes after the FLOURISH trial: observational "
              "follow-up. METHODS: We report the post-trial follow-up of 2,140 "
              "participants originally randomised to sitagliptin or placebo. "
              "After the randomised phase ended, allocation no longer determined "
              "treatment and participants were managed at their clinician's "
              "discretion. These analyses are therefore observational and subject "
              "to confounding by indication; estimates were adjusted for baseline "
              "covariates. RESULTS: Mortality did not differ significantly "
              "(hazard ratio 0.96, 95% CI 0.82 to 1.12)."),
        design="cohort", stance="no_effect",
        rigour=frozenset({"confounding_adjusted"}),
        why="says 'randomised' twice but the analysed period is observational"),

    Probe(
        text=("Anticoagulation in frail older adults: a clinical perspective. "
              "The last decade has produced four large randomised controlled "
              "trials of direct oral anticoagulants, and their results are "
              "frequently over-extrapolated to patients who were never enrolled. "
              "Here we walk through those trials, discuss where their populations "
              "diverge from the frail patients we actually see, and offer a "
              "pragmatic approach. Literature was identified through the authors' "
              "own reading; no protocol was registered and no formal appraisal "
              "was undertaken."),
        design="narrative_review", stance="unclear",
        why="discusses four RCTs in detail but is itself an opinion piece"),

    Probe(
        text=("Dietary sodium and cardiovascular events: a systematic review and "
              "meta-analysis of prospective cohort studies. METHODS: We searched "
              "four databases to identify prospective cohorts reporting sodium "
              "intake and incident cardiovascular disease. Nineteen cohorts "
              "comprising 412,000 participants were included. Study-level "
              "estimates, each adjusted for age, sex, smoking and body mass "
              "index, were pooled using random-effects models. The protocol was "
              "deposited in PROSPERO ahead of the search. RESULTS: Higher intake "
              "was associated with more events (relative risk 1.16, 95% CI 1.07 "
              "to 1.26); heterogeneity was substantial (I2 = 71%)."),
        design="systematic_review", stance="against",
        rigour=frozenset({"registered", "confounding_adjusted"}),
        why="reads as a cohort study throughout; it is a review *of* cohorts"),

    Probe(
        text=("Effect of a nurse-led sleep protocol on delirium in intensive "
              "care. METHODS: Consecutive eligible patients were assigned to the "
              "protocol or usual care using a computer-generated allocation "
              "sequence held centrally and concealed from the enrolling nurse. "
              "Delirium was scored twice daily by assessors unaware of group "
              "assignment. All patients were analysed in the group to which they "
              "were assigned. RESULTS: Delirium was less frequent with the "
              "protocol (risk ratio 0.71, 95% CI 0.56 to 0.90; p = 0.005)."),
        design="rct", stance="supports",
        rigour=frozenset({"randomised", "blinded", "itt"}),
        why="never uses the word 'randomised' — only describes the mechanism"),

    Probe(
        text=("Semaglutide attenuates hepatic steatosis in a diet-induced murine "
              "model. METHODS: Forty male C57BL/6 mice were randomly assigned to "
              "semaglutide or vehicle after twelve weeks of a high-fat diet. "
              "Investigators scoring the histology were blinded to group. Hepatic "
              "triglyceride content was the primary endpoint. RESULTS: Steatosis "
              "was significantly reduced in treated animals (p = 0.002). "
              "CONCLUSIONS: These preclinical findings support further study; "
              "they cannot be extrapolated to human disease."),
        design="preclinical", stance="supports",
        rigour=frozenset({"randomised", "blinded"}),
        why="a genuine randomised, blinded experiment — in mice"),

    Probe(
        text=("Association between proton pump inhibitor use and hip fracture. "
              "METHODS: Within a national dispensing registry we identified all "
              "8,900 adults who sustained a first hip fracture and, for each, "
              "four comparison subjects matched on age, sex and region who had "
              "not. Prior dispensing of proton pump inhibitors was ascertained "
              "from the same registry, blind to outcome status. Conditional "
              "logistic regression adjusted for osteoporosis, corticosteroid use "
              "and prior fracture. RESULTS: Odds of prior use were higher among "
              "those who fractured (odds ratio 1.29, 95% CI 1.18 to 1.41)."),
        design="case_control", stance="against",
        rigour=frozenset({"blinded", "confounding_adjusted"}),
        why="never says 'case-control'; describes the design instead"),

    Probe(
        text=("Burnout among emergency physicians: a national survey. METHODS: "
              "In March we invited all 6,200 registered emergency physicians to "
              "complete the Maslach Burnout Inventory once. 3,410 responded (55%). "
              "Associations between shift pattern and burnout score were examined "
              "with multivariable linear regression adjusted for age, sex and "
              "years in practice. Because exposure and outcome were captured at "
              "the same moment, no temporal ordering can be inferred. RESULTS: "
              "Night-shift frequency was associated with higher scores."),
        design="cross_sectional", stance="against",
        rigour=frozenset({"confounding_adjusted"}),
        why="'survey' plus a regression — often mistaken for a cohort"),

    Probe(
        text=("Fulminant myocarditis following a second dose of an mRNA vaccine. "
              "A previously healthy 24-year-old presented with chest pain and a "
              "troponin of 41,000 ng/L three days after vaccination. Coronary "
              "angiography was normal and cardiac MRI showed subepicardial late "
              "gadolinium enhancement. He recovered fully. Causality cannot be "
              "established from a single observation, and the background "
              "incidence of myocarditis in this age group is not negligible."),
        design="case_report", stance="unclear",
        why="a large number and a strong signal, but n = 1"),

    Probe(
        text=("Tranexamic acid in traumatic brain injury: a pragmatic, "
              "registry-embedded trial. METHODS: Patients were enrolled at 44 "
              "centres and allocated 1:1 by a central web service. Because the "
              "comparator was open saline, masking of treating clinicians was not "
              "possible; the outcome adjudication committee remained blinded. "
              "The sample size of 12,700 was fixed in advance to detect a 2% "
              "absolute difference in 28-day mortality with 90% power. The "
              "protocol was registered before enrolment. RESULTS: Mortality was "
              "18.5% versus 19.8% (risk ratio 0.94, 95% CI 0.87 to 1.01; "
              "p = 0.09)."),
        design="rct", stance="no_effect",
        rigour=frozenset({"randomised", "blinded", "powered", "registered"}),
        why="open-label but blinded adjudication; a near-miss result"),

    Probe(
        text=("Machine learning prediction of sepsis from vital signs: a "
              "retrospective analysis. METHODS: We extracted 210,000 admissions "
              "from a single centre's electronic record between 2014 and 2022 and "
              "followed each from admission until sepsis, discharge or death. "
              "Models were trained on the first six years and evaluated on the "
              "last two. Patients were not assigned to anything; this is an "
              "observational analysis of routinely collected data and the "
              "associations reported are not causal."),
        design="cohort", stance="unclear",
        why="a modelling paper on longitudinal observational data"),

    Probe(
        text=("Do we still need routine chest radiography before elective "
              "surgery? EDITORIAL. Three decades of accumulated evidence, "
              "including a Cochrane review and at least two randomised trials, "
              "suggest the answer is no for most patients. Yet the practice "
              "persists. We argue that the barrier is institutional habit rather "
              "than clinical uncertainty, and propose three concrete steps for "
              "departments willing to stop. These views are our own."),
        design="narrative_review", stance="against",
        why="cites a Cochrane review and RCTs while being an editorial"),

    Probe(
        text=("Vaccine effectiveness against hospitalisation: a test-negative "
              "design. METHODS: Among 19,400 adults hospitalised with acute "
              "respiratory illness and tested by PCR, those testing positive were "
              "treated as cases and those testing negative as controls. This "
              "design reduces confounding by health-seeking behaviour, since both "
              "groups presented for care. Vaccination status was obtained from "
              "the national register. Estimates were adjusted for age, calendar "
              "week and comorbidity. RESULTS: Adjusted effectiveness was 62% "
              "(95% CI 55 to 68)."),
        design="case_control", stance="supports",
        rigour=frozenset({"confounding_adjusted"}),
        why="test-negative designs are case-control and rarely say so plainly"),

    Probe(
        text=("Umbilical cord milking versus delayed clamping in preterm "
              "infants: a two-period crossover trial in 18 units. METHODS: Units "
              "were assigned in random order to each strategy for six months, "
              "separated by a two-month washout. The period-by-treatment "
              "interaction was tested before the primary comparison. Outcome "
              "assessors were masked. RESULTS: Intraventricular haemorrhage did "
              "not differ (risk ratio 1.03, 95% CI 0.84 to 1.26)."),
        design="rct", stance="no_effect",
        rigour=frozenset({"randomised", "blinded"}),
        why="crossover at the unit level is still randomised allocation"),

    Probe(
        text=("Three patients with refractory pemphigus treated with "
              "rituximab. We report a consecutive series of three patients "
              "managed at a single centre over four years. All three achieved "
              "clinical remission within twelve weeks. There was no comparison "
              "group, patients were not consecutively enrolled by protocol, and "
              "the natural history of the disease includes spontaneous "
              "remission; these observations are hypothesis-generating."),
        design="case_report", stance="supports",
        why="a striking response rate from three uncontrolled patients"),

    Probe(
        text=("Comparative effectiveness of two biologics in rheumatoid "
              "arthritis: a target-trial emulation. METHODS: We specified the "
              "protocol of the head-to-head randomised trial that has never been "
              "conducted and emulated it in claims data covering 44,000 new "
              "users. Cloning, censoring and inverse-probability weighting were "
              "used to align eligibility, treatment assignment and follow-up, "
              "eliminating the immortal time a naive analysis would introduce. No "
              "patient was actually assigned by the investigators."),
        design="cohort", stance="unclear",
        rigour=frozenset({"confounding_adjusted"}),
        why="'trial' appears repeatedly; the data are entirely observational"),

    Probe(
        text=("Network meta-analysis of first-line therapies for advanced "
              "melanoma. METHODS: Forty-one randomised trials were combined in a "
              "Bayesian random-effects framework, allowing indirect comparison of "
              "regimens never tested against one another. Treatments were ranked "
              "by SUCRA and the consistency assumption examined by node-splitting. "
              "The protocol was pre-registered. RESULTS: Combination therapy "
              "ranked highest for overall survival, though credible intervals for "
              "several pairwise comparisons were wide."),
        design="systematic_review", stance="supports",
        rigour=frozenset({"registered"}),
        why="a synthesis of trials, not a trial"),

    Probe(
        text=("Effect of a workplace standing desk intervention on "
              "musculoskeletal pain. METHODS: Two departments were selected by "
              "management to receive height-adjustable desks; two comparable "
              "departments continued as usual. Assignment was not random and "
              "staff were aware of their allocation. Pain scores were compared at "
              "six months, adjusted for baseline score and job role. RESULTS: "
              "Pain fell more in the intervention departments (mean difference "
              "-0.8 points, 95% CI -1.4 to -0.2)."),
        design="cohort", stance="supports",
        rigour=frozenset({"confounding_adjusted"}),
        why="an intervention study that was explicitly not randomised"),

    Probe(
        text=("Prevalence of undiagnosed atrial fibrillation in community "
              "pharmacies. METHODS: Over four weeks, single-lead ECGs were "
              "recorded once from 11,200 adults aged over 65 attending 240 "
              "pharmacies. Recordings were over-read by a cardiologist. We report "
              "the proportion with previously undocumented atrial fibrillation "
              "and its distribution by age and sex. No follow-up was undertaken."),
        design="cross_sectional", stance="unclear",
        why="a one-off screening snapshot with a very large n"),

    Probe(
        text=("Gut microbiome composition and response to checkpoint blockade. "
              "METHODS: Faecal samples from 38 patients were sequenced before "
              "treatment. Germ-free mice were then colonised with samples from "
              "responders and non-responders and challenged with syngeneic "
              "tumours. Tumour growth and intratumoural T-cell infiltration were "
              "compared between colonisation groups. RESULTS: Mice colonised with "
              "responder microbiota showed slower tumour growth (p < 0.001)."),
        design="preclinical", stance="supports",
        why="human samples, but the experiment and the result are in mice"),

    Probe(
        text=("Statins and incident diabetes: a nested case-control study "
              "within the CPRD cohort. METHODS: From a base cohort of 1.2 million "
              "patients we identified 32,000 incident diabetes cases and selected "
              "controls by incidence-density sampling, preserving the underlying "
              "cohort's follow-up structure so the odds ratio estimates the "
              "incidence rate ratio. Cumulative statin exposure was categorised "
              "and a test for trend was prespecified. Models adjusted for body "
              "mass index and baseline glucose."),
        design="case_control", stance="against",
        rigour=frozenset({"confounding_adjusted"}),
        why="nested inside a cohort and says 'cohort' three times"),

    Probe(
        text=("Efficacy and safety of a novel antiviral: results of a phase 3 "
              "programme. METHODS: 1,850 participants across two identically "
              "designed studies received drug or matching placebo in a 2:1 ratio "
              "according to a permuted-block schedule stratified by site. "
              "Participants, investigators and the sponsor remained masked until "
              "database lock. The primary analysis population comprised all who "
              "received at least one dose, in their assigned group. RESULTS: Time "
              "to resolution was shorter with the antiviral (hazard ratio 1.38, "
              "95% CI 1.19 to 1.60; p < 0.001)."),
        design="rct", stance="supports",
        rigour=frozenset({"randomised", "blinded", "itt"}),
        why="industry phase 3 phrasing; 'permuted-block schedule', not 'randomised'"),

    Probe(
        text=("Trends in opioid prescribing, 2010 to 2023: a repeated "
              "cross-sectional analysis. METHODS: We analysed twelve consecutive "
              "annual snapshots of a nationally representative prescribing "
              "sample, each a separate cross-section of a different set of "
              "practices. Because no practice is followed over time, these data "
              "describe the population year by year and cannot describe change "
              "within any individual prescriber."),
        design="cross_sectional", stance="unclear",
        why="spans thirteen years and is still not longitudinal"),
]


def evaluate_design(net) -> dict:
    """Score a design classifier on the probes. Returns per-probe outcomes."""
    rows = []
    correct = 0
    for p in PROBES:
        pred = net.predict(p.text, explain=False)
        ok = pred.label == p.design
        correct += ok
        rows.append({"expected": p.design, "predicted": pred.label,
                     "confident": pred.is_confident,
                     "confidence": round(pred.confidence, 3),
                     "ok": ok, "why": p.why})
    return {"n": len(PROBES), "correct": correct,
            "accuracy": correct / len(PROBES) if PROBES else 0.0, "rows": rows}


def evaluate_stance(net=None) -> dict:
    """Score direction-of-finding on the probes.

    Scores :mod:`strata.stance` — the rule-and-interval engine that actually runs
    in the pipeline — not a network. Pass ``net`` to score a stance classifier
    you have trained instead; this is the comparison that retired the shipped one.

    Because the engine abstains, *coverage* and *precision* are reported
    separately. A tool that labels half the papers correctly and says nothing
    about the rest is more useful for a consensus meter than one that labels all
    of them and gets a third right.
    """
    from .. import stance as stance_mod
    from ..stats import extract_effects, primary_effect

    labelled = [p for p in PROBES if p.stance]
    rows, correct, fired = [], 0, 0
    for p in labelled:
        if net is not None:
            pred = net.predict(p.text, explain=False)
            label, by, conf = pred.label, "network", pred.confidence
        else:
            effect = primary_effect(extract_effects(p.text))
            res = stance_mod.infer(p.text, effect)
            label, by, conf = res.label, res.decided_by, res.confidence
        ok = label == p.stance
        if label is not None:
            fired += 1
            correct += ok
        rows.append({"expected": p.stance, "predicted": label, "decided_by": by,
                     "confidence": round(conf, 3), "ok": ok})

    n = len(labelled)
    return {"n": n, "fired": fired, "correct": correct,
            "coverage": fired / n if n else 0.0,
            "precision": correct / fired if fired else 0.0,
            "accuracy": correct / n if n else 0.0, "rows": rows}


def evaluate_rigour(net) -> dict:
    """Precision and recall over the safeguards asserted in the probes.

    Only probes that declare a ``rigour`` set are scored, since an empty set on
    an unannotated probe would count every prediction as a false positive.
    """
    scored = [p for p in PROBES if p.rigour]
    tp = fp = fn = 0
    rows = []
    for p in scored:
        got = set(net.predict_labels(p.text).present)
        want = set(p.rigour)
        tp += len(got & want)
        fp += len(got - want)
        fn += len(want - got)
        rows.append({"expected": sorted(want), "predicted": sorted(got),
                     "missed": sorted(want - got), "spurious": sorted(got - want)})
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {"n": len(scored), "precision": prec, "recall": rec, "f1": f1,
            "rows": rows}
