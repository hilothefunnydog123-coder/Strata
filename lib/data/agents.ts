import { minutesFromNow, hoursFromNow } from "../format";
import type { AgentAction, AgentPolicy, AgentSession } from "../types";

// A time base for the normal reference session (from the demo brief).
const T = (h: number, m: number, s: number) =>
  new Date(Date.UTC(2026, 2, 18, h, m, s)).toISOString();

/** The canonical, well-behaved Prior Auth session (matches the demo timeline). */
export const priorAuthActions: AgentAction[] = [
  { id: "A1", sessionId: "PA-7728", at: T(9, 42, 11), step: 1, kind: "session", summary: "Session started for authorization request", detail: "Cardiac MRI prior authorization · Payer: Meridian Health Plan", status: "normal" },
  { id: "A2", sessionId: "PA-7728", at: T(9, 42, 11), step: 2, kind: "read", summary: "Opened patient record", detail: "Retrieved encounter, orders, and coverage context", tool: "epic.chart.read", dataSource: "Epic EHR", status: "normal", durationMs: 1400 },
  { id: "A3", sessionId: "PA-7728", at: T(9, 42, 13), step: 3, kind: "read", summary: "Read 43 clinical documents", detail: "Progress notes, cardiology consult, prior imaging reports", tool: "epic.documents.query", dataSource: "Epic EHR", status: "normal", durationMs: 5100 },
  { id: "A4", sessionId: "PA-7728", at: T(9, 42, 19), step: 4, kind: "tool", summary: "Queried payer medical-necessity policy", detail: "Meridian cardiac MRI policy CM-118", tool: "payer.policy.lookup", dataSource: "Payer policy DB", status: "normal", durationMs: 900 },
  { id: "A5", sessionId: "PA-7728", at: T(9, 42, 21), step: 5, kind: "decision", summary: "Identified missing documentation", detail: "Policy requires a failed stress test within 90 days; not found in chart", status: "normal" },
  { id: "A6", sessionId: "PA-7728", at: T(9, 42, 25), step: 6, kind: "generate", summary: "Generated request to physician", detail: "Drafted a query for the missing stress-test result", tool: "message.compose", status: "pending" },
  { id: "A7", sessionId: "PA-7728", at: T(9, 42, 27), step: 7, kind: "message", summary: "Sent documentation query to Dr. Alvarez", detail: "Secure message requesting stress-test confirmation", tool: "inbasket.send", dataSource: "Epic In Basket", status: "normal" },
  { id: "A8", sessionId: "PA-7728", at: T(9, 43, 2), step: 8, kind: "approval", summary: "Physician approved action", detail: "Dr. Alvarez confirmed stress test on Feb 20 and approved submission", status: "approved" },
  { id: "A9", sessionId: "PA-7728", at: T(9, 43, 4), step: 9, kind: "submit", summary: "Submitted authorization to payer", detail: "Assembled packet submitted to Meridian portal; tracking MER-4471192", tool: "payer.portal.submit", dataSource: "Payer portal", status: "normal", durationMs: 2200 },
  { id: "A10", sessionId: "PA-7728", at: T(9, 43, 6), step: 10, kind: "tool", summary: "Wrote authorization status back to chart", detail: "Auth pending; tracking number recorded on the order", tool: "epic.order.update", dataSource: "Epic EHR", status: "normal", durationMs: 700 },
];

/** The anomalous session flagged by the behavior model (drives ALT-4815). */
export const anomalyActions: AgentAction[] = [
  { id: "B1", sessionId: "PA-7731", at: T(7, 12, 3), step: 1, kind: "session", summary: "Session started for authorization request", detail: "MRI lumbar spine · Payer: Northwind Insurance", status: "normal" },
  { id: "B2", sessionId: "PA-7731", at: T(7, 12, 4), step: 2, kind: "read", summary: "Opened patient record", tool: "epic.chart.read", dataSource: "Epic EHR", status: "normal", durationMs: 1200 },
  { id: "B3", sessionId: "PA-7731", at: T(7, 12, 9), step: 3, kind: "tool", summary: "Queried payer policy (retry loop begins)", detail: "Policy endpoint returned an ambiguous conservative-care requirement", tool: "payer.policy.lookup", dataSource: "Payer policy DB", status: "normal", durationMs: 950 },
  { id: "B4", sessionId: "PA-7731", at: T(7, 13, 40), step: 4, kind: "tool", summary: "Repeated policy queries — 22 calls in 90 seconds", detail: "Planner entered a retry loop reconciling conflicting criteria", tool: "payer.policy.lookup", dataSource: "Payer policy DB", status: "flagged", riskNote: "Tool-call rate 14x median for this step" },
  { id: "B5", sessionId: "PA-7731", at: T(7, 15, 2), step: 5, kind: "anomaly", summary: "Behavior model flagged unusual action sequence", detail: "Session action count reached 139 (median 41); anomaly score 0.86", status: "flagged", riskNote: "Anomaly score 0.86 · Repeated-action pattern" },
  { id: "B6", sessionId: "PA-7731", at: T(7, 15, 20), step: 6, kind: "submit", summary: "Submission attempt #1", detail: "Assembled packet submitted to Northwind portal", tool: "payer.portal.submit", dataSource: "Payer portal", status: "normal", durationMs: 2400 },
  { id: "B7", sessionId: "PA-7731", at: T(7, 15, 44), step: 7, kind: "submit", summary: "Duplicate submission attempts #2-#4 blocked", detail: "Idempotency guardrail blocked 3 repeat submissions within 24 seconds", tool: "payer.portal.submit", dataSource: "Payer portal", status: "blocked", riskNote: "Duplicate-submission guardrail engaged" },
  { id: "B8", sessionId: "PA-7731", at: T(7, 16, 10), step: 8, kind: "decision", summary: "Session halted for human review", detail: "Agent paused; escalation routed to Revenue Cycle AI on-call", status: "pending", riskNote: "Auto-halt on anomaly threshold" },
];

export const agentActionsBySession: Record<string, AgentAction[]> = {
  "PA-7728": priorAuthActions,
  "PA-7731": anomalyActions,
};

export const agentSessions: AgentSession[] = [
  {
    id: "PA-7728",
    systemId: "prior-auth-agent",
    label: "Auth PA-7728",
    subject: "Patient ****1187 · Cardiac MRI",
    startedAt: minutesFromNow(-24),
    endedAt: minutesFromNow(-21),
    actionCount: 10,
    toolCalls: 6,
    status: "Completed",
    outcome: "Authorization submitted after physician approval; status written back to Epic",
    riskFlags: [],
    anomalyScore: 0.07,
  },
  {
    id: "PA-7726",
    systemId: "prior-auth-agent",
    label: "Auth PA-7726",
    subject: "Patient ****8830 · PET-CT oncology",
    startedAt: hoursFromNow(-1.5),
    endedAt: hoursFromNow(-1.4),
    actionCount: 12,
    toolCalls: 7,
    status: "Awaiting approval",
    outcome: "Draft prepared; awaiting oncologist approval before submission",
    riskFlags: [],
    anomalyScore: 0.09,
  },
  {
    id: "PA-7719",
    systemId: "prior-auth-agent",
    label: "Auth PA-7719",
    subject: "Patient ****4471 · Sleep study",
    startedAt: hoursFromNow(-3),
    endedAt: hoursFromNow(-2.95),
    actionCount: 9,
    toolCalls: 5,
    status: "Completed",
    outcome: "Authorization approved by payer within session",
    riskFlags: [],
    anomalyScore: 0.05,
  },
  {
    id: "PA-7731",
    systemId: "prior-auth-agent",
    label: "Auth PA-7731",
    subject: "Patient ****3092 · MRI lumbar spine",
    startedAt: hoursFromNow(-8),
    endedAt: hoursFromNow(-7.9),
    actionCount: 139,
    toolCalls: 71,
    status: "Blocked",
    outcome: "Halted on anomaly; duplicate submissions blocked; escalated to on-call",
    riskFlags: ["Repeated tool calls", "Duplicate submission blocked", "Anomaly score 0.86"],
    anomalyScore: 0.86,
  },
];

export const agentPolicies: AgentPolicy[] = [
  { tool: "epic.chart.read", scope: "Read patient chart context", requiresApproval: false, used24h: 5820, status: "Within policy" },
  { tool: "epic.documents.query", scope: "Retrieve clinical documents", requiresApproval: false, used24h: 4110, status: "Within policy" },
  { tool: "payer.policy.lookup", scope: "Query payer medical-necessity policy", requiresApproval: false, used24h: 2740, status: "Elevated" },
  { tool: "message.compose", scope: "Draft clinician messages", requiresApproval: false, used24h: 610, status: "Within policy" },
  { tool: "inbasket.send", scope: "Send secure clinician message", requiresApproval: false, used24h: 590, status: "Within policy" },
  { tool: "payer.portal.submit", scope: "Submit authorization to payer", requiresApproval: true, used24h: 512, status: "Within policy" },
  { tool: "epic.order.update", scope: "Write authorization status to chart", requiresApproval: true, used24h: 505, status: "Within policy" },
];

export const agentStats = {
  activeSessions: 3,
  sessions24h: 214,
  actions24h: 4820,
  toolCalls24h: 2610,
  humanApprovals24h: 198,
  blockedActions24h: 7,
  anomaliesFlagged24h: 1,
  approvalBypassAttempts24h: 0,
};
