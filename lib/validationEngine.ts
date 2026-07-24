import { NOW } from "./format";
import { validationRuns } from "./data/validation";
import type {
  AISystem,
  ValidationDataset,
  ValidationRun,
  ValidationTest,
} from "./types";

const TEST_DEFS: { key: string; label: string; description: string }[] = [
  { key: "performance", label: "Performance", description: "AUROC, sensitivity, specificity vs. thresholds" },
  { key: "calibration", label: "Calibration", description: "Brier score and reliability across the risk range" },
  { key: "fairness", label: "Fairness", description: "Subgroup parity across age, sex, and race/ethnicity" },
  { key: "robustness", label: "Robustness", description: "Perturbation and missing-feature stress tests" },
  { key: "drift", label: "Data drift", description: "Distribution shift vs. training reference" },
  { key: "ood", label: "Out-of-distribution", description: "Detection of out-of-distribution inputs" },
  { key: "subgroup", label: "Subgroup performance", description: "Minimum performance floor within each subgroup" },
];

export const VALIDATION_TESTS = TEST_DEFS;

/** Build a fresh validation result for a system/version/dataset/test selection.
 *  Reuses authored preset results where they exist so the demo stays authentic. */
export function buildValidationRun(
  system: AISystem,
  version: string,
  dataset: ValidationDataset,
  selectedTests: Set<string>,
): ValidationRun {
  const preset = validationRuns.find(
    (r) => r.systemId === system.id && r.status !== "Running",
  );

  const version_ = version;
  const headline = system.performance.headline;

  let tests: ValidationTest[];
  let metrics: ValidationRun["metrics"];
  let subgroups: ValidationRun["subgroups"];

  if (preset) {
    tests = preset.tests
      .filter((t) => selectedTests.has(t.key))
      .map((t) => ({ ...t }));
    metrics = preset.metrics;
    subgroups = selectedTests.has("fairness") || selectedTests.has("subgroup")
      ? preset.subgroups
      : [];
  } else {
    const passPerf = headline.value >= (headline.threshold ?? 0);
    const fairnessBad = system.fairness.status !== "good" && system.fairness.groups.length > 0;
    const driftBad = system.drift.status !== "good";
    const flaggedSubgroup = system.fairness.groups.some((g) => g.flagged);

    const statusFor = (key: string): ValidationTest["status"] => {
      if (!selectedTests.has(key)) return "Skipped";
      if (key === "performance") return passPerf ? "Passed" : "Failed";
      if (key === "fairness") return fairnessBad ? "Warning" : "Passed";
      if (key === "subgroup") return flaggedSubgroup ? "Failed" : "Passed";
      if (key === "drift") return driftBad ? "Warning" : "Passed";
      return "Passed";
    };

    tests = TEST_DEFS.filter((d) => selectedTests.has(d.key)).map((d) => ({
      key: d.key,
      label: d.label,
      description: d.description,
      status: statusFor(d.key),
    }));

    const cur = system.versions.find((v) => v.version === version)?.metrics ??
      system.versions[0].metrics;
    metrics = [
      { metric: "AUROC", value: cur.auroc, threshold: (headline.threshold ?? 80) / 100, betterWhen: "higher", status: "good" },
      { metric: "Sensitivity", value: cur.sensitivity, threshold: (headline.threshold ?? 80) - 4, betterWhen: "higher", status: cur.sensitivity >= (headline.threshold ?? 80) - 4 ? "good" : "warning", unit: "%" },
      { metric: "Specificity", value: cur.specificity, threshold: (headline.threshold ?? 80) - 3, betterWhen: "higher", status: "good", unit: "%" },
      { metric: headline.label, value: headline.value, threshold: headline.threshold ?? 0, betterWhen: "higher", status: passPerf ? "good" : "critical", unit: "%" },
    ];
    subgroups = selectedTests.has("fairness") || selectedTests.has("subgroup")
      ? system.fairness.groups
      : [];
  }

  const anyFailed = tests.some((t) => t.status === "Failed");
  const anyWarn = tests.some((t) => t.status === "Warning");
  const overall = anyFailed ? "Failed" : anyWarn ? "Passed with warnings" : "Passed";

  return {
    id: `VAL-${3100 + (system.id.length % 90)}`,
    systemId: system.id,
    systemName: system.name,
    version: version_,
    dataset: dataset.name,
    datasetSize: dataset.size,
    requestedBy: system.ownerContact,
    startedAt: NOW.toISOString(),
    completedAt: NOW.toISOString(),
    status: overall as ValidationRun["status"],
    overallResult: overall,
    progress: 100,
    tests,
    metrics,
    subgroups,
  };
}
