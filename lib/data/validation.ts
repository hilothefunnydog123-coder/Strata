import { daysFromNow, hoursFromNow } from "../format";
import type { ValidationDataset, ValidationRun } from "../types";

export const validationDatasets: ValidationDataset[] = [
  { id: "ds-sepsis-holdout", name: "Sepsis Holdout — 24 months", description: "Time-split holdout of adult inpatient encounters with adjudicated sepsis labels.", size: 48210, window: "Mar 2024 - Feb 2026", phiHandling: "Limited data set, access-controlled" },
  { id: "ds-sepsis-prospective", name: "Sepsis Prospective — Q1 2026", description: "Prospective encounters since the last production release, including the schema-change window.", size: 16480, window: "Jan - Mar 2026", phiHandling: "Limited data set, access-controlled" },
  { id: "ds-onc-registry", name: "Oncology Registry Cohort", description: "Curated tumor-registry cases with guideline-concordant reference treatments.", size: 9120, window: "2019 - 2025", phiHandling: "De-identified" },
  { id: "ds-doc-eval", name: "Documentation Eval Set", description: "Clinician-adjudicated encounter notes across service lines with reference summaries.", size: 5400, window: "2025 - 2026", phiHandling: "Limited data set" },
  { id: "ds-external-shift", name: "External Distribution-Shift Set", description: "Encounters from partner sites to probe out-of-distribution robustness.", size: 12300, window: "2025", phiHandling: "De-identified" },
];

const standardTests = (over: Partial<Record<string, ValidationRun["tests"][number]["status"]>> = {}) =>
  [
    { key: "performance", label: "Performance", description: "AUROC, sensitivity, specificity vs. thresholds", status: over.performance ?? "Passed" },
    { key: "calibration", label: "Calibration", description: "Brier score and reliability across the risk range", status: over.calibration ?? "Passed" },
    { key: "fairness", label: "Fairness", description: "Subgroup parity across age, sex, and race/ethnicity", status: over.fairness ?? "Passed" },
    { key: "robustness", label: "Robustness", description: "Perturbation and missing-feature stress tests", status: over.robustness ?? "Passed" },
    { key: "drift", label: "Data drift", description: "Distribution shift vs. training reference", status: over.drift ?? "Passed" },
    { key: "ood", label: "Out-of-distribution", description: "Detection of out-of-distribution inputs", status: over.ood ?? "Passed" },
    { key: "subgroup", label: "Subgroup performance", description: "Minimum performance floor within each subgroup", status: over.subgroup ?? "Passed" },
  ] as ValidationRun["tests"];

export const validationRuns: ValidationRun[] = [
  {
    id: "VAL-3092",
    systemId: "oncology-treatment",
    systemName: "Oncology Treatment Recommendation Model",
    version: "0.8.0",
    dataset: "Oncology Registry Cohort",
    datasetSize: 9120,
    requestedBy: "Dr. Naomi Chen",
    startedAt: daysFromNow(-5),
    completedAt: daysFromNow(-5),
    status: "Failed",
    overallResult: "Failed",
    progress: 100,
    tests: standardTests({ subgroup: "Failed", fairness: "Warning" }),
    metrics: [
      { metric: "Guideline concordance", value: 89.9, threshold: 90, betterWhen: "higher", status: "warning", unit: "%" },
      { metric: "AUROC", value: 0.912, threshold: 0.9, betterWhen: "higher", status: "good" },
      { metric: "Calibration (Brier)", value: 0.118, threshold: 0.15, betterWhen: "lower", status: "good" },
      { metric: "Worst-subgroup concordance", value: 78.4, threshold: 85, betterWhen: "higher", status: "critical", unit: "%" },
    ],
    subgroups: [
      { dimension: "Age", subgroup: "Under 40", n: 620, sensitivity: 88.1, specificity: 87.0, fpr: 12, fnr: 11.9, flagged: false },
      { dimension: "Age", subgroup: "Over 65", n: 3980, sensitivity: 78.4, specificity: 83.1, fpr: 15, fnr: 21.6, flagged: true },
      { dimension: "Sex", subgroup: "Female", n: 4610, sensitivity: 86.2, specificity: 86.4, fpr: 12.5, fnr: 13.8, flagged: false },
      { dimension: "Sex", subgroup: "Male", n: 4510, sensitivity: 85.9, specificity: 86.1, fpr: 12.7, fnr: 14.1, flagged: false },
    ],
    decision: {
      by: "Dr. Naomi Chen",
      at: daysFromNow(-5),
      decision: "Blocked",
      comment: "Worst-subgroup concordance (78.4%) for patients over 65 falls below the 85% floor. Model is blocked from promotion pending targeted retraining and IRB determination.",
    },
  },
  {
    id: "VAL-3081",
    systemId: "clinical-doc-copilot",
    systemName: "Clinical Documentation Copilot",
    version: "2.3.1",
    dataset: "Documentation Eval Set",
    datasetSize: 5400,
    requestedBy: "Dr. Marcus Bell",
    startedAt: daysFromNow(-2),
    completedAt: daysFromNow(-2),
    status: "Passed with warnings",
    overallResult: "Passed with warnings",
    progress: 100,
    tests: standardTests({ fairness: "Warning" }),
    metrics: [
      { metric: "Note accuracy", value: 89.4, threshold: 85, betterWhen: "higher", status: "good", unit: "%" },
      { metric: "Hallucination rate", value: 1.4, threshold: 2.0, betterWhen: "lower", status: "good", unit: "%" },
      { metric: "Cardiology subset accuracy", value: 87.1, threshold: 85, betterWhen: "higher", status: "good", unit: "%" },
      { metric: "Interpreter-audio accuracy", value: 82.6, threshold: 85, betterWhen: "higher", status: "warning", unit: "%" },
    ],
    subgroups: [],
    decision: {
      by: "AI Governance",
      at: daysFromNow(-1),
      decision: "Approved",
      comment: "Approved for production with a language-equity monitoring condition on interpreter-assisted encounters.",
    },
  },
  {
    id: "VAL-3075",
    systemId: "readmission-risk",
    systemName: "30-Day Readmission Risk Model",
    version: "3.1.0",
    dataset: "Sepsis Holdout — 24 months",
    datasetSize: 41200,
    requestedBy: "Sofia Ramirez",
    startedAt: daysFromNow(-2),
    completedAt: daysFromNow(-2),
    status: "Passed",
    overallResult: "Passed",
    progress: 100,
    tests: standardTests(),
    metrics: [
      { metric: "AUROC", value: 0.824, threshold: 0.78, betterWhen: "higher", status: "good" },
      { metric: "Sensitivity", value: 80.1, threshold: 75, betterWhen: "higher", status: "good", unit: "%" },
      { metric: "Calibration (Brier)", value: 0.101, threshold: 0.15, betterWhen: "lower", status: "good" },
    ],
    subgroups: [],
    decision: { by: "Sofia Ramirez", at: daysFromNow(-2), decision: "Approved", comment: "Quarterly validation passed; production release maintained." },
  },
  {
    id: "VAL-3069",
    systemId: "med-interaction",
    systemName: "Medication Interaction Detector",
    version: "3.4.2",
    dataset: "External Distribution-Shift Set",
    datasetSize: 12300,
    requestedBy: "Dr. Aisha Karim",
    startedAt: hoursFromNow(-6),
    status: "Running",
    overallResult: "In progress",
    progress: 62,
    tests: standardTests({ drift: "Running", ood: "Queued", subgroup: "Queued" }),
    metrics: [
      { metric: "Sensitivity", value: 92.6, threshold: 90, betterWhen: "higher", status: "good", unit: "%" },
      { metric: "Alert precision", value: 71.2, threshold: 75, betterWhen: "higher", status: "warning", unit: "%" },
    ],
    subgroups: [],
  },
];

export const validationRunById: Record<string, ValidationRun> = Object.fromEntries(
  validationRuns.map((v) => [v.id, v]),
);
