import type { Alert, AlertCategory, MetricStatus } from "../types";

export interface ScenarioStep {
  label: string;
  detail: string;
  tone: MetricStatus;
  delayMs: number;
  /** An alert injected into the estate when this step fires. */
  alert?: Omit<Alert, "id" | "at" | "status">;
}

export interface Scenario {
  id: string;
  index: number;
  title: string;
  trigger: string;
  targetSystemId: string;
  targetSystemName: string;
  summary: string;
  category: AlertCategory;
  steps: ScenarioStep[];
}

export const scenarios: Scenario[] = [
  {
    id: "ehr-schema-change",
    index: 1,
    title: "EHR schema change",
    trigger: "Simulate EHR Schema Change",
    targetSystemId: "aki-predictor",
    targetSystemName: "Acute Kidney Injury Predictor",
    category: "Drift",
    summary:
      "An Epic upgrade remaps a laboratory feature. Ward detects input drift, then performance degradation, and recommends an incident.",
    steps: [
      {
        label: "EHR schema change deployed",
        detail: "Epic v2026.02 remapped the serum-creatinine result row. The feature pipeline continues to run without error.",
        tone: "warning",
        delayMs: 300,
      },
      {
        label: "Input drift detected",
        detail: "Creatinine null rate rose to 19% of encounters. Overall drift score climbed 0.06 → 0.17 (Warning).",
        tone: "warning",
        delayMs: 2200,
        alert: {
          systemId: "aki-predictor",
          systemName: "Acute Kidney Injury Predictor",
          category: "Drift",
          severity: "High",
          title: "Input drift detected after schema change",
          detail: "Serum-creatinine ingestion degraded following an EHR schema change. Drift score 0.17 (Warning), driven by the creatinine feature.",
          changeSummary: "Drift 0.06 → 0.17 · Creatinine null rate 1% → 19%",
          recommendedAction: "Validate the creatinine feature mapping against Epic v2026.02.",
          owner: "Clinical AI Team",
          linkTab: "drift",
          evidence: [
            { label: "Drift score", value: "0.17", status: "warning" },
            { label: "Null rate", value: "19% of encounters", status: "critical" },
          ],
        },
      },
      {
        label: "Performance degradation",
        detail: "AUROC fell 84.7% → 81.9% over the simulated window as the model imputes missing creatinine values.",
        tone: "critical",
        delayMs: 2600,
        alert: {
          systemId: "aki-predictor",
          systemName: "Acute Kidney Injury Predictor",
          category: "Performance",
          severity: "Critical",
          title: "Performance degradation detected",
          detail: "AUROC dropped 2.8 points, tracking the creatinine ingestion gap. Recall for early AKI is most affected.",
          changeSummary: "AUROC 84.7% → 81.9%",
          recommendedAction: "Open an incident and correlate with the EHR schema change window.",
          owner: "Clinical AI Team",
          linkTab: "performance",
          evidence: [
            { label: "AUROC", value: "-2.8 pts", status: "critical" },
            { label: "Onset", value: "Schema change", status: "warning" },
          ],
        },
      },
      {
        label: "Incident recommended",
        detail: "Ward correlated the drift and performance signals to a single upstream cause and recommends opening a SEV-3 incident.",
        tone: "critical",
        delayMs: 2200,
      },
    ],
  },
  {
    id: "new-model-version",
    index: 2,
    title: "New model version",
    trigger: "Simulate New Model Version",
    targetSystemId: "readmission-risk",
    targetSystemName: "30-Day Readmission Risk Model",
    category: "Fairness",
    summary:
      "Version 3.2 improves overall AUROC but regresses for patients over 65. Ward catches the subgroup regression and blocks promotion.",
    steps: [
      {
        label: "Version 3.2 deployed to staging",
        detail: "A retrained candidate with an expanded feature set entered staging validation.",
        tone: "neutral",
        delayMs: 300,
      },
      {
        label: "Overall performance improved",
        detail: "Aggregate AUROC rose 82.4% → 83.8% (+1.4 points) on the holdout set.",
        tone: "good",
        delayMs: 2200,
      },
      {
        label: "Subgroup regression detected",
        detail: "Recall for patients over 65 fell 80.1% → 75.0% (-5.1 points), below the subgroup floor, despite the overall gain.",
        tone: "critical",
        delayMs: 2600,
        alert: {
          systemId: "readmission-risk",
          systemName: "30-Day Readmission Risk Model",
          category: "Fairness",
          severity: "High",
          title: "Subgroup regression in candidate version 3.2",
          detail: "Candidate 3.2 improves aggregate AUROC but regresses recall for patients over 65 below the subgroup performance floor.",
          changeSummary: "Recall (over 65) 80.1% → 75.0% · Overall AUROC +1.4",
          recommendedAction: "Block promotion and require subgroup remediation before approval.",
          owner: "AI Governance",
          linkTab: "fairness",
          evidence: [
            { label: "Recall over 65", value: "-5.1 pts", status: "critical" },
            { label: "Overall AUROC", value: "+1.4 pts", status: "good" },
            { label: "Subgroup floor", value: "Breached", status: "critical" },
          ],
        },
      },
      {
        label: "Promotion blocked",
        detail: "The deployment gate blocked promotion of version 3.2 pending subgroup remediation. Version 3.1 remains in production.",
        tone: "warning",
        delayMs: 2000,
      },
    ],
  },
  {
    id: "agent-anomaly",
    index: 3,
    title: "AI agent anomaly",
    trigger: "Simulate Agent Anomaly",
    targetSystemId: "patient-scheduling-agent",
    targetSystemName: "Patient Scheduling Agent",
    category: "Agent Behavior",
    summary:
      "The Scheduling Agent begins making far more actions than normal. Ward detects the unusual behavior and auto-halts the session.",
    steps: [
      {
        label: "Action volume rising",
        detail: "Session SC-2214 reached 2.1x the median action count as a rescheduling loop expanded.",
        tone: "warning",
        delayMs: 300,
      },
      {
        label: "Unusual tool-call sequence",
        detail: "The agent repeated notification tool calls 31 times in 60 seconds, an unusual pattern for this workflow.",
        tone: "warning",
        delayMs: 2200,
      },
      {
        label: "Anomaly threshold crossed",
        detail: "Behavior model raised the session anomaly score to 0.83, above the 0.80 threshold.",
        tone: "critical",
        delayMs: 2400,
        alert: {
          systemId: "patient-scheduling-agent",
          systemName: "Patient Scheduling Agent",
          category: "Agent Behavior",
          severity: "High",
          title: "Agent action anomaly detected",
          detail: "Session SC-2214 exhibited an abnormal repeated-notification pattern with an anomaly score of 0.83.",
          changeSummary: "Anomaly score 0.83 · Actions 2.1x median",
          recommendedAction: "Review the flagged session and confirm no duplicate patient notifications were sent.",
          owner: "Access Center AI",
          linkTab: "agent",
          evidence: [
            { label: "Anomaly score", value: "0.83", status: "critical" },
            { label: "Actions", value: "2.1x median", status: "warning" },
          ],
        },
      },
      {
        label: "Session auto-halted",
        detail: "Ward halted session SC-2214 and routed it for human review. No duplicate notifications were dispatched.",
        tone: "good",
        delayMs: 2000,
      },
    ],
  },
];

export const scenarioById: Record<string, Scenario> = Object.fromEntries(
  scenarios.map((s) => [s.id, s]),
);
