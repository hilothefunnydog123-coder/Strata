import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();
const hash = (p) => bcrypt.hashSync(p, 10);

// ---------------------------------------------------------------------------
// Time + math helpers. Everything is anchored to real wall-clock time so the
// seeded telemetry lines up with the app's `NOW` clock and relative timestamps.
// ---------------------------------------------------------------------------
const now = Date.now();
const dayMs = 86400000;
const ago = (d) => new Date(now - d * dayMs);
const fromNow = (d) => new Date(now + d * dayMs);
const round = (n, dp = 4) => {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function seedNum(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h % 997;
}

// ---------------------------------------------------------------------------
// Telemetry generator — real MetricPoint rows. The aggregation layer buckets
// these into daily means and derives every health / performance / drift /
// fairness summary from them, exactly like ingested customer data.
// ---------------------------------------------------------------------------
const metricPoints = [];

/**
 * Push one MetricPoint per day (or per `stepDays`) for the last 90 days.
 *   value = baseline + slopePerDay*(90-d) + organic jitter (+ ramped event)
 * clamped to [min,max]. `event = { atDayAgo, delta, ramp }` applies a gradual
 * step so that by day 0 the value has shifted by `delta`.
 */
function series(systemId, metric, baseline, opts = {}) {
  const {
    slopePerDay = 0,
    noise = 0,
    event = null,
    min = 0,
    max = 100,
    subgroup = null,
    stepDays = 1,
  } = opts;
  const off = seedNum(systemId + metric + (subgroup ?? ""));
  for (let d = 90; d >= 0; d -= stepDays) {
    const jitter =
      noise *
      (Math.sin((d + off) * 0.9) * 0.6 + Math.sin((d + off) * 0.37 + 1.3) * 0.4);
    let v = baseline + slopePerDay * (90 - d) + jitter;
    if (event) {
      const ramp = event.ramp ?? 4;
      v += event.delta * clamp((event.atDayAgo - d) / ramp, 0, 1);
    }
    metricPoints.push({
      systemId,
      metric,
      value: round(clamp(v, min, max)),
      subgroup,
      ts: ago(d),
    });
  }
}

// Emit the full metric family for one system. `sys-medrec` opts out entirely
// so the UI renders its honest "awaiting telemetry" empty state.
function emitMetrics(s) {
  if (s.noTelemetry) return;
  const hv = s.headlineValue;
  const isAuroc = s.headlineLabel.toLowerCase() === "auroc";
  const o = s.ops;
  const perfEvent = s.degraded ? { atDayAgo: 30, delta: -5, ramp: 6 } : null;

  // Performance family — every metric shares the same downward event when degraded.
  series(s.id, "auroc", isAuroc ? hv : Math.min(99, hv + 2), { noise: 0.4, min: 40, max: 99, event: perfEvent });
  series(s.id, "accuracy", isAuroc ? hv - 1 : hv, { noise: 0.4, min: 40, max: 99.5, event: perfEvent });
  series(s.id, "precision", hv - 2, { noise: 0.4, min: 40, max: 99.5, event: perfEvent });
  series(s.id, "recall", hv - 4, { noise: 0.4, min: 40, max: 99.5, event: perfEvent });
  series(s.id, "f1", hv - 3, { noise: 0.4, min: 40, max: 99.5, event: perfEvent });

  // Drift — gentle upward creep when healthy, a hard step when degraded (~0.29).
  series(
    s.id,
    "drift",
    0.05,
    s.degraded
      ? { noise: 0.008, min: 0, max: 1, event: { atDayAgo: 30, delta: 0.24, ramp: 6 } }
      : { slopePerDay: 0.0005, noise: 0.01, min: 0, max: 1 },
  );

  // Human override rate — climbs above baseline 15% when degraded (~16%).
  series(
    s.id,
    "override_rate",
    o.override,
    s.degraded
      ? { noise: 0.7, min: 0, max: 60, event: { atDayAgo: 30, delta: 7, ramp: 6 } }
      : { noise: 0.7, min: 0, max: 60 },
  );

  // Operational health.
  series(s.id, "latency_ms", o.latency, { noise: 15, min: 40, max: 2000 });
  series(s.id, "error_rate", o.err, { noise: 0.02, min: 0, max: 5 });
  series(s.id, "volume", o.vol, { noise: o.vol * 0.08, min: Math.round(o.vol * 0.5), max: o.vol * 2 });
  series(s.id, "confidence", o.conf, { noise: 0.6, min: 40, max: 99.5 });

  // Fairness — subgroup FNR (weekly). The 65+ cohort diverges, opening a ~9pt gap.
  if (s.degraded) {
    series(s.id, "fairness_fnr", 9, { noise: 0.3, min: 0, max: 40, subgroup: "18-40", stepDays: 7 });
    series(s.id, "fairness_fnr", 11, { noise: 0.3, min: 0, max: 40, subgroup: "41-64", stepDays: 7 });
    series(s.id, "fairness_fnr", 12, {
      noise: 0.3, min: 0, max: 40, subgroup: "65+", stepDays: 7,
      event: { atDayAgo: 30, delta: 6, ramp: 5 },
    });
  }
}

// ---------------------------------------------------------------------------
// The Northstar estate — 7 registered systems. Each becomes a RegisteredSystem
// row whose `data` is a full CustomSystemInput; the aggregation layer rebuilds
// the live control-center model from it plus the telemetry above.
// ---------------------------------------------------------------------------
const systems = [
  {
    id: "sys-sepsis",
    name: "Sepsis Risk Predictor",
    description:
      "Continuously scores inpatients for early sepsis onset from vitals, labs, and nursing assessments, surfacing a risk score to the clinical deterioration dashboard.",
    purpose:
      "Detect sepsis hours earlier than standard screening to enable earlier antibiotics and fluid resuscitation.",
    category: "Clinical Prediction",
    modelClass: "Gradient-Boosted Trees",
    owner: "Clinical AI Team",
    ownerContact: "Dr. Elena Marsh",
    department: "Critical Care",
    vendor: "Internal",
    isInternal: true,
    isAgent: false,
    environment: "Production",
    riskLevel: "Critical",
    regulatoryClass: "Clinical Decision Support (Non-Device)",
    dataClassification: "PHI",
    headlineLabel: "AUROC",
    headlineValue: 91,
    inputs: ["Epic EHR — vitals stream", "Laboratory results (CBC, lactate, creatinine)", "Nursing flowsheet assessments"],
    outputs: ["Sepsis risk score (0-100)", "Contributing factors", "Recommended screening action"],
    tags: ["Deterioration", "ICU", "Real-time", "FHIR"],
    deployedDaysAgo: 380,
    ops: { latency: 90, err: 0.12, vol: 900, conf: 88, override: 9 },
    degraded: true,
  },
  {
    id: "sys-chestxray",
    name: "Chest X-ray Triage",
    description:
      "Prioritizes chest radiographs by detecting critical findings including pneumothorax, pleural effusion, and consolidation, reordering the radiologist worklist.",
    purpose: "Reduce time-to-read for critical chest findings and flag likely-normal studies for later review.",
    category: "Medical Imaging",
    modelClass: "Vision Transformer",
    owner: "Radiology Informatics",
    ownerContact: "Dr. Priya Nair",
    department: "Radiology",
    vendor: "Aidoc",
    isInternal: false,
    isAgent: false,
    environment: "Production",
    riskLevel: "High",
    regulatoryClass: "FDA Cleared (510k)",
    dataClassification: "PHI",
    headlineLabel: "AUROC",
    headlineValue: 94,
    inputs: ["PACS — DICOM chest radiographs", "Modality worklist (HL7)"],
    outputs: ["Finding probabilities", "Worklist priority score", "Bounding-box overlays"],
    tags: ["Radiology", "FDA 510k", "Worklist", "Vendor"],
    deployedDaysAgo: 300,
    ops: { latency: 300, err: 0.06, vol: 150, conf: 93, override: 5 },
    degraded: false,
  },
  {
    id: "sys-doccopilot",
    name: "Clinical Documentation Copilot",
    description:
      "Ambient LLM assistant that drafts clinical notes from the encounter conversation, proposing history, assessment, and plan text for clinician review.",
    purpose: "Reduce documentation burden and after-hours charting by drafting encounter notes for physician edit and sign-off.",
    category: "Clinical Documentation",
    modelClass: "Fine-tuned LLM",
    owner: "Digital Health",
    ownerContact: "Dr. Alan Whitmore",
    department: "Hospital Medicine",
    vendor: "Nuance DAX",
    isInternal: false,
    isAgent: false,
    environment: "Production",
    riskLevel: "Moderate",
    regulatoryClass: "Clinical Decision Support (Non-Device)",
    dataClassification: "PHI",
    headlineLabel: "Accuracy",
    headlineValue: 89,
    inputs: ["Ambient encounter audio (transcribed)", "Epic problem list & medications", "Prior encounter notes"],
    outputs: ["Draft note (HPI, A&P)", "Suggested diagnosis codes", "Follow-up orders draft"],
    tags: ["LLM", "Ambient", "Documentation", "Vendor"],
    deployedDaysAgo: 210,
    ops: { latency: 220, err: 0.15, vol: 1200, conf: 88, override: 12 },
    degraded: false,
  },
  {
    id: "sys-priorauth",
    name: "Prior-Authorization Agent",
    description:
      "Autonomous agent that assembles prior-authorization requests: reads the chart, identifies missing documentation, drafts the request, and submits it after clinician approval.",
    purpose: "Cut prior-authorization turnaround time and administrative burden while keeping a human approval gate before submission.",
    category: "Autonomous Agent",
    modelClass: "Agentic LLM System",
    owner: "Revenue Cycle AI",
    ownerContact: "James Okonkwo",
    department: "Revenue Cycle",
    vendor: "Internal",
    isInternal: true,
    isAgent: true,
    environment: "Production",
    riskLevel: "High",
    regulatoryClass: "Enterprise-Validated",
    dataClassification: "PHI",
    headlineLabel: "Accuracy",
    headlineValue: 93,
    inputs: ["Epic chart (notes, orders, results)", "Payer policy database", "Coverage & benefits API"],
    outputs: ["Missing-documentation findings", "Drafted authorization request", "Payer submission"],
    tags: ["Agent", "Autonomous", "Revenue Cycle", "Tool-use"],
    deployedDaysAgo: 120,
    ops: { latency: 300, err: 0.1, vol: 420, conf: 91, override: 9 },
    degraded: false,
  },
  {
    id: "sys-readmit",
    name: "30-Day Readmission Risk",
    description: "Predicts 30-day all-cause readmission at discharge to target care-management and transitional-care resources.",
    purpose: "Reduce avoidable readmissions by prioritizing transitional-care outreach for the highest-risk patients.",
    category: "Clinical Prediction",
    modelClass: "Ensemble",
    owner: "Population Health",
    ownerContact: "Dr. Elena Marsh",
    department: "Care Management",
    vendor: "Internal",
    isInternal: true,
    isAgent: false,
    environment: "Production",
    riskLevel: "High",
    regulatoryClass: "Clinical Decision Support (Non-Device)",
    dataClassification: "PHI",
    headlineLabel: "AUROC",
    headlineValue: 88,
    inputs: ["Epic EHR — encounters, labs", "Claims history", "SDOH indices"],
    outputs: ["Readmission probability", "Top risk drivers"],
    tags: ["Population Health", "Discharge", "Care Management"],
    deployedDaysAgo: 260,
    ops: { latency: 110, err: 0.08, vol: 300, conf: 87, override: 8 },
    degraded: false,
  },
  {
    id: "sys-stroke",
    name: "Stroke Imaging Triage",
    description: "Detects large-vessel occlusion and hemorrhage on head CT/CTA and escalates positive studies to the stroke team.",
    purpose: "Accelerate stroke-pathway activation by flagging actionable findings within seconds of scan completion.",
    category: "Medical Imaging",
    modelClass: "Deep CNN",
    owner: "Radiology Informatics",
    ownerContact: "Dr. Priya Nair",
    department: "Neurology",
    vendor: "Viz.ai",
    isInternal: false,
    isAgent: false,
    environment: "Staging",
    riskLevel: "High",
    regulatoryClass: "FDA Cleared (De Novo)",
    dataClassification: "PHI",
    headlineLabel: "AUROC",
    headlineValue: 92,
    inputs: ["PACS — head CT / CTA (DICOM)", "Modality worklist (HL7)"],
    outputs: ["LVO probability", "Hemorrhage probability", "Slice localization"],
    tags: ["Stroke", "Imaging", "Staging", "FDA De Novo"],
    deployedDaysAgo: 45,
    ops: { latency: 300, err: 0.07, vol: 150, conf: 90, override: 7 },
    degraded: false,
  },
  {
    id: "sys-medrec",
    name: "Medication Reconciliation Assistant",
    description: "Reconciles admission and discharge medication lists, flagging omissions, duplications, and dose discrepancies for pharmacist review.",
    purpose: "Reduce medication errors at care transitions by surfacing reconciliation discrepancies to pharmacy.",
    category: "Medication Safety",
    modelClass: "Transformer (NLP)",
    owner: "Pharmacy Informatics",
    ownerContact: "James Okonkwo",
    department: "Pharmacy",
    vendor: "Internal",
    isInternal: true,
    isAgent: false,
    environment: "Development",
    riskLevel: "Moderate",
    regulatoryClass: "Enterprise-Validated",
    dataClassification: "PHI",
    headlineLabel: "Accuracy",
    headlineValue: 90,
    inputs: ["Epic medication orders", "Home medication list", "Pharmacy dispensing records"],
    outputs: ["Reconciliation discrepancies", "Suggested resolutions"],
    tags: ["Pharmacy", "Medication Safety", "Newly registered"],
    deployedDaysAgo: 20,
    noTelemetry: true,
  },
];

const NAME = Object.fromEntries(systems.map((s) => [s.id, s.name]));

async function main() {
  const ownerEmail = (process.env.OWNER_EMAIL || "owner@ward.health").toLowerCase();
  const ownerPassword = process.env.OWNER_PASSWORD || "ward-owner";
  const ownerName = process.env.OWNER_NAME || "Platform Owner";

  // Platform owner (superadmin). Password only set on first creation so an
  // owner who later changes it isn't reset on redeploy.
  const existingOwner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (existingOwner) {
    await prisma.user.update({
      where: { email: ownerEmail },
      data: { isOwner: true, active: true, name: ownerName },
    });
  } else {
    await prisma.user.create({
      data: {
        email: ownerEmail,
        name: ownerName,
        passwordHash: hash(ownerPassword),
        role: "Owner",
        isOwner: true,
        orgId: null,
      },
    });
  }

  // Northstar demo/sandbox organization (shows the fully populated estate).
  const org = await prisma.organization.upsert({
    where: { slug: "northstar-health" },
    update: { seededDemo: true, active: true, name: "Northstar Health System", plan: "Enterprise" },
    create: {
      name: "Northstar Health System",
      slug: "northstar-health",
      plan: "Enterprise",
      seededDemo: true,
      active: true,
    },
  });

  const demoUsers = [
    { email: "elena.marsh@northstarhealth.org", name: "Dr. Elena Marsh", role: "AI Governance Lead" },
    { email: "alan.whitmore@northstarhealth.org", name: "Dr. Alan Whitmore", role: "Executive" },
    { email: "james.okonkwo@northstarhealth.org", name: "James Okonkwo", role: "Compliance Officer" },
  ];
  for (const u of demoUsers) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) {
      await prisma.user.update({
        where: { email: u.email },
        data: { name: u.name, role: u.role, orgId: org.id, active: true },
      });
    } else {
      await prisma.user.create({
        data: { email: u.email, name: u.name, role: u.role, orgId: org.id, passwordHash: hash("ward-demo") },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Idempotency — wipe this org's demo child rows so reseeding is clean.
  // Order respects FKs (incidentEvent/agentEvent cascade from their parents).
  // Other orgs are never touched.
  // -------------------------------------------------------------------------
  await prisma.metricPoint.deleteMany({ where: { orgId: org.id } });
  await prisma.alert.deleteMany({ where: { orgId: org.id } });
  await prisma.alertRule.deleteMany({ where: { orgId: org.id } });
  await prisma.incident.deleteMany({ where: { orgId: org.id } });
  await prisma.validationRun.deleteMany({ where: { orgId: org.id } });
  await prisma.governanceItem.deleteMany({ where: { orgId: org.id } });
  await prisma.roiRecord.deleteMany({ where: { orgId: org.id } });
  await prisma.auditEvent.deleteMany({ where: { orgId: org.id } });
  await prisma.agentSession.deleteMany({ where: { orgId: org.id } });
  await prisma.apiKey.deleteMany({ where: { orgId: org.id } });
  await prisma.registeredSystem.deleteMany({ where: { orgId: org.id } });

  // -------------------------------------------------------------------------
  // Registered systems + telemetry.
  // -------------------------------------------------------------------------
  for (const s of systems) {
    const input = {
      id: s.id,
      name: s.name,
      description: s.description,
      purpose: s.purpose,
      category: s.category,
      modelClass: s.modelClass,
      owner: s.owner,
      ownerContact: s.ownerContact,
      department: s.department,
      vendor: s.isInternal ? "Internal" : s.vendor,
      isInternal: s.isInternal,
      isAgent: s.isAgent,
      environment: s.environment,
      riskLevel: s.riskLevel,
      regulatoryClass: s.regulatoryClass,
      dataClassification: s.dataClassification,
      headlineLabel: s.headlineLabel,
      headlineValue: s.headlineValue,
      inputs: s.inputs,
      outputs: s.outputs,
      tags: s.tags,
      registeredBy: s.ownerContact,
      createdAt: now - s.deployedDaysAgo * dayMs,
    };
    await prisma.registeredSystem.create({
      data: { id: s.id, orgId: org.id, data: JSON.stringify(input), createdAt: ago(s.deployedDaysAgo) },
    });
    emitMetrics(s);
  }

  // Batch-insert the ~6k MetricPoint rows (chunked for SQLite).
  const points = metricPoints.map((p) => ({ orgId: org.id, ...p }));
  for (let i = 0; i < points.length; i += 1000) {
    await prisma.metricPoint.createMany({ data: points.slice(i, i + 1000) });
  }

  // -------------------------------------------------------------------------
  // Demo ingestion API key — fixed plaintext so it can actually be used to
  // POST telemetry to /api/ingest/metrics against the Northstar org.
  // -------------------------------------------------------------------------
  const DEMO_KEY = "wk_live_demo0000northstar0000000000000000";
  const keyHash = crypto.createHash("sha256").update(DEMO_KEY).digest("hex");
  await prisma.apiKey.create({
    data: {
      orgId: org.id,
      name: "Demo ingestion key",
      prefix: DEMO_KEY.slice(0, 12),
      hash: keyHash,
      scopes: "ingest",
      createdBy: "Platform Owner",
    },
  });

  // -------------------------------------------------------------------------
  // Incidents (+ timelines).
  // -------------------------------------------------------------------------
  await prisma.incident.create({
    data: {
      orgId: org.id,
      systemId: "sys-sepsis",
      systemName: NAME["sys-sepsis"],
      title: "Sepsis model AUROC decline and subgroup FNR gap",
      severity: "SEV-2",
      status: "Investigating",
      detectedBy: "Ward drift monitor",
      owner: "Dr. Elena Marsh",
      description:
        "AUROC fell below its 87% threshold while the false-negative rate for the 65+ cohort rose sharply, indicating degraded recall on the emergency-department feed.",
      impact: "Elevated missed-sepsis risk for 65+ cohort",
      affectedPeriod: "Last 30 days",
      affectedPopulation: "Inpatients age 65+ on the ED admission feed",
      suspectedCause: "Upstream lab-units schema change on ED feed",
      relatedVersion: "2.4.1",
      openedAt: ago(8),
      events: {
        create: [
          { at: ago(8), actor: "Ward drift monitor", kind: "detect", text: "AUROC dropped below the 87% threshold and 65+ FNR climbed past policy." },
          { at: ago(6), actor: "Dr. Elena Marsh", kind: "action", text: "Paged the clinical-AI on-call and opened an investigation into the ED interface feed." },
          { at: ago(3), actor: "James Okonkwo", kind: "comment", text: "Confirmed an upstream lab-units change on the ED interface as the suspected root cause." },
        ],
      },
    },
  });

  await prisma.incident.create({
    data: {
      orgId: org.id,
      systemId: "sys-doccopilot",
      systemName: NAME["sys-doccopilot"],
      title: "Latency spike after model update",
      severity: "SEV-3",
      status: "Resolved",
      detectedBy: "Ward latency monitor",
      owner: "Dr. Alan Whitmore",
      description: "p95 inference latency exceeded budget for several hours following the 2.4.0 vendor model rollout.",
      impact: "Delayed note drafting during morning clinics",
      affectedPeriod: "6 hours on the day of the 2.4.0 rollout",
      suspectedCause: "Autoscaling misconfiguration after the model update",
      rootCause: "The 2.4.0 deploy shipped an autoscaling policy that scaled inference replicas down under load, starving the request queue.",
      resolution: "Reverted the autoscaling policy and pinned a minimum replica count; p95 latency returned to baseline within the hour.",
      relatedVersion: "2.4.0",
      openedAt: ago(26),
      resolvedAt: ago(20),
      events: {
        create: [
          { at: ago(26), actor: "Ward latency monitor", kind: "detect", text: "p95 latency exceeded the 4s budget shortly after the 2.4.0 rollout." },
          { at: ago(22), actor: "Dr. Alan Whitmore", kind: "action", text: "Rolled back the autoscaling policy and added replica headroom." },
          { at: ago(20), actor: "Dr. Alan Whitmore", kind: "resolve", text: "Latency recovered to baseline and held; incident resolved." },
        ],
      },
    },
  });

  // -------------------------------------------------------------------------
  // Validation runs.
  // -------------------------------------------------------------------------
  const passTest = (key, label, description) => ({ key, label, description, status: "Passed" });
  await prisma.validationRun.create({
    data: {
      orgId: org.id,
      systemId: "sys-chestxray",
      systemName: NAME["sys-chestxray"],
      version: "3.2.0",
      dataset: "Held-out chest radiograph cohort",
      datasetSize: 5000,
      requestedBy: "Dr. Priya Nair",
      status: "Passed",
      result: "Passed",
      progress: 100,
      startedAt: ago(15),
      completedAt: ago(14),
      tests: JSON.stringify([
        passTest("discrimination", "Discrimination (AUROC)", "AUROC on the held-out set meets the acceptance threshold."),
        passTest("calibration", "Calibration", "Brier score and calibration slope within tolerance."),
        passTest("subgroup", "Subgroup parity", "FNR gap across age and sex within policy."),
        passTest("robustness", "Device robustness", "Stable performance across scanner manufacturers."),
      ]),
      metrics: JSON.stringify([
        { metric: "AUROC", value: 0.94, threshold: 0.9, betterWhen: "higher", status: "good" },
        { metric: "Sensitivity", value: 92, threshold: 88, betterWhen: "higher", status: "good", unit: "%" },
        { metric: "Specificity", value: 93, threshold: 88, betterWhen: "higher", status: "good", unit: "%" },
      ]),
      subgroups: JSON.stringify([]),
    },
  });

  await prisma.validationRun.create({
    data: {
      orgId: org.id,
      systemId: "sys-sepsis",
      systemName: NAME["sys-sepsis"],
      version: "2.4.1",
      dataset: "Inpatient sepsis validation cohort",
      datasetSize: 4200,
      requestedBy: "Dr. Elena Marsh",
      status: "Passed with warnings",
      result: "Passed with warnings",
      progress: 100,
      startedAt: ago(41),
      completedAt: ago(40),
      tests: JSON.stringify([
        passTest("discrimination", "Discrimination (AUROC)", "AUROC meets the acceptance threshold on the full cohort."),
        passTest("calibration", "Calibration", "Calibration within tolerance across risk deciles."),
        { key: "subgroup", label: "Subgroup parity", description: "FNR gap across age subgroups.", status: "Warning", detail: "FNR for the 65+ cohort trends above the parity band; monitor and re-validate." },
        passTest("robustness", "Feature robustness", "Stable to missing-value imputation across sites."),
      ]),
      metrics: JSON.stringify([
        { metric: "AUROC", value: 0.9, threshold: 0.87, betterWhen: "higher", status: "good" },
        { metric: "FNR gap (age)", value: 4.2, threshold: 3, betterWhen: "lower", status: "warning", unit: "pts" },
      ]),
      subgroups: JSON.stringify([]),
    },
  });

  await prisma.validationRun.create({
    data: {
      orgId: org.id,
      systemId: "sys-readmit",
      systemName: NAME["sys-readmit"],
      version: "1.8.0",
      dataset: "Discharge readmission validation cohort",
      datasetSize: 8000,
      requestedBy: "James Okonkwo",
      status: "Passed",
      result: "Passed",
      progress: 100,
      startedAt: ago(31),
      completedAt: ago(30),
      tests: JSON.stringify([
        passTest("discrimination", "Discrimination (AUROC)", "AUROC meets the acceptance threshold."),
        passTest("calibration", "Calibration", "Calibration within tolerance across risk deciles."),
        passTest("subgroup", "Subgroup parity", "No material disparities across monitored subgroups."),
      ]),
      metrics: JSON.stringify([
        { metric: "AUROC", value: 0.88, threshold: 0.84, betterWhen: "higher", status: "good" },
        { metric: "Sensitivity", value: 84, threshold: 80, betterWhen: "higher", status: "good", unit: "%" },
      ]),
      subgroups: JSON.stringify([]),
    },
  });

  // -------------------------------------------------------------------------
  // Governance workflows.
  // -------------------------------------------------------------------------
  const step = (key, name, owner, ownerRole, status) => ({ key, name, owner, ownerRole, status, requiredDocs: [] });
  await prisma.governanceItem.create({
    data: {
      orgId: org.id,
      systemId: "sys-stroke",
      systemName: NAME["sys-stroke"],
      category: "Medical Imaging",
      vendor: "Viz.ai",
      riskLevel: "High",
      submittedBy: "Dr. Elena Marsh",
      currentStage: "Clinical Validation",
      status: "In review",
      targetGoLive: fromNow(30),
      submittedAt: ago(40),
      steps: JSON.stringify([
        step("intake", "Governance intake", "James Okonkwo", "Compliance Officer", "Complete"),
        step("risk", "Risk assessment", "Dr. Elena Marsh", "AI Governance Lead", "Complete"),
        step("clinical-val", "Clinical validation", "Dr. Elena Marsh", "AI Governance Lead", "In progress"),
        step("signoff", "Executive sign-off", "Dr. Alan Whitmore", "Executive", "Pending"),
      ]),
    },
  });

  await prisma.governanceItem.create({
    data: {
      orgId: org.id,
      systemId: "sys-priorauth",
      systemName: NAME["sys-priorauth"],
      category: "Autonomous Agent",
      vendor: "Internal",
      riskLevel: "High",
      submittedBy: "Dr. Elena Marsh",
      currentStage: "Approved for production",
      status: "Approved",
      targetGoLive: ago(90),
      submittedAt: ago(120),
      steps: JSON.stringify([
        step("intake", "Governance intake", "James Okonkwo", "Compliance Officer", "Complete"),
        step("risk", "Risk assessment", "Dr. Elena Marsh", "AI Governance Lead", "Complete"),
        step("clinical-val", "Enterprise validation", "Dr. Elena Marsh", "AI Governance Lead", "Complete"),
        step("signoff", "Executive sign-off", "Dr. Alan Whitmore", "Executive", "Complete"),
      ]),
    },
  });

  // -------------------------------------------------------------------------
  // Alerts (all active, all on the degraded sepsis model) + alert rules.
  // -------------------------------------------------------------------------
  await prisma.alert.createMany({
    data: [
      {
        orgId: org.id, systemId: "sys-sepsis", systemName: NAME["sys-sepsis"],
        category: "Performance", severity: "High", title: "AUROC below threshold (86.2% < 87%)",
        recommendedAction: "Review the ED lab-units schema change and consider rolling back to the last validated feature pipeline.",
        status: "Active", linkTab: "performance", at: ago(2),
      },
      {
        orgId: org.id, systemId: "sys-sepsis", systemName: NAME["sys-sepsis"],
        category: "Drift", severity: "High", title: "Population drift 0.29 exceeds 0.20",
        recommendedAction: "Investigate the upstream population and feature-distribution shift on the ED feed before the next scoring window.",
        status: "Active", linkTab: "drift", at: ago(3),
      },
      {
        orgId: org.id, systemId: "sys-sepsis", systemName: NAME["sys-sepsis"],
        category: "Fairness", severity: "Critical", title: "FNR gap 9pts across age subgroups",
        recommendedAction: "Escalate to the fairness review board; missed-sepsis risk is concentrated in the 65+ cohort.",
        status: "Active", linkTab: "fairness", at: ago(1),
      },
    ],
  });

  await prisma.alertRule.createMany({
    data: [
      { orgId: org.id, category: "Performance", metric: "auroc", op: "lt", threshold: 87, severity: "High", enabled: true },
      { orgId: org.id, category: "Drift", metric: "drift", op: "gt", threshold: 0.2, severity: "High", enabled: true },
      { orgId: org.id, category: "Performance", metric: "override_rate", op: "gt", threshold: 15, severity: "Medium", enabled: true },
      { orgId: org.id, category: "Fairness", metric: "fairness_fnr", op: "gt", threshold: 16, severity: "Critical", enabled: true },
    ],
  });

  // -------------------------------------------------------------------------
  // ROI records for the five production systems.
  // -------------------------------------------------------------------------
  const roi = [
    {
      systemId: "sys-sepsis", annualImpact: 3_100_000, implementationCost: 610_000, operatingCost: 240_000,
      headlineLabel: "Earlier sepsis intervention", headlineValue: "312 sepsis cases/yr", updatedBy: "Dr. Alan Whitmore",
      breakdown: [
        { label: "Earlier antibiotic administration", value: 1_800_000, unit: "$" },
        { label: "Reduced ICU length of stay", value: 1_100_000, unit: "$" },
        { label: "Bedside minutes saved per screen", value: 4.2, unit: "hrs" },
      ],
    },
    {
      systemId: "sys-chestxray", annualImpact: 2_400_000, implementationCost: 720_000, operatingCost: 310_000,
      headlineLabel: "Critical-finding turnaround", headlineValue: "-41 minutes", updatedBy: "Dr. Priya Nair",
      breakdown: [
        { label: "Faster critical-finding escalation", value: 1_500_000, unit: "$" },
        { label: "Radiologist reading efficiency", value: 900_000, unit: "$" },
        { label: "Reading time saved", value: 3_100, unit: "hrs" },
      ],
    },
    {
      systemId: "sys-doccopilot", annualImpact: 4_800_000, implementationCost: 380_000, operatingCost: 400_000,
      headlineLabel: "Documentation time saved", headlineValue: "1.6 hrs / clinician / day", updatedBy: "Dr. Alan Whitmore",
      breakdown: [
        { label: "After-hours charting reduced", value: 3_200_000, unit: "$" },
        { label: "Increased visit throughput", value: 1_600_000, unit: "$" },
        { label: "Clinician documentation hours saved", value: 41_000, unit: "hrs" },
      ],
    },
    {
      systemId: "sys-priorauth", annualImpact: 2_600_000, implementationCost: 540_000, operatingCost: 300_000,
      headlineLabel: "Authorization turnaround", headlineValue: "3.1 days to 6 hours", updatedBy: "James Okonkwo",
      breakdown: [
        { label: "Administrative FTE hours avoided", value: 1_800_000, unit: "$" },
        { label: "Reduced peer-to-peer denials", value: 800_000, unit: "$" },
        { label: "Coordinator hours saved", value: 22_000, unit: "hrs" },
      ],
    },
    {
      systemId: "sys-readmit", annualImpact: 1_600_000, implementationCost: 300_000, operatingCost: 180_000,
      headlineLabel: "Readmission rate reduction", headlineValue: "-2.4 points", updatedBy: "Dr. Elena Marsh",
      breakdown: [
        { label: "Avoided readmission penalties", value: 900_000, unit: "$" },
        { label: "Care-management efficiency", value: 700_000, unit: "$" },
      ],
    },
  ];
  await prisma.roiRecord.createMany({
    data: roi.map((r) => ({ orgId: org.id, ...r, breakdown: JSON.stringify(r.breakdown) })),
  });

  // -------------------------------------------------------------------------
  // Agent sessions (+ event timelines) for the Prior-Authorization Agent.
  // -------------------------------------------------------------------------
  const s1 = now - 2 * dayMs;
  const at1 = (sec) => new Date(s1 + sec * 1000);
  await prisma.agentSession.create({
    data: {
      orgId: org.id,
      systemId: "sys-priorauth",
      label: "PA-2026-8841",
      subject: "Patient ****3921",
      status: "Completed",
      outcome: "Prior auth approved and submitted",
      riskFlags: JSON.stringify([]),
      anomalyScore: 0.1,
      startedAt: at1(0),
      endedAt: at1(255),
      events: {
        create: [
          { step: 1, at: at1(0), kind: "session", summary: "Session started for prior-authorization assembly", status: "normal" },
          { step: 2, at: at1(25), kind: "read", summary: "Read chart: notes, orders, and results", dataSource: "Epic EHR", status: "normal", durationMs: 4200 },
          { step: 3, at: at1(70), kind: "tool", summary: "Queried payer policy for medical-necessity criteria", tool: "payer-policy-db", status: "normal", durationMs: 3100 },
          { step: 4, at: at1(130), kind: "decision", summary: "Determined documentation complete; no gaps found", status: "normal" },
          { step: 5, at: at1(200), kind: "generate", summary: "Drafted the prior-authorization request", status: "normal", durationMs: 5200 },
          { step: 6, at: at1(255), kind: "submit", summary: "Submitted authorization to the payer portal after clinician approval", tool: "payer-portal", status: "approved", durationMs: 2600 },
        ],
      },
    },
  });

  const s2 = now - 1 * dayMs;
  const at2 = (sec) => new Date(s2 + sec * 1000);
  await prisma.agentSession.create({
    data: {
      orgId: org.id,
      systemId: "sys-priorauth",
      label: "PA-2026-8859",
      subject: "Patient ****5108",
      status: "Awaiting approval",
      outcome: "Pending physician approval before submission",
      riskFlags: JSON.stringify(["High-cost medication", "Manual review required"]),
      anomalyScore: 0.4,
      startedAt: at2(0),
      events: {
        create: [
          { step: 1, at: at2(0), kind: "session", summary: "Session started for high-cost medication authorization", status: "normal" },
          { step: 2, at: at2(30), kind: "read", summary: "Read chart and specialty-medication order", dataSource: "Epic EHR", status: "normal", durationMs: 4600 },
          { step: 3, at: at2(85), kind: "tool", summary: "Checked formulary and benefits coverage", tool: "benefits-api", status: "flagged", durationMs: 3300, riskNote: "High-cost specialty medication exceeds auto-submit ceiling" },
          { step: 4, at: at2(160), kind: "generate", summary: "Drafted the authorization with clinical justification", status: "normal", durationMs: 5400 },
          { step: 5, at: at2(220), kind: "approval", summary: "Awaiting physician approval before payer submission", status: "pending", riskNote: "Manual review required for high-cost medication" },
        ],
      },
    },
  });

  // -------------------------------------------------------------------------
  // Audit trail — a realistic spread over the last 60 days.
  // -------------------------------------------------------------------------
  await prisma.auditEvent.createMany({
    data: [
      { orgId: org.id, at: ago(8), actor: "Ward drift monitor", actorRole: "System", action: "Opened incident", object: NAME["sys-sepsis"], systemId: "sys-sepsis", category: "Incident", reason: "AUROC decline and 65+ FNR gap detected" },
      { orgId: org.id, at: ago(1), actor: "Dr. Elena Marsh", actorRole: "AI Governance Lead", action: "Acknowledged fairness alert", object: NAME["sys-sepsis"], systemId: "sys-sepsis", category: "Policy", reason: "FNR disparity exceeded policy for the 65+ cohort" },
      { orgId: org.id, at: ago(14), actor: "Dr. Priya Nair", actorRole: "Clinical Reviewer", action: "Deployed version 3.2.0", object: NAME["sys-chestxray"], systemId: "sys-chestxray", category: "Deployment", reason: "Vendor model refresh validated against internal cohort" },
      { orgId: org.id, at: ago(30), actor: "Dr. Alan Whitmore", actorRole: "Executive", action: "Approved for production", object: NAME["sys-priorauth"], systemId: "sys-priorauth", category: "Approval", reason: "Enterprise validation passed; approval gate retained" },
      { orgId: org.id, at: ago(30), actor: "James Okonkwo", actorRole: "Compliance Officer", action: "Recorded validation decision", object: NAME["sys-readmit"], systemId: "sys-readmit", category: "Validation", reason: "Quarterly validation — Passed" },
      { orgId: org.id, at: ago(40), actor: "Dr. Elena Marsh", actorRole: "AI Governance Lead", action: "Submitted for governance review", object: NAME["sys-stroke"], systemId: "sys-stroke", category: "Approval", reason: "New imaging model entered governance intake" },
      { orgId: org.id, at: ago(20), actor: "James Okonkwo", actorRole: "Compliance Officer", action: "Registered AI system", object: NAME["sys-medrec"], systemId: "sys-medrec", category: "Deployment", reason: "New medication-safety model registered in development" },
      { orgId: org.id, at: ago(20), actor: "Dr. Alan Whitmore", actorRole: "Executive", action: "Resolved incident", object: NAME["sys-doccopilot"], systemId: "sys-doccopilot", category: "Incident", reason: "Latency recovered after autoscaling fix" },
      { orgId: org.id, at: ago(35), actor: "Dr. Elena Marsh", actorRole: "AI Governance Lead", action: "Updated alert threshold", object: `${NAME["sys-sepsis"]} · AUROC`, systemId: "sys-sepsis", category: "Configuration", reason: "Set the AUROC alert threshold to 87%" },
      { orgId: org.id, at: ago(50), actor: "Platform Owner", actorRole: "Administrator", action: "Issued ingestion API key", object: "Demo ingestion key", category: "Access", reason: "Provisioned telemetry ingestion for the Northstar sandbox" },
    ],
  });

  console.log(`Seed complete. Owner: ${ownerEmail} · Demo org: ${org.name}`);
  console.log(`Demo ingestion API key (plaintext): ${DEMO_KEY}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
