"""Training data for the Strata networks.

Two sources, and it matters which one you are using.

**Harvested (preferred).** ``strata nn harvest`` pulls real records from PubMed
and labels them from NLM's own ``PublicationType`` tags. Those tags are curated
by human indexers, so for study design this is genuine supervision, not a guess.
Stance has no equivalent tag, so harvested abstracts are labelled by the weak
rules in :func:`weak_stance` — high precision, low recall, deliberately
abstaining rather than guessing. The network then generalises past the rules'
vocabulary, which is the entire point of training one.

**Seed (shipped).** The weights committed to this repository are trained on
:func:`seed_corpus`, a generator that composes abstracts from the reporting
language the major guidelines prescribe — CONSORT for trials, PRISMA for reviews,
STROBE for observational studies, CARE for case reports, ARRIVE for animal work.
It is synthetic and it is labelled as such everywhere it surfaces. It exists so
that a fresh clone trains and runs without a network round-trip.

One rule governs the generator: **topic and label are independent.** The same
list of clinical topics feeds every design and every stance, so there is no route
by which the model can learn "statins → RCT" or "homeopathy → no effect". The
only thing that separates the classes is methodological and results phrasing,
which is the thing we actually want it to read.
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass

from ..stance import weak_label

# --------------------------------------------------------------------- labels

DESIGN_LABELS = [
    "systematic_review", "rct", "cohort", "case_control",
    "cross_sectional", "case_report", "narrative_review", "preclinical",
]

#: Where each predicted design sits on the evidence pyramid.
DESIGN_LEVEL = {
    "systematic_review": 1, "rct": 2, "cohort": 3, "case_control": 4,
    "cross_sectional": 4, "case_report": 5, "narrative_review": 6,
    "preclinical": 7,
}

DESIGN_DISPLAY = {
    "systematic_review": "Systematic review / meta-analysis",
    "rct": "Randomised controlled trial",
    "cohort": "Cohort study",
    "case_control": "Case-control study",
    "cross_sectional": "Cross-sectional study",
    "case_report": "Case report / series",
    "narrative_review": "Narrative review / opinion",
    "preclinical": "Preclinical (animal / in vitro)",
}

STANCE_LABELS = ["supports", "no_effect", "against", "unclear"]

STANCE_DISPLAY = {
    "supports": "Supports benefit",
    "no_effect": "Found no effect",
    "against": "Found harm or no benefit",
    "unclear": "Inconclusive",
}

#: Methodological safeguards, predicted independently of one another. These are
#: the concrete things GRADE's "risk of bias" domain is asking about, and the
#: vocabulary that expresses them is topic-independent — which is precisely what
#: makes them learnable from a corpus this size.
RIGOUR_LABELS = ["randomised", "blinded", "registered", "itt", "powered",
                 "confounding_adjusted"]

RIGOUR_DISPLAY = {
    "randomised": "Random allocation",
    "blinded": "Blinding / masking",
    "registered": "Prospective registration",
    "itt": "Intention-to-treat analysis",
    "powered": "A priori power calculation",
    "confounding_adjusted": "Adjustment for confounding",
}

#: What each safeguard is worth when scoring a study's internal validity. Random
#: allocation and blinding dominate because they address selection and detection
#: bias, the two that most often reverse a result.
RIGOUR_WEIGHT = {"randomised": 0.30, "blinded": 0.22, "registered": 0.14,
                 "itt": 0.12, "powered": 0.10, "confounding_adjusted": 0.12}

#: NLM PublicationType -> design label. Used by the harvester.
PUBTYPE_TO_DESIGN = {
    "meta-analysis": "systematic_review",
    "systematic review": "systematic_review",
    "randomized controlled trial": "rct",
    "controlled clinical trial": "rct",
    "pragmatic clinical trial": "rct",
    "equivalence trial": "rct",
    "adaptive clinical trial": "rct",
    "observational study": "cohort",
    "case reports": "case_report",
    "review": "narrative_review",
    "editorial": "narrative_review",
    "comment": "narrative_review",
    "letter": "narrative_review",
    "news": "narrative_review",
    "historical article": "narrative_review",
}


@dataclass
class Example:
    """One labelled record. ``stance`` is None when no rule fired.

    ``topic_id`` and ``template_id`` exist so the split can be made disjoint in
    both — see :func:`split` for why holding out only one of them flatters the
    model badly. ``rigour`` is a set of safeguard labels and is exact by
    construction on the seed corpus: a flag is set if and only if the generator
    inserted language asserting it.
    """
    text: str
    design: str
    stance: str | None
    question: str
    topic_id: int
    source: str = "seed"
    template_id: int = -1
    rigour: frozenset = frozenset()
    rigour_variant: int = -1


# ------------------------------------------------------------- topic material
# Deliberately broad and deliberately shared across every label. Fields are
# (intervention, condition, population, outcome, short noun for the title).

TOPICS = [
    ("vitamin D supplementation", "acute respiratory infection", "community-dwelling adults", "infection incidence", "vitamin D"),
    ("metformin", "type 2 diabetes", "adults with type 2 diabetes", "cardiovascular mortality", "metformin"),
    ("statin therapy", "hyperlipidaemia", "primary-prevention patients", "major adverse cardiac events", "statins"),
    ("intermittent fasting", "obesity", "adults with a BMI above 30", "body weight at 12 months", "intermittent fasting"),
    ("cognitive behavioural therapy", "major depressive disorder", "outpatients with moderate depression", "symptom remission", "CBT"),
    ("early mobilisation", "critical illness", "mechanically ventilated ICU patients", "ventilator-free days", "early mobilisation"),
    ("tranexamic acid", "traumatic haemorrhage", "trauma patients with active bleeding", "28-day mortality", "tranexamic acid"),
    ("omega-3 fatty acids", "cardiovascular disease", "adults at elevated cardiovascular risk", "myocardial infarction", "omega-3"),
    ("probiotic supplementation", "antibiotic-associated diarrhoea", "hospitalised adults on antibiotics", "diarrhoea incidence", "probiotics"),
    ("mindfulness-based stress reduction", "chronic pain", "adults with chronic low back pain", "pain intensity", "mindfulness"),
    ("proton pump inhibitors", "gastro-oesophageal reflux", "adults with reflux symptoms", "symptom-free days", "PPIs"),
    ("physiotherapy", "knee osteoarthritis", "adults over 50 with knee osteoarthritis", "WOMAC function score", "physiotherapy"),
    ("aspirin", "colorectal cancer", "average-risk adults over 50", "cancer incidence", "aspirin"),
    ("melatonin", "insomnia", "adults with chronic insomnia", "sleep-onset latency", "melatonin"),
    ("telemedicine follow-up", "heart failure", "patients discharged after heart failure", "30-day readmission", "telemedicine"),
    ("SGLT2 inhibitors", "chronic kidney disease", "adults with albuminuric CKD", "eGFR decline", "SGLT2 inhibitors"),
    ("antenatal corticosteroids", "preterm birth", "women at risk of preterm delivery", "neonatal respiratory distress", "antenatal steroids"),
    ("smoking cessation counselling", "tobacco dependence", "adult smokers in primary care", "12-month abstinence", "cessation counselling"),
    ("high-flow nasal oxygen", "acute hypoxaemic respiratory failure", "adults in the emergency department", "intubation rate", "high-flow oxygen"),
    ("exercise training", "chronic heart failure", "patients with reduced ejection fraction", "peak VO2", "exercise training"),
    ("iron supplementation", "iron-deficiency anaemia", "menstruating women", "haemoglobin concentration", "iron supplementation"),
    ("cranberry extract", "recurrent urinary tract infection", "women with recurrent UTI", "infection recurrence", "cranberry"),
    ("dexamethasone", "severe pneumonia", "hospitalised adults with pneumonia", "in-hospital mortality", "dexamethasone"),
    ("gabapentin", "neuropathic pain", "adults with diabetic neuropathy", "pain score reduction", "gabapentin"),
    ("bariatric surgery", "severe obesity", "adults with a BMI above 40", "diabetes remission", "bariatric surgery"),
    ("influenza vaccination", "seasonal influenza", "adults over 65", "hospitalisation for influenza", "influenza vaccine"),
    ("continuous glucose monitoring", "type 1 diabetes", "adolescents with type 1 diabetes", "HbA1c", "CGM"),
    ("music therapy", "postoperative anxiety", "adults undergoing elective surgery", "anxiety score", "music therapy"),
    ("antibiotic prophylaxis", "surgical site infection", "patients undergoing colorectal surgery", "wound infection rate", "antibiotic prophylaxis"),
    ("vitamin C", "sepsis", "adults with septic shock", "vasopressor-free days", "vitamin C"),
    ("acupuncture", "chronic migraine", "adults with episodic migraine", "monthly migraine days", "acupuncture"),
    ("home blood-pressure monitoring", "hypertension", "adults with uncontrolled hypertension", "systolic blood pressure", "home BP monitoring"),
    ("low-FODMAP diet", "irritable bowel syndrome", "adults with IBS", "symptom severity score", "low-FODMAP diet"),
    ("prehabilitation", "major abdominal surgery", "patients awaiting elective resection", "postoperative complications", "prehabilitation"),
    ("anticoagulation", "atrial fibrillation", "older adults with atrial fibrillation", "ischaemic stroke", "anticoagulation"),
    ("screen-time reduction", "adolescent depression", "adolescents aged 13 to 17", "depressive symptom score", "screen-time reduction"),
    ("topical corticosteroids", "atopic dermatitis", "children with moderate eczema", "eczema area severity index", "topical steroids"),
    ("hearing aids", "age-related hearing loss", "adults over 70", "cognitive decline", "hearing aids"),
    ("methotrexate", "rheumatoid arthritis", "patients with early rheumatoid arthritis", "ACR20 response", "methotrexate"),
    ("nurse-led discharge planning", "hospital readmission", "older medical inpatients", "unplanned readmission", "discharge planning"),
    ("sodium restriction", "resistant hypertension", "adults on three antihypertensives", "ambulatory blood pressure", "sodium restriction"),
    ("virtual reality distraction", "procedural pain", "children undergoing venipuncture", "self-reported pain", "VR distraction"),
]


# ------------------------------------------------------- design-specific text
# Phrasing follows the reporting checklist each design is written to. Every
# template takes the same slots, so no topic is tied to a design.

_TITLES = {
    "systematic_review": [
        "{noun} for {condition}: a systematic review and meta-analysis",
        "Effect of {intervention} on {outcome}: a meta-analysis of randomised trials",
        "{noun} in {condition}: a systematic review of the evidence",
        "Association between {intervention} and {outcome}: a meta-analysis",
    ],
    "rct": [
        "A randomised controlled trial of {intervention} in {condition}",
        "{noun} versus placebo for {condition}: a double-blind randomised trial",
        "Effect of {intervention} on {outcome} in {population}: a randomised clinical trial",
        "{noun} for {condition}: a multicentre, open-label randomised trial",
    ],
    "cohort": [
        "{noun} and {outcome} in {population}: a prospective cohort study",
        "Long-term {outcome} after {intervention}: a population-based cohort study",
        "A retrospective cohort study of {intervention} in {condition}",
        "Incidence of {outcome} among {population}: a prospective cohort",
    ],
    "case_control": [
        "{noun} and risk of {outcome}: a matched case-control study",
        "A case-control study of {intervention} in {condition}",
        "Prior {intervention} and subsequent {outcome}: a nested case-control study",
    ],
    "cross_sectional": [
        "Prevalence of {condition} and its association with {intervention}: a cross-sectional survey",
        "A cross-sectional study of {intervention} among {population}",
        "{noun} use and {outcome}: a national cross-sectional analysis",
    ],
    "case_report": [
        "{noun}-associated {outcome}: a case report",
        "An unusual presentation of {condition} following {intervention}: a case report",
        "Three cases of {condition} treated with {intervention}: a case series",
    ],
    "narrative_review": [
        "{noun} in {condition}: a narrative review",
        "Rethinking {intervention} for {condition}: a clinical perspective",
        "{noun}: what the clinician needs to know",
        "The case for wider use of {intervention} in {condition}: an editorial",
    ],
    "preclinical": [
        "{noun} attenuates {condition} in a murine model",
        "Effects of {intervention} on {outcome} in vitro",
        "{noun} modulates inflammatory signalling in a rat model of {condition}",
    ],
}

# Six method templates per design. The later entries in each list are the hard
# ones — designs described in unusual words, or borrowing another design's
# vocabulary wholesale. A cohort study that says "randomised" and a narrative
# review that says "we reviewed the randomised trials" are the cases where a
# keyword rule fails and a model has to read the sentence.
_METHODS = {
    "systematic_review": [
        "METHODS: We searched MEDLINE, Embase and the Cochrane Central Register from inception to March, without language restriction. Two reviewers independently screened records and extracted data; disagreements were resolved by a third. Risk of bias was assessed with the Cochrane RoB 2 tool and the certainty of evidence with GRADE. Random-effects models were used to pool {measure}, with heterogeneity quantified by I².",
        "METHODS: This review was registered with PROSPERO and reported according to the PRISMA statement. Eligible studies were randomised trials of {intervention} in {population} reporting {outcome}. We pooled data using a DerSimonian-Laird random-effects model and assessed publication bias with funnel plots and Egger's test.",
        "METHODS: Randomised and quasi-randomised trials were eligible. After duplicate screening of {nstudies} records, {nincluded} studies comprising {n} participants met the inclusion criteria. Pooled estimates were calculated as {measure} with 95% confidence intervals; subgroup analyses were prespecified by dose and duration.",
        "METHODS: We pooled individual participant data from {nincluded} prospective cohort studies of {population}, totalling {n} people. One-stage mixed-effects models estimated the association between {intervention} and {outcome}, with study fitted as a random effect. Between-study heterogeneity was I² = {i2}%.",
        "METHODS: In this network meta-analysis, {nincluded} trials comparing {intervention} with other active options were combined within a Bayesian random-effects framework. Treatments were ranked by surface under the cumulative ranking curve, and the consistency assumption was checked by node-splitting.",
        "METHODS: We updated a previous synthesis, screening {nstudies} newly indexed records against protocol criteria. Certainty for {outcome} was downgraded for imprecision and risk of bias following the GRADE approach. Quantitative pooling was performed where studies were sufficiently similar in population and comparator.",
    ],
    "rct": [
        "METHODS: In this double-blind, placebo-controlled trial we randomly assigned {n} {population} in a 1:1 ratio to {intervention} or matching placebo. Randomisation used permuted blocks with stratification by site, and participants, clinicians and outcome assessors were masked to allocation. The primary outcome was {outcome} at {months} months, analysed by intention to treat.",
        "METHODS: We conducted a multicentre, open-label, parallel-group randomised trial at {sites} centres. {n} eligible {population} were allocated by a central web-based system to {intervention} or usual care. The prespecified primary endpoint was {outcome}; analyses followed the intention-to-treat principle and the trial was registered before enrolment.",
        "METHODS: Participants were randomly assigned to receive {intervention} or placebo for {months} months. The trial was powered to detect a clinically important difference in {outcome} with 90% power at a two-sided alpha of 0.05. An independent data monitoring committee reviewed one prespecified interim analysis.",
        "METHODS: This was a cluster-randomised, stepped-wedge trial across {sites} clinics serving {population}. Clusters crossed from control to {intervention} in a computer-generated random order. Mixed models for {outcome} accounted for clustering and secular trend; individual masking was not feasible.",
        "METHODS: We used a two-period crossover design. {n} {population} received {intervention} and control in random order separated by a {months}-month washout. Carryover was assessed by testing the period-by-treatment interaction before the primary within-patient comparison of {outcome}.",
        "METHODS: In this pragmatic non-inferiority trial, {n} {population} were allocated to {intervention} or standard care with a prespecified non-inferiority margin for {outcome}. Allocation was concealed until enrolment; outcome adjudication was blinded although treatment was not.",
    ],
    "cohort": [
        "METHODS: We prospectively followed {n} {population} enrolled between 2009 and 2019. Exposure to {intervention} was recorded at baseline and updated at each visit. Incident {outcome} was ascertained through linkage to national registries. Cox proportional-hazards models were adjusted for age, sex, smoking, comorbidity and socioeconomic status, and the proportional-hazards assumption was tested with Schoenfeld residuals.",
        "METHODS: This retrospective cohort study used routinely collected electronic health records from {sites} practices. {n} {population} were followed from first exposure to {intervention} until {outcome}, death or end of follow-up. Confounding was addressed with inverse-probability-of-treatment weighting on a propensity score, and residual confounding was probed with an E-value.",
        "METHODS: In a population-based cohort of {n} {population}, we compared {outcome} between those exposed and unexposed to {intervention} over a median follow-up of {years} years. Analyses were adjusted for prespecified confounders; a new-user, active-comparator design was used to limit immortal-time bias.",
        "METHODS: We report the long-term observational follow-up of {n} {population} originally enrolled in a randomised trial. After the trial ended, allocation no longer determined treatment and participants were followed under usual care, so these analyses are observational and subject to confounding by indication.",
        "METHODS: Groups were not randomly assigned. {n} {population} receiving {intervention} were propensity-score matched 1:1 to concurrent comparators on {sites} baseline covariates, and balance was checked with standardised mean differences. {outcome} was compared over {years} years of follow-up.",
        "METHODS: Using a target-trial emulation framework, we specified the protocol of the randomised trial we would have run and emulated it in registry data covering {n} {population}. Cloning, censoring and inverse-probability weighting addressed the immortal time that a naive analysis of {intervention} would introduce.",
    ],
    "case_control": [
        "METHODS: We identified {ncases} incident cases of {outcome} and matched each to {ratio} controls by age, sex and general practice. Prior exposure to {intervention} was ascertained from dispensing records, blinded to case status. Conditional logistic regression estimated odds ratios adjusted for comorbidity and concomitant medication.",
        "METHODS: In this nested case-control analysis within a cohort of {n} {population}, cases were participants who developed {outcome} during follow-up. Controls were selected by incidence-density sampling. Exposure to {intervention} was categorised by cumulative dose, and a test for trend across categories was prespecified.",
        "METHODS: Cases were {ncases} {population} with confirmed {outcome}; controls were {population} testing negative over the same period at the same sites. This test-negative design reduces confounding by health-seeking behaviour. Odds of prior {intervention} were compared between groups.",
        "METHODS: We conducted a case-crossover analysis in which each of {ncases} patients served as their own control. Exposure to {intervention} in the {months} months before {outcome} was compared with matched earlier reference windows, eliminating time-invariant confounding by design.",
        "METHODS: Patients who developed {outcome} were compared retrospectively with unaffected patients matched on {ratio} clinical characteristics. Because exposure to {intervention} was recorded after the outcome was known, recall bias cannot be excluded and the odds ratio may be overstated.",
        "METHODS: Within a registry of {n} {population}, we selected all {ncases} who experienced {outcome} and a random sample of those who did not. Density sampling preserved the underlying cohort's follow-up structure so the odds ratio estimates the incidence rate ratio.",
    ],
    "cross_sectional": [
        "METHODS: We analysed data from a nationally representative cross-sectional survey of {n} {population}. Use of {intervention} and {outcome} were assessed at a single visit using standardised instruments. Prevalence estimates were weighted to the national population; because exposure and outcome were measured simultaneously, temporality cannot be established.",
        "METHODS: A cross-sectional survey was distributed to {n} {population} at {sites} sites. Associations between {intervention} and {outcome} were examined with multivariable logistic regression adjusted for demographic covariates. The response rate was {resp}%.",
        "METHODS: All {n} {population} attending during a single index week were assessed. Prevalence of {outcome} and concurrent use of {intervention} were recorded once, with no follow-up. Whether {intervention} preceded {outcome} could not be determined from these data.",
        "METHODS: We linked a one-off national screening round covering {n} {population} to dispensing records. Prevalence ratios for {outcome} by {intervention} status were estimated with Poisson regression and robust variance, weighted for the {resp}% participation rate.",
        "METHODS: This was a prevalence study, not a trial: participants were assessed at one point in time and no intervention was allocated. We describe the distribution of {outcome} across categories of {intervention} use among {n} {population}.",
        "METHODS: A structured questionnaire was administered once to {n} {population} sampled by stratified cluster sampling at {sites} sites. Design effects were accounted for in all estimates. The snapshot design precludes any statement about the direction of the association with {outcome}.",
    ],
    "case_report": [
        "CASE PRESENTATION: A {age}-year-old patient with {condition} presented with {outcome} shortly after starting {intervention}. Investigations excluded alternative causes, and the temporal relationship was assessed with the Naranjo adverse drug reaction probability scale. Symptoms resolved on withdrawal and the patient remained well at follow-up.",
        "CASE PRESENTATION: We describe three patients with {condition} who received {intervention}. In each, {outcome} developed within weeks. This report is descriptive; no causal inference can be drawn from an uncontrolled series, and the findings are hypothesis-generating only.",
        "CASE PRESENTATION: A previously well {age}-year-old developed {outcome} on day 9 of {intervention}. Rechallenge was not attempted. We review the four previously published reports of this association and discuss the proposed mechanism.",
        "CASE PRESENTATION: This report follows the CARE guideline. A patient with longstanding {condition} experienced {outcome} after {intervention} was introduced; the timeline, investigations and outcome are presented, together with the patient's own account and their written consent to publication.",
        "CASE PRESENTATION: We report a consecutive series of {ratio} patients treated with {intervention} for refractory {condition} at a single centre. There was no comparison group and patients were not randomly selected, so the observed {outcome} may reflect selection rather than treatment.",
        "CASE PRESENTATION: An unusual presentation of {condition} is described in a {age}-year-old. {outcome} was attributed to {intervention} after an extensive negative workup. Single observations of this kind cannot establish incidence or causation.",
    ],
    "narrative_review": [
        "This narrative review summarises current thinking on {intervention} in {condition}. We describe the physiological rationale, survey the principal trials, and offer a practical view for the bedside. No systematic search was performed and studies were selected at the authors' discretion.",
        "In this perspective we argue that {intervention} deserves broader consideration in {population}. The article draws on the authors' clinical experience and a selective reading of the literature rather than a protocol-driven search.",
        "We discuss the major randomised trials of {intervention} and place their findings in clinical context. This is not a systematic review: no protocol was registered, no formal risk-of-bias assessment was undertaken, and no attempt was made at quantitative pooling of {outcome}.",
        "This state-of-the-art article traces how practice around {intervention} in {condition} has shifted over two decades. Evidence is described qualitatively; the reader is referred to the cited systematic reviews for pooled estimates of {outcome}.",
        "EDITORIAL: The recent trial of {intervention} in {population} has been widely reported, but enthusiasm should be tempered. We set out three reasons why the observed effect on {outcome} may not generalise to routine care. These are the authors' opinions.",
        "A clinical overview intended for the generalist. We summarise how {intervention} is used in {condition}, what the guidelines say, and where genuine uncertainty about {outcome} remains. Literature was identified informally through the authors' own reading.",
    ],
    "preclinical": [
        "METHODS: Male C57BL/6 mice were randomised to {intervention} or vehicle following induction of experimental {condition}. {outcome} was assessed by histology and quantitative PCR at day 14. All procedures were approved by the institutional animal care committee and reported per the ARRIVE guidelines.",
        "METHODS: Cultured cells were exposed to increasing concentrations of {intervention} for 48 hours. Viability, cytokine release and markers relevant to {outcome} were measured. Experiments were performed in triplicate; findings in this system may not translate to human disease.",
        "METHODS: Sprague-Dawley rats with induced {condition} received {intervention} or vehicle by daily gavage for {months} weeks. Animals were allocated by sequential randomisation and investigators were blinded to group during outcome scoring. {outcome} was quantified histologically at sacrifice.",
        "METHODS: We used a knockout model to test whether the effect of {intervention} on {outcome} is receptor-dependent. Wild-type and knockout littermates were compared; n = 8 animals per group provided 80% power for the primary histological endpoint.",
        "METHODS: Human cell lines and primary murine tissue were used to characterise the pathway by which {intervention} modulates markers of {condition}. Western blot, immunofluorescence and RNA sequencing were performed. No human participants were involved in this work.",
        "METHODS: In an ex vivo perfusion model, tissue was exposed to {intervention} or control buffer. Dose-response relationships for {outcome} were fitted; results are mechanistic and preclinical, and no clinical inference should be drawn.",
    ],
}

# Sentences that inject another design's characteristic vocabulary into an
# abstract. Roughly a third of generated examples get one. Without these, every
# occurrence of "randomised" belongs to an RCT and the classifier learns a
# keyword rule wearing a neural network's clothes.
_DISTRACTORS = [
    "Unlike the randomised trials in this area, our design could not eliminate confounding by indication.",
    "The findings should be read alongside the recent systematic review and meta-analysis of {intervention}.",
    "A placebo-controlled trial would be the definitive test of this hypothesis but has not been conducted.",
    "Previous case reports had suggested this association; the present work examines it more formally.",
    "Cohort data from the same registry have been published separately.",
    "We did not randomly assign participants to {intervention}.",
    "Results are consistent with the pooled estimate reported by earlier meta-analyses.",
    "This work was not a clinical trial and was not registered.",
    "Animal studies had suggested benefit; whether that extends to {population} is the question here.",
    "Cross-sectional surveys have reported a similar prevalence of {condition}.",
]

# Which safeguards each method template above genuinely asserts, indexed to match
# _METHODS. Hand-annotated from the template text, not regex-derived: a regex
# would define the label in terms of the very phrasing the model is supposed to
# generalise past, and validation on a held-out template would then punish the
# model for being right.
_TEMPLATE_RIGOUR = {
    "systematic_review": [set(), {"registered"}, set(), set(), set(), {"registered"}],
    "rct": [{"randomised", "blinded", "itt"},
            {"randomised", "itt", "registered"},
            {"randomised", "powered"},
            {"randomised"},
            {"randomised"},
            {"randomised", "blinded"}],
    "cohort": [{"confounding_adjusted"}, {"confounding_adjusted"},
               {"confounding_adjusted"}, set(),
               {"confounding_adjusted"}, {"confounding_adjusted"}],
    "case_control": [{"blinded", "confounding_adjusted"}, set(),
                     {"confounding_adjusted"}, {"confounding_adjusted"},
                     set(), set()],
    "cross_sectional": [set(), {"confounding_adjusted"}, set(),
                        {"confounding_adjusted"}, set(), set()],
    "case_report": [set(), set(), set(), set(), set(), set()],
    "narrative_review": [set(), set(), set(), set(), set(), set()],
    "preclinical": [{"randomised"}, set(), {"randomised", "blinded"},
                    {"powered"}, set(), set()],
}

# Free-standing sentences that assert one safeguard each, in five phrasings. The
# generator inserts these independently of the method template, which does three
# things: it decouples the safeguard labels from the design label so the model
# cannot shortcut through one to reach the other, it lifts the rare labels to a
# trainable frequency, and it gives the split a second axis to hold out — a
# validation abstract states its safeguards in wording the model has never read.
_RIGOUR_PHRASES = {
    "randomised": [
        "Participants were assigned to study groups using a computer-generated random sequence.",
        "Allocation to the two arms was determined at random, in a 1:1 ratio.",
        "Group assignment followed a randomisation list prepared by an independent statistician.",
        "Subjects were randomly allocated between the comparison groups at enrolment.",
        "A random number sequence determined which arm each participant entered.",
    ],
    "blinded": [
        "Participants and treating clinicians were unaware of group assignment throughout.",
        "Outcome assessors were masked to the treatment received.",
        "The study was conducted under double-blind conditions with an identical-appearing comparator.",
        "Those measuring the endpoints did not know which group each participant belonged to.",
        "Treatment identity was concealed from patients and from the adjudication committee.",
    ],
    "registered": [
        "The protocol was registered on ClinicalTrials.gov before the first participant was enrolled.",
        "A pre-specified protocol and statistical analysis plan were published in advance.",
        "This study was prospectively registered; the registration number appears at the end of this article.",
        "The analysis plan was lodged with the registry prior to any data being examined.",
        "The review protocol was deposited in PROSPERO ahead of the search.",
    ],
    "itt": [
        "All participants were analysed in the group to which they were originally assigned.",
        "The primary analysis followed the intention-to-treat principle.",
        "No participant was excluded from the primary comparison on the basis of adherence.",
        "Analyses retained every randomised participant regardless of the treatment actually received.",
        "An intention-to-treat population formed the basis of the primary endpoint analysis.",
    ],
    "powered": [
        "The sample size was calculated in advance to give 90% power at a two-sided alpha of 0.05.",
        "An a priori power calculation determined the number of participants required.",
        "Enrolment targets were set to detect the minimum clinically important difference with 80% power.",
        "The study was adequately powered for the primary endpoint according to a prespecified calculation.",
        "Sample size was fixed before recruitment on the basis of an assumed event rate.",
    ],
    "confounding_adjusted": [
        "Estimates were adjusted for age, sex, comorbidity and socioeconomic status.",
        "Multivariable models controlled for the prespecified set of potential confounders.",
        "A propensity score was used to balance measured baseline characteristics between groups.",
        "Analyses accounted for measured confounding using inverse-probability weighting.",
        "Adjusted models included all covariates associated with both exposure and outcome.",
    ],
}

# How often the generator offers each safeguard, given the design. A narrative
# review that reports blinding is not impossible, just rare; keeping these
# non-zero stops the network from inferring a safeguard purely from the design.
_RIGOUR_RATE = {
    "systematic_review": {"randomised": .10, "blinded": .06, "registered": .55,
                          "itt": .06, "powered": .05, "confounding_adjusted": .18},
    "rct": {"randomised": .70, "blinded": .55, "registered": .45,
            "itt": .50, "powered": .40, "confounding_adjusted": .12},
    "cohort": {"randomised": .04, "blinded": .08, "registered": .18,
               "itt": .03, "powered": .12, "confounding_adjusted": .60},
    "case_control": {"randomised": .03, "blinded": .22, "registered": .10,
                     "itt": .02, "powered": .12, "confounding_adjusted": .55},
    "cross_sectional": {"randomised": .03, "blinded": .06, "registered": .10,
                        "itt": .02, "powered": .14, "confounding_adjusted": .45},
    "case_report": {"randomised": .02, "blinded": .03, "registered": .03,
                    "itt": .01, "powered": .02, "confounding_adjusted": .04},
    "narrative_review": {"randomised": .05, "blinded": .04, "registered": .08,
                         "itt": .03, "powered": .03, "confounding_adjusted": .06},
    "preclinical": {"randomised": .35, "blinded": .30, "registered": .06,
                    "itt": .02, "powered": .25, "confounding_adjusted": .08},
}

_BACKGROUND = [
    "BACKGROUND: {condition} remains a major cause of morbidity in {population}, and the role of {intervention} is contested.",
    "BACKGROUND: Whether {intervention} improves {outcome} in {population} is uncertain.",
    "BACKGROUND: Guidelines differ on the use of {intervention} for {condition}, reflecting a thin evidence base.",
    "BACKGROUND: {noun} is widely used in {condition} despite limited evidence on {outcome}.",
]

# ------------------------------------------------------ stance-specific text
# Results and conclusions carry the direction of the finding. Effect sizes are
# drawn from the plausible range for each stance so the numbers agree with the words.

# Eight phrasings per stance. The later entries deliberately state the direction
# only in the numbers — "18.5% versus 19.8% ({measure} {est}, 95% CI {lo} to
# {hi})" — with no "significant" or "no difference" to key on. An earlier version
# carried the signal almost entirely in stock phrases, and the resulting network
# scored 94% on this corpus and 41% on the adversarial probes, because real
# abstracts state their result and leave the reader to see where the interval
# falls. Reading the interval is the skill; these teach it.
_RESULTS = {
    "supports": [
        "RESULTS: {intervention} reduced {outcome} compared with control ({measure} {est}, 95% CI {lo} to {hi}; p = {p}).",
        "RESULTS: The primary outcome occurred less often in the {intervention} group ({measure} {est}, 95% CI {lo} to {hi}). The benefit was consistent across prespecified subgroups.",
        "RESULTS: There was a statistically significant improvement in {outcome} favouring {intervention} ({measure} {est}, 95% CI {lo} to {hi}; p = {p}), and the effect persisted after adjustment.",
        "RESULTS: {outcome} occurred in 9.1% of the {intervention} group and 13.4% of controls ({measure} {est}, 95% CI {lo} to {hi}).",
        "RESULTS: The point estimate favoured {intervention} and the interval lay entirely below the line of no effect ({measure} {est}, 95% CI {lo} to {hi}).",
        "RESULTS: Over follow-up, {outcome} was less common among those receiving {intervention} ({measure} {est}, 95% CI {lo} to {hi}; p = {p}). The number needed to treat was 24.",
        "RESULTS: {measure} {est} (95% CI {lo} to {hi}), p = {p}, in favour of {intervention}. Results were robust to the prespecified sensitivity analyses.",
        "RESULTS: A treatment effect on {outcome} was observed ({measure} {est}, 95% CI {lo} to {hi}) and was larger in the per-protocol population.",
    ],
    "no_effect": [
        "RESULTS: {outcome} did not differ significantly between groups ({measure} {est}, 95% CI {lo} to {hi}; p = {p}). The confidence interval excludes a clinically important benefit.",
        "RESULTS: We found no evidence that {intervention} altered {outcome} ({measure} {est}, 95% CI {lo} to {hi}). Results were unchanged in sensitivity analyses.",
        "RESULTS: The between-group difference in {outcome} was not significant ({measure} {est}, 95% CI {lo} to {hi}; p = {p}), and the trial was stopped for futility.",
        "RESULTS: {outcome} occurred in 18.5% of the {intervention} group and 19.8% of controls ({measure} {est}, 95% CI {lo} to {hi}; p = {p}).",
        "RESULTS: {measure} {est} (95% CI {lo} to {hi}), p = {p}. The interval crossed the line of no effect in both directions.",
        "RESULTS: Rates were similar in the two groups ({measure} {est}, 95% CI {lo} to {hi}). The trial met its prespecified futility boundary at the interim analysis.",
        "RESULTS: The estimate for {outcome} was close to unity and the interval included it ({measure} {est}, 95% CI {lo} to {hi}; p = {p}).",
        "RESULTS: Neither the primary nor any secondary endpoint reached significance ({measure} {est}, 95% CI {lo} to {hi}), despite adequate power.",
    ],
    "against": [
        "RESULTS: {outcome} was significantly worse in the {intervention} group ({measure} {est}, 95% CI {lo} to {hi}; p = {p}). Serious adverse events were more frequent with {intervention}.",
        "RESULTS: {intervention} was associated with increased {outcome} ({measure} {est}, 95% CI {lo} to {hi}), and the excess risk rose with cumulative exposure.",
        "RESULTS: Harm exceeded benefit: {outcome} occurred more often with {intervention} ({measure} {est}, 95% CI {lo} to {hi}; p = {p}), prompting early termination on the recommendation of the safety committee.",
        "RESULTS: {outcome} occurred in 21.3% of those exposed to {intervention} and 14.6% of those unexposed ({measure} {est}, 95% CI {lo} to {hi}).",
        "RESULTS: Higher exposure to {intervention} was associated with more {outcome} ({measure} {est}, 95% CI {lo} to {hi}; p = {p}), with a monotonic dose-response relationship.",
        "RESULTS: {measure} {est} (95% CI {lo} to {hi}), p = {p}; the entire interval lay above the line of no effect.",
        "RESULTS: The rate of {outcome} was elevated among recipients of {intervention} ({measure} {est}, 95% CI {lo} to {hi}) and the excess persisted after adjustment.",
        "RESULTS: We observed a higher incidence of {outcome} with {intervention} ({measure} {est}, 95% CI {lo} to {hi}). Discontinuation for adverse effects was twice as common.",
    ],
    "unclear": [
        "RESULTS: Estimates were highly heterogeneous (I² = {i2}%) and the pooled effect was imprecise ({measure} {est}, 95% CI {lo} to {hi}). Trials were at high or unclear risk of bias.",
        "RESULTS: The direction of effect differed between studies and the confidence interval was compatible with both benefit and harm ({measure} {est}, 95% CI {lo} to {hi}). Few events were observed.",
        "RESULTS: Data were too sparse for reliable pooling; only {nincluded} small studies reported {outcome}, and none was at low risk of bias.",
        "RESULTS: The interval was wide and spanned values that would change practice in opposite directions ({measure} {est}, 95% CI {lo} to {hi}).",
        "RESULTS: Between-study inconsistency was considerable (I² = {i2}%); the summary estimate ({measure} {est}, 95% CI {lo} to {hi}) should not be interpreted on its own.",
        "RESULTS: Only {nincluded} studies reported {outcome} and their estimates conflicted. No stable summary could be produced.",
        "RESULTS: Point estimates ranged from clear benefit to clear harm across the included studies; pooling was judged inappropriate.",
        "RESULTS: The analysis was underpowered for {outcome}; the confidence interval ({measure} {est}, 95% CI {lo} to {hi}) does not exclude either a worthwhile benefit or a meaningful harm.",
    ],
}

_CONCLUSIONS = {
    "supports": [
        "CONCLUSIONS: {intervention} improved {outcome} in {population}. These findings support its use in this setting.",
        "CONCLUSIONS: In this population, {intervention} conferred a clinically meaningful benefit for {outcome}.",
        "CONCLUSIONS: The evidence favours {intervention} for {condition}, though cost and adherence require consideration.",
        "CONCLUSIONS: Treatment with {intervention} lowered {outcome} and the effect was of a magnitude patients would notice.",
        "CONCLUSIONS: These data strengthen the case for offering {intervention} to {population}.",
        "CONCLUSIONS: {intervention} worked. The remaining question is which patients benefit most, not whether benefit exists.",
    ],
    "no_effect": [
        "CONCLUSIONS: {intervention} did not improve {outcome} in {population}. Routine use for this indication is not supported.",
        "CONCLUSIONS: We found no benefit of {intervention} on {outcome}. These results do not support current practice.",
        "CONCLUSIONS: This trial provides no evidence of effect, and the confidence interval rules out the benefit that earlier smaller studies suggested.",
        "CONCLUSIONS: {intervention} performed no better than the comparator on {outcome}.",
        "CONCLUSIONS: The hypothesised benefit was not observed. Continued use for {condition} on this basis is difficult to justify.",
        "CONCLUSIONS: Adding {intervention} to usual care changed nothing measurable in {population}.",
    ],
    "against": [
        "CONCLUSIONS: {intervention} was associated with harm in {population}; its use for {condition} should be reconsidered.",
        "CONCLUSIONS: The risks of {intervention} outweighed any benefit on {outcome} in this population.",
        "CONCLUSIONS: These data argue against {intervention} for {condition} outside a trial setting.",
        "CONCLUSIONS: {outcome} was more common with {intervention}, and this should be weighed before prescribing.",
        "CONCLUSIONS: We identified a safety signal that warrants regulatory attention.",
        "CONCLUSIONS: On these findings {intervention} does more harm than good in {population}.",
    ],
    "unclear": [
        "CONCLUSIONS: The evidence is insufficient to determine whether {intervention} affects {outcome}. Adequately powered trials are needed.",
        "CONCLUSIONS: No firm conclusion can be drawn. The certainty of evidence was rated very low, driven by imprecision and risk of bias.",
        "CONCLUSIONS: Findings are inconsistent and further research is very likely to change the estimate of effect.",
        "CONCLUSIONS: Whether {intervention} helps or harms in {condition} remains genuinely open.",
        "CONCLUSIONS: We can neither recommend nor discourage {intervention} on the present evidence.",
        "CONCLUSIONS: The data are compatible with a worthwhile benefit and with none at all; a definitive trial is required.",
    ],
}

_MEASURES = {
    "supports": [("risk ratio", 0.55, 0.86), ("hazard ratio", 0.58, 0.88), ("odds ratio", 0.50, 0.85)],
    "no_effect": [("risk ratio", 0.93, 1.07), ("hazard ratio", 0.92, 1.08), ("odds ratio", 0.90, 1.10)],
    "against": [("risk ratio", 1.18, 1.9), ("hazard ratio", 1.20, 1.85), ("odds ratio", 1.22, 2.1)],
    "unclear": [("risk ratio", 0.72, 1.35), ("odds ratio", 0.70, 1.40), ("hazard ratio", 0.75, 1.30)],
}

_QUESTIONS = [
    "Does {intervention} improve {outcome} in {population}?",
    "Is {intervention} effective for {condition}?",
    "What is the effect of {intervention} on {outcome}?",
    "Should {population} receive {intervention} for {condition}?",
    "Does {noun} reduce {outcome}?",
]


def _slots(rng: random.Random, topic, stance: str) -> dict:
    intervention, condition, population, outcome, noun = topic
    measure, lo_b, hi_b = rng.choice(_MEASURES[stance])
    est = rng.uniform(lo_b, hi_b)
    width = rng.uniform(0.08, 0.30)
    lo, hi = est * (1 - width), est * (1 + width)
    if stance == "supports":
        hi = min(hi, 0.99)
    elif stance == "against":
        lo = max(lo, 1.01)
    elif stance == "no_effect":
        lo, hi = min(lo, 0.95), max(hi, 1.05)
    p = rng.choice(["0.001", "0.004", "0.01", "0.03"]) if stance in ("supports", "against") \
        else rng.choice(["0.41", "0.63", "0.28", "0.88"])
    return {
        "intervention": intervention, "condition": condition, "population": population,
        "outcome": outcome, "noun": noun, "measure": measure,
        "est": f"{est:.2f}", "lo": f"{lo:.2f}", "hi": f"{hi:.2f}", "p": p,
        "n": f"{rng.randint(3, 240) * 47:,}", "ncases": f"{rng.randint(2, 40) * 53:,}",
        "nstudies": f"{rng.randint(8, 90) * 41:,}", "nincluded": rng.randint(3, 42),
        "months": rng.choice([3, 6, 12, 18, 24]), "years": rng.choice([4, 6, 8, 11]),
        "sites": rng.randint(3, 48), "ratio": rng.choice([2, 3, 4]),
        "age": rng.randint(19, 84), "resp": rng.randint(41, 89),
        "i2": rng.choice([68, 74, 81, 88, 91]),
    }


def _shuffled_middle(parts: list, rng: random.Random) -> list:
    """Lightly reorder the middle of an abstract.

    Real abstracts do not always put registration before analysis, or the
    distractor after the methods. A small amount of reordering stops the model
    from keying on sentence position, which is not a property it will find in
    PubMed.
    """
    parts = list(parts)
    if len(parts) > 2 and rng.random() < 0.4:
        i = rng.randrange(len(parts) - 1)
        parts[i], parts[i + 1] = parts[i + 1], parts[i]
    return parts


def seed_corpus(n_per_design: int = 240, seed: int = 20260722) -> list[Example]:
    """Generate the shipped bootstrap corpus.

    Design, stance and topic are all sampled independently, so neither network
    can shortcut through the other's signal or through the subject matter. A
    minority of abstracts are degraded on purpose — title only, no methods
    section, a truncated tail — because a real PubMed result set contains plenty
    of records that Strata has to grade from very little.
    """
    rng = random.Random(seed)
    out: list[Example] = []
    for design in DESIGN_LABELS:
        for _ in range(n_per_design):
            topic_id = rng.randrange(len(TOPICS))
            topic = TOPICS[topic_id]
            stance = rng.choice(STANCE_LABELS)
            s = _slots(rng, topic, stance)

            m_idx = rng.randrange(len(_METHODS[design]))
            # One phrasing bank per example, so a held-out variant index removes
            # every safeguard sentence the model could have memorised.
            r_idx = rng.randrange(len(_RIGOUR_PHRASES["randomised"]))

            # Each sentence is carried alongside the safeguards it asserts, so a
            # truncated abstract keeps exactly the labels its surviving text
            # supports. Deriving the labels first and trimming the string after
            # would teach the model to predict claims that are no longer there.
            parts: list[tuple[str, set[str]]] = [
                (rng.choice(_TITLES[design]).format(**s) + ".", set())]
            if rng.random() < 0.7:
                parts.append((rng.choice(_BACKGROUND).format(**s), set()))

            asserted: set[str] = set()
            if rng.random() >= 0.12:              # 12% have no methods section
                parts.append((_METHODS[design][m_idx].format(**s),
                              set(_TEMPLATE_RIGOUR[design][m_idx])))
                asserted |= set(_TEMPLATE_RIGOUR[design][m_idx])

            rates = _RIGOUR_RATE[design]
            for flag in RIGOUR_LABELS:
                if flag not in asserted and rng.random() < rates[flag]:
                    parts.append((_RIGOUR_PHRASES[flag][r_idx], {flag}))
                    asserted.add(flag)

            if rng.random() < 0.33:
                parts.append((rng.choice(_DISTRACTORS).format(**s), set()))
            # A narrative review or case report rarely reports a formal estimate.
            if design not in ("narrative_review", "case_report") or rng.random() < 0.35:
                parts.append((rng.choice(_RESULTS[stance]).format(**s), set()))
            parts.append((rng.choice(_CONCLUSIONS[stance]).format(**s), set()))

            body = parts[:1] + _shuffled_middle(parts[1:-1], rng) + parts[-1:]
            if rng.random() < 0.08:               # truncated record: drop the tail
                body = body[:rng.randint(2, max(2, len(body) - 1))]

            out.append(Example(
                text=" ".join(t for t, _ in body), design=design, stance=stance,
                question=rng.choice(_QUESTIONS).format(**s),
                topic_id=topic_id, source="seed", template_id=m_idx,
                rigour=frozenset().union(*(f for _, f in body)) if body else frozenset(),
                rigour_variant=r_idx))
    rng.shuffle(out)
    return out


# ------------------------------------------------------------ weak supervision

_SUPPORT_RE = re.compile(
    r"\b(significantly (?:reduced|improved|increased|lowered|decreased)|"
    r"was associated with (?:a )?(?:significant|marked|substantial) (?:reduction|improvement|decrease)|"
    r"improved (?:significantly|markedly)|"
    r"support(?:s|ed)? (?:the )?use|were? more effective|"
    r"conferred a (?:clinically )?(?:meaningful|significant) benefit|"
    r"favour(?:s|ed|ing)? (?:the )?(?:intervention|treatment)|"
    r"benefit(?:s|ed)? (?:from|were observed)|efficacious|effective in reducing)\b", re.I)

_NULL_RE = re.compile(
    r"\b(no (?:significant|evidence of (?:an? )?)?(?:difference|effect|benefit|association)|"
    r"did not (?:significantly )?(?:differ|improve|reduce|affect|change)|"
    r"was not (?:significantly )?(?:associated|different|superior)|"
    r"failed to (?:show|demonstrate|improve)|"
    r"not support(?:ed)? (?:the |its )?(?:routine )?use|"
    r"stopped for futility|no benefit)\b", re.I)

_HARM_RE = re.compile(
    r"\b(significantly (?:worse|higher risk|increased risk)|"
    r"associated with (?:an? )?(?:increased|higher|excess) (?:risk|rate|incidence|mortality)|"
    r"harm(?:s|ful)? (?:outweigh|exceeded)|"
    r"more (?:frequent|common) (?:serious )?adverse events|"
    r"should be (?:reconsidered|avoided|discouraged)|"
    r"argue against|terminated early (?:for|because of) (?:safety|harm))\b", re.I)

_UNCLEAR_RE = re.compile(
    r"\b(insufficient (?:evidence|data)|evidence is (?:insufficient|inconclusive|uncertain)|"
    r"no firm conclusion|inconsisten(?:t|cy)|"
    r"further (?:research|trials|studies) (?:are|is) (?:needed|required|warranted)|"
    r"certainty of (?:the )?evidence was (?:very )?low|"
    r"too (?:few|sparse|heterogeneous)|remains? (?:unclear|uncertain)|"
    r"compatible with both benefit and harm)\b", re.I)


def weak_stance(text: str) -> str | None:  # pragma: no cover - kept for API
    """Label the direction of a finding from its conclusion, or abstain.

    A deliberately conservative rule set. It reads the last third of the abstract,
    where conclusions live, and returns ``None`` whenever two families of cue fire
    with comparable strength — an ambiguous label is worse than no label, because
    the network will happily learn the noise.

    ``unclear`` wins ties against everything else: an abstract that hedges *and*
    reports a significant result is, for Strata's purposes, hedged.
    """
    if not text:
        return None
    tail = text[int(len(text) * 0.55):] or text
    scores = {
        "supports": len(_SUPPORT_RE.findall(tail)),
        "no_effect": len(_NULL_RE.findall(tail)),
        "against": len(_HARM_RE.findall(tail)),
        "unclear": len(_UNCLEAR_RE.findall(tail)),
    }
    if scores["unclear"] and max(scores["supports"], scores["against"]) <= scores["unclear"]:
        return "unclear"
    best = max(scores, key=lambda k: scores[k])
    if scores[best] == 0:
        return None
    ranked = sorted(scores.values(), reverse=True)
    if len(ranked) > 1 and ranked[0] == ranked[1]:
        return None                      # two cue families tied — abstain
    return best


def design_from_pubtypes(pubtypes, title: str = "") -> str | None:
    """Map NLM publication types to a design label, or None if unlabelled.

    Order matters: PubMed tags a Cochrane review as both *Meta-Analysis* and
    *Review*, and the stronger, more specific tag has to win. ``Review`` alone
    means a narrative review — but only when nothing more specific applies.
    """
    lowered = {str(p).lower().strip() for p in (pubtypes or [])}
    for pt in ("meta-analysis", "systematic review", "randomized controlled trial",
               "controlled clinical trial", "pragmatic clinical trial",
               "adaptive clinical trial", "equivalence trial", "case reports"):
        if pt in lowered:
            return PUBTYPE_TO_DESIGN[pt]

    t = (title or "").lower()
    if "systematic review" in t or "meta-analysis" in t:
        return "systematic_review"
    if "randomised" in t or "randomized" in t:
        return "rct"
    if "cohort" in t:
        return "cohort"
    if "case-control" in t or "case control" in t:
        return "case_control"
    if "cross-sectional" in t:
        return "cross_sectional"
    if "in vitro" in t or "murine" in t or "in mice" in t or "rat model" in t:
        return "preclinical"
    if "observational study" in lowered:
        return "cohort"
    for pt in ("review", "editorial", "comment", "letter", "news", "historical article"):
        if pt in lowered:
            return PUBTYPE_TO_DESIGN[pt]
    return None


def harvest(per_class: int = 400, *, search=None, verbose: bool = True) -> list[Example]:
    """Build a corpus of real PubMed records labelled by NLM publication type.

    Requires network access. Queries are per-design so the classes come out
    roughly balanced rather than reflecting PubMed's natural distribution, in
    which narrative reviews outnumber meta-analyses many times over.
    """
    if search is None:
        from ..pubmed import search_articles as search

    queries = {
        "systematic_review": "meta-analysis[pt] AND hasabstract AND english[la]",
        "rct": "randomized controlled trial[pt] AND hasabstract AND english[la]",
        "cohort": "cohort studies[mh] AND hasabstract AND english[la] NOT randomized controlled trial[pt]",
        "case_control": "case-control studies[mh] AND hasabstract AND english[la]",
        "cross_sectional": "cross-sectional studies[mh] AND hasabstract AND english[la]",
        "case_report": "case reports[pt] AND hasabstract AND english[la]",
        "narrative_review": "review[pt] AND hasabstract AND english[la] NOT systematic[sb]",
        "preclinical": "animals[mh] NOT humans[mh] AND hasabstract AND english[la]",
    }

    out: list[Example] = []
    for label, query in queries.items():
        articles = search(query, retmax=per_class)
        kept = 0
        for a in articles:
            if not a.abstract or len(a.abstract) < 200:
                continue
            text = f"{a.title}. {a.abstract}"
            out.append(Example(
                text=text, design=label, stance=weak_label(a.abstract),
                question=a.title, topic_id=-1, source=f"pubmed:{a.pmid}"))
            kept += 1
        if verbose:
            print(f"  {label:<18} {kept:>4} records")
    return out


def split(examples: list[Example], val_frac: float = 0.2,
          seed: int = 5) -> tuple[list[Example], list[Example]]:
    """Hold out whole topics *and* whole method templates.

    Splitting at random leaks twice over. Share a topic across the split and the
    model is rewarded for recognising subject matter; share a template and it is
    rewarded for recognising a sentence it has already memorised. The first
    version of this corpus scored 1.000 on a random split and considerably less
    than that on anything real.

    Validation is therefore the intersection: held-out topics described with
    held-out method templates. That is the question that matters — can the model
    recognise a case-control study, on a subject it has never seen, written in
    words it has never seen? Everything else goes to training.

    Harvested PubMed data carries no template id, so it falls back to a
    topic-free random split.
    """
    rng = random.Random(seed)
    topics = sorted({e.topic_id for e in examples if e.topic_id >= 0})
    templates = sorted({e.template_id for e in examples if e.template_id >= 0})
    variants = sorted({e.rigour_variant for e in examples if e.rigour_variant >= 0})

    if topics and len(templates) > 1:
        rng.shuffle(topics)
        held_topics = set(topics[:max(1, round(len(topics) * 0.45))])
        # one template per design, chosen by index so every design loses one
        held_templates = {templates[rng.randrange(len(templates))]}
        held_variants = ({variants[rng.randrange(len(variants))]}
                         if len(variants) > 1 else set())

        def held(e):
            return (e.topic_id in held_topics and e.template_id in held_templates
                    and (not held_variants or e.rigour_variant in held_variants))

        def seen(e):
            return (e.topic_id not in held_topics
                    and e.template_id not in held_templates
                    and e.rigour_variant not in held_variants)

        val = [e for e in examples if held(e)]
        train = [e for e in examples if seen(e)]
        if len(val) >= 40 and len(train) >= 100:
            return train, val

    if topics:
        rng.shuffle(topics)
        held = set(topics[:max(1, int(len(topics) * val_frac))])
        train = [e for e in examples if e.topic_id not in held]
        val = [e for e in examples if e.topic_id in held]
        if train and val:
            return train, val

    shuffled = list(examples)
    rng.shuffle(shuffled)
    cut = max(1, int(len(shuffled) * val_frac))
    return shuffled[cut:], shuffled[:cut]
