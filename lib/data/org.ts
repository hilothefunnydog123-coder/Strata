import { daysFromNow, hoursFromNow, minutesFromNow } from "../format";
import type {
  AlertThreshold,
  Integration,
  OrgUser,
  RiskPolicy,
  RolePermission,
} from "../types";

export const orgUsers: OrgUser[] = [
  { id: "u1", name: "Dr. Elena Marsh", role: "AI Governance Lead", email: "elena.marsh@northstarhealth.org", team: "Clinical AI Team", status: "Active", lastActive: minutesFromNow(-6), initials: "EM" },
  { id: "u2", name: "Dr. Alan Whitmore", role: "Executive", email: "alan.whitmore@northstarhealth.org", team: "Executive", status: "Active", lastActive: hoursFromNow(-2), initials: "AW" },
  { id: "u3", name: "James Okonkwo", role: "Compliance Officer", email: "james.okonkwo@northstarhealth.org", team: "Compliance & Privacy", status: "Active", lastActive: minutesFromNow(-40), initials: "JO" },
  { id: "u4", name: "Ravi Patel", role: "Data Scientist", email: "ravi.patel@northstarhealth.org", team: "Clinical AI Team", status: "Active", lastActive: minutesFromNow(-2), initials: "RP" },
  { id: "u5", name: "Dr. Priya Nair", role: "Clinical Reviewer", email: "priya.nair@northstarhealth.org", team: "Radiology Informatics", status: "Active", lastActive: hoursFromNow(-1), initials: "PN" },
  { id: "u6", name: "Dr. Marcus Bell", role: "AI Governance Lead", email: "marcus.bell@northstarhealth.org", team: "Digital Health", status: "Active", lastActive: minutesFromNow(-18), initials: "MB" },
  { id: "u7", name: "Sofia Ramirez", role: "Data Scientist", email: "sofia.ramirez@northstarhealth.org", team: "Population Health", status: "Active", lastActive: hoursFromNow(-3), initials: "SR" },
  { id: "u8", name: "Dr. Aisha Karim", role: "Clinical Reviewer", email: "aisha.karim@northstarhealth.org", team: "Pharmacy Informatics", status: "Active", lastActive: hoursFromNow(-5), initials: "AK" },
  { id: "u9", name: "Dana Whitfield", role: "AI Governance Lead", email: "dana.whitfield@northstarhealth.org", team: "Revenue Cycle AI", status: "Active", lastActive: hoursFromNow(-1), initials: "DW" },
  { id: "u10", name: "Priya Deshmukh", role: "Administrator", email: "priya.deshmukh@northstarhealth.org", team: "AI Platform", status: "Active", lastActive: minutesFromNow(-25), initials: "PD" },
  { id: "u11", name: "Dr. Naomi Chen", role: "Clinical Reviewer", email: "naomi.chen@northstarhealth.org", team: "Precision Medicine", status: "Active", lastActive: hoursFromNow(-4), initials: "NC" },
  { id: "u12", name: "Miguel Santos", role: "Data Scientist", email: "miguel.santos@northstarhealth.org", team: "Access Center AI", status: "Active", lastActive: hoursFromNow(-2), initials: "MS" },
  { id: "u13", name: "Rachel Kim", role: "Data Scientist", email: "rachel.kim@northstarhealth.org", team: "Operations", status: "Active", lastActive: hoursFromNow(-6), initials: "RK" },
  { id: "u14", name: "Dr. Owen Fletcher", role: "Clinical Reviewer", email: "owen.fletcher@northstarhealth.org", team: "Clinical AI Team", status: "Active", lastActive: daysFromNow(-1), initials: "OF" },
  { id: "u15", name: "Karen Liu", role: "Data Scientist", email: "karen.liu@northstarhealth.org", team: "Nursing Informatics", status: "Active", lastActive: hoursFromNow(-8), initials: "KL" },
  { id: "u16", name: "Thomas Reyes", role: "Compliance Officer", email: "thomas.reyes@northstarhealth.org", team: "Compliance & Privacy", status: "Invited", lastActive: daysFromNow(-3), initials: "TR" },
];

export const rolePermissions: RolePermission[] = [
  {
    role: "Administrator",
    description: "Full platform administration, integrations, and policy configuration.",
    memberCount: 3,
    scopes: [
      { area: "Registry & systems", level: "Full" },
      { area: "Validation & approvals", level: "Approve" },
      { area: "Incidents & alerts", level: "Full" },
      { area: "Policies & thresholds", level: "Full" },
      { area: "Users & roles", level: "Full" },
    ],
  },
  {
    role: "AI Governance Lead",
    description: "Owns the governance lifecycle: review, validation, and deployment approval.",
    memberCount: 4,
    scopes: [
      { area: "Registry & systems", level: "Edit" },
      { area: "Validation & approvals", level: "Approve" },
      { area: "Incidents & alerts", level: "Edit" },
      { area: "Policies & thresholds", level: "Edit" },
      { area: "Users & roles", level: "View" },
    ],
  },
  {
    role: "Clinical Reviewer",
    description: "Clinical validation, subgroup review, and clinical sign-off on deployments.",
    memberCount: 6,
    scopes: [
      { area: "Registry & systems", level: "View" },
      { area: "Validation & approvals", level: "Approve" },
      { area: "Incidents & alerts", level: "Edit" },
      { area: "Policies & thresholds", level: "View" },
      { area: "Users & roles", level: "None" },
    ],
  },
  {
    role: "Data Scientist",
    description: "Registers systems, runs validation, and responds to model incidents.",
    memberCount: 9,
    scopes: [
      { area: "Registry & systems", level: "Edit" },
      { area: "Validation & approvals", level: "Edit" },
      { area: "Incidents & alerts", level: "Edit" },
      { area: "Policies & thresholds", level: "View" },
      { area: "Users & roles", level: "None" },
    ],
  },
  {
    role: "Compliance Officer",
    description: "Regulatory classification, audit oversight, and security review.",
    memberCount: 3,
    scopes: [
      { area: "Registry & systems", level: "View" },
      { area: "Validation & approvals", level: "View" },
      { area: "Incidents & alerts", level: "View" },
      { area: "Policies & thresholds", level: "Edit" },
      { area: "Users & roles", level: "View" },
    ],
  },
  {
    role: "Executive",
    description: "Portfolio health, ROI, and risk visibility with executive approval authority.",
    memberCount: 2,
    scopes: [
      { area: "Registry & systems", level: "View" },
      { area: "Validation & approvals", level: "Approve" },
      { area: "Incidents & alerts", level: "View" },
      { area: "Policies & thresholds", level: "View" },
      { area: "Users & roles", level: "None" },
    ],
  },
];

export const riskPolicies: RiskPolicy[] = [
  { riskLevel: "Critical", validationCadenceDays: 60, approvalsRequired: 3, driftThreshold: 0.1, fairnessThreshold: 2.0, requiresClinicalReview: true },
  { riskLevel: "High", validationCadenceDays: 90, approvalsRequired: 2, driftThreshold: 0.15, fairnessThreshold: 3.0, requiresClinicalReview: true },
  { riskLevel: "Moderate", validationCadenceDays: 120, approvalsRequired: 2, driftThreshold: 0.2, fairnessThreshold: 4.0, requiresClinicalReview: true },
  { riskLevel: "Low", validationCadenceDays: 180, approvalsRequired: 1, driftThreshold: 0.25, fairnessThreshold: 5.0, requiresClinicalReview: false },
];

export const alertThresholds: AlertThreshold[] = [
  { id: "th1", category: "Performance", metric: "Primary metric 30d change", condition: "Drop > 2.0%", severity: "High", enabled: true },
  { id: "th2", category: "Performance", metric: "Primary metric vs threshold", condition: "Below action threshold", severity: "Critical", enabled: true },
  { id: "th3", category: "Drift", metric: "Overall drift score", condition: "> 0.15", severity: "High", enabled: true },
  { id: "th4", category: "Drift", metric: "Overall drift score", condition: "> 0.25", severity: "Critical", enabled: true },
  { id: "th5", category: "Fairness", metric: "Subgroup FNR gap", condition: "> policy threshold", severity: "High", enabled: true },
  { id: "th6", category: "Agent Behavior", metric: "Session anomaly score", condition: "> 0.80", severity: "High", enabled: true },
  { id: "th7", category: "Agent Behavior", metric: "Human-approval bypass", condition: "Any occurrence", severity: "Critical", enabled: true },
  { id: "th8", category: "Validation", metric: "Validation cadence", condition: "Overdue", severity: "Medium", enabled: true },
  { id: "th9", category: "Security", metric: "Sensitive-data access rate", condition: "> elevated band", severity: "Medium", enabled: true },
  { id: "th10", category: "Model Version", metric: "New version pending", condition: "Awaiting approval > 7 days", severity: "Low", enabled: false },
];

export const integrations: Integration[] = [
  { id: "int1", name: "Epic (FHIR R4)", category: "Electronic Health Record", status: "Connected", detail: "Real-time vitals, labs, ADT, and documents", lastSync: minutesFromNow(-1) },
  { id: "int2", name: "PACS / VNA", category: "Imaging", status: "Connected", detail: "DICOM studies and worklist events", lastSync: minutesFromNow(-3) },
  { id: "int3", name: "Payer Gateway", category: "Revenue Cycle", status: "Connected", detail: "Prior-auth and claim submission APIs", lastSync: minutesFromNow(-8) },
  { id: "int4", name: "Snowflake Warehouse", category: "Analytics", status: "Connected", detail: "Historical cohorts and validation datasets", lastSync: minutesFromNow(-15) },
  { id: "int5", name: "Okta SSO / SCIM", category: "Identity", status: "Connected", detail: "Single sign-on and user provisioning", lastSync: hoursFromNow(-1) },
  { id: "int6", name: "ServiceNow", category: "ITSM", status: "Connected", detail: "Incident and change-management sync", lastSync: minutesFromNow(-22) },
  { id: "int7", name: "SDOH Data Vendor", category: "External Data", status: "Degraded", detail: "Social-determinants indices (elevated latency)", lastSync: hoursFromNow(-4) },
  { id: "int8", name: "PagerDuty", category: "Alerting", status: "Connected", detail: "On-call escalation for critical alerts", lastSync: minutesFromNow(-12) },
  { id: "int9", name: "Model Registry (MLflow)", category: "MLOps", status: "Connected", detail: "Model artifacts and version lineage", lastSync: minutesFromNow(-30) },
  { id: "int10", name: "Immutable Audit Store", category: "Compliance", status: "Connected", detail: "Write-once audit-log archival", lastSync: minutesFromNow(-5) },
];
