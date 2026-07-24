import { daysFromNow, hoursFromNow } from "../format";
import type { AuditEvent } from "../types";

/** Immutable audit trail. Newest first. */
export const auditEvents: AuditEvent[] = [
  { id: "AUD-9001", at: hoursFromNow(-1.5), actor: "Ravi Patel", actorRole: "Data Scientist", action: "Deployed model version", object: "Sepsis Risk Predictor 4.2.1", systemId: "sepsis-risk-predictor", category: "Deployment", reason: "Hotfix for respiratory-rate null imputation (INC-1043)" },
  { id: "AUD-9000", at: hoursFromNow(-3.5), actor: "Dr. Elena Marsh", actorRole: "AI Governance Lead", action: "Opened incident", object: "INC-1043", systemId: "sepsis-risk-predictor", category: "Incident", reason: "Performance degradation and drift detected" },
  { id: "AUD-8999", at: hoursFromNow(-2), actor: "Platform on-call", actorRole: "Administrator", action: "Failed over inference cluster", object: "Intracranial Hemorrhage Detector", systemId: "ich-detector", category: "Configuration", reason: "GPU node-pool degradation (INC-1042)" },
  { id: "AUD-8998", at: hoursFromNow(-4), actor: "Strata monitor", actorRole: "System", action: "Raised fairness alert", object: "ALT-4823", systemId: "sepsis-risk-predictor", category: "Policy", reason: "FNR disparity exceeded 3.0 point policy for patients over 65" },
  { id: "AUD-8995", at: daysFromNow(-1), actor: "Dr. Marcus Bell", actorRole: "AI Governance Lead", action: "Submitted version for approval", object: "Clinical Documentation Copilot 2.3.1", systemId: "clinical-doc-copilot", category: "Version", reason: "Staging validation passed with warnings" },
  { id: "AUD-8990", at: daysFromNow(-1), actor: "Dana Whitfield", actorRole: "AI Governance Lead", action: "Blocked duplicate submission", object: "Prior Authorization Agent · session PA-7731", systemId: "prior-auth-agent", category: "Policy", reason: "Agent behavior guardrail prevented repeat payer submission" },
  { id: "AUD-8985", at: daysFromNow(-2), actor: "Dr. Aisha Karim", actorRole: "Clinical Reviewer", action: "Acknowledged alert", object: "ALT-4805", systemId: "med-interaction", category: "Incident", reason: "Investigating output drift after formulary load" },
  { id: "AUD-8980", at: daysFromNow(-2), actor: "Sofia Ramirez", actorRole: "Data Scientist", action: "Completed validation", object: "30-Day Readmission Risk Model 3.1.0", systemId: "readmission-risk", category: "Validation", reason: "Quarterly validation — Passed" },
  { id: "AUD-8975", at: daysFromNow(-3), actor: "Rachel Kim", actorRole: "Administrator", action: "Modified alert threshold", object: "Bed Capacity Forecaster · census MAPE", systemId: "bed-capacity", category: "Configuration", reason: "Tightened threshold from 8% to 6%" },
  { id: "AUD-8970", at: daysFromNow(-3), actor: "Dr. Priya Nair", actorRole: "Clinical Reviewer", action: "Approved model version", object: "Mammography Density & Lesion Model 6.1.0", systemId: "mammography-ai", category: "Approval", reason: "Vendor refresh validated against internal cohort" },
  { id: "AUD-8965", at: daysFromNow(-4), actor: "James Okonkwo", actorRole: "Compliance Officer", action: "Attached regulatory record", object: "Diabetic Retinopathy Screener · FDA De Novo letter", systemId: "diabetic-retinopathy", category: "Policy", reason: "Annual regulatory documentation refresh" },
  { id: "AUD-8960", at: daysFromNow(-5), actor: "Dr. Naomi Chen", actorRole: "Clinical Reviewer", action: "Rejected promotion", object: "Oncology Treatment Recommendation Model 0.8.0", systemId: "oncology-treatment", category: "Approval", reason: "Subgroup validation incomplete; IRB determination pending" },
  { id: "AUD-8955", at: daysFromNow(-5), actor: "Miguel Santos", actorRole: "Data Scientist", action: "Registered AI system", object: "Referral Coordination Agent", systemId: "referral-agent", category: "Deployment", reason: "New agent entered governance intake" },
  { id: "AUD-8950", at: daysFromNow(-6), actor: "Dr. Aisha Karim", actorRole: "Clinical Reviewer", action: "Resolved incident", object: "INC-1039", systemId: "med-interaction", category: "Incident", reason: "Interaction mappings backfilled; override rate normalized" },
  { id: "AUD-8945", at: daysFromNow(-7), actor: "Priya Deshmukh", actorRole: "Administrator", action: "Updated role permissions", object: "Clinical Reviewer role", category: "Policy", reason: "Granted approval scope for Decision Support category" },
  { id: "AUD-8940", at: daysFromNow(-8), actor: "Dana Whitfield", actorRole: "AI Governance Lead", action: "Approved model version", object: "Revenue Cycle Coding Model 4.0.1", systemId: "rev-cycle-coding", category: "Approval", reason: "Autonomous coding scope expansion validated" },
  { id: "AUD-8935", at: daysFromNow(-9), actor: "Karen Liu", actorRole: "Data Scientist", action: "Changed validation cadence", object: "Fall Risk Assessment Model", systemId: "fall-risk", category: "Configuration", reason: "Reduced cadence to 180 days for low-risk model" },
  { id: "AUD-8930", at: daysFromNow(-10), actor: "Strata monitor", actorRole: "System", action: "Retired model version", object: "Sepsis Risk Predictor 4.1.7", systemId: "sepsis-risk-predictor", category: "Version", reason: "Superseded by 4.2.0" },
  { id: "AUD-8925", at: daysFromNow(-12), actor: "Dr. Owen Fletcher", actorRole: "Clinical Reviewer", action: "Completed validation", object: "Acute Kidney Injury Predictor 2.2.1", systemId: "aki-predictor", category: "Validation", reason: "Quarterly validation — Passed" },
  { id: "AUD-8920", at: daysFromNow(-14), actor: "Priya Deshmukh", actorRole: "Administrator", action: "Connected integration", object: "Epic FHIR R4 endpoint", category: "Configuration", reason: "Enabled real-time vitals streaming" },
];

export function auditForSystem(systemId: string): AuditEvent[] {
  return auditEvents.filter((e) => e.systemId === systemId);
}
