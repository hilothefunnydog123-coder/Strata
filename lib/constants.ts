import type {
  AICategory,
  AlertCategory,
  AlertSeverity,
  IncidentSeverity,
  MetricStatus,
  RiskLevel,
  SystemStatus,
} from "./types";

export const ORG = {
  name: "Northstar Health System",
  shortName: "Northstar Health",
  hospitals: 8,
  region: "Upper Midwest",
  beds: 3120,
  fiscalYear: "FY2026",
};

/** Chart series palette — tuned for the dark canvas, restrained and cohesive. */
export const CHART = {
  azure: "#4A8CF5",
  green: "#3DD294",
  amber: "#E8B048",
  cyan: "#52B2D6",
  orange: "#F28A42",
  red: "#F26064",
  steel: "#8A99B4",
  violetFree: "#7C93C7",
};

/** Metric-line colors used consistently across performance charts. */
export const METRIC_COLORS: Record<string, string> = {
  accuracy: CHART.azure,
  auroc: CHART.cyan,
  precision: CHART.amber,
  recall: CHART.green,
  f1: CHART.orange,
};

export const RISK_ORDER: RiskLevel[] = ["Low", "Moderate", "High", "Critical"];

export const RISK_COLOR: Record<RiskLevel, string> = {
  Low: "var(--positive)",
  Moderate: "var(--warning)",
  High: "var(--elevated)",
  Critical: "var(--critical)",
};

export const RISK_TEXT: Record<RiskLevel, string> = {
  Low: "text-positive",
  Moderate: "text-warning",
  High: "text-elevated",
  Critical: "text-critical",
};

export const STATUS_META: Record<
  SystemStatus,
  { label: string; tone: MetricStatus; dot: string }
> = {
  Operational: { label: "Operational", tone: "good", dot: "var(--positive)" },
  Warning: { label: "Warning", tone: "warning", dot: "var(--warning)" },
  Degraded: { label: "Degraded", tone: "warning", dot: "var(--elevated)" },
  Critical: { label: "Critical", tone: "critical", dot: "var(--critical)" },
  Offline: { label: "Offline", tone: "neutral", dot: "var(--fg-dim)" },
};

export const SEVERITY_META: Record<
  AlertSeverity,
  { tone: MetricStatus; rank: number }
> = {
  Critical: { tone: "critical", rank: 0 },
  High: { tone: "warning", rank: 1 },
  Medium: { tone: "warning", rank: 2 },
  Low: { tone: "neutral", rank: 3 },
  Info: { tone: "neutral", rank: 4 },
};

export const INCIDENT_SEVERITY_META: Record<
  IncidentSeverity,
  { tone: MetricStatus; label: string }
> = {
  "SEV-1": { tone: "critical", label: "SEV-1 · Critical" },
  "SEV-2": { tone: "warning", label: "SEV-2 · Major" },
  "SEV-3": { tone: "warning", label: "SEV-3 · Minor" },
  "SEV-4": { tone: "neutral", label: "SEV-4 · Low" },
};

export const CATEGORY_ORDER: AICategory[] = [
  "Clinical Prediction",
  "Medical Imaging",
  "Clinical Documentation",
  "Decision Support",
  "Autonomous Agent",
  "Medication Safety",
  "Revenue Cycle",
  "Scheduling & Operations",
  "Oncology & Genomics",
];

export const ALERT_CATEGORY_ORDER: AlertCategory[] = [
  "Performance",
  "Drift",
  "Fairness",
  "Agent Behavior",
  "Security",
  "Compliance",
  "Model Version",
  "Validation",
];

export function toneToClasses(tone: MetricStatus): {
  text: string;
  bg: string;
  border: string;
  dot: string;
} {
  switch (tone) {
    case "good":
      return {
        text: "text-positive",
        bg: "bg-positive/10",
        border: "border-positive/30",
        dot: "bg-positive",
      };
    case "warning":
      return {
        text: "text-warning",
        bg: "bg-warning/10",
        border: "border-warning/30",
        dot: "bg-warning",
      };
    case "critical":
      return {
        text: "text-critical",
        bg: "bg-critical/10",
        border: "border-critical/30",
        dot: "bg-critical",
      };
    default:
      return {
        text: "text-fg-muted",
        bg: "bg-fg-muted/10",
        border: "border-edge",
        dot: "bg-fg-dim",
      };
  }
}
