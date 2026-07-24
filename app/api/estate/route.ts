import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import {
  getAgentActions,
  getAgentSessions,
  getAlerts,
  getAuditEvents,
  getEstateStats,
  getGovernance,
  getIncidents,
  getOrgSystems,
  getValidationRuns,
} from "@/lib/server/estate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One read that hydrates the whole console for the signed-in org. Writes still
// go to the individual resource routes; this is the single source for reads.
export async function GET() {
  try {
    const user = await requireUser();
    if (!user.org) {
      return NextResponse.json({ empty: true, isDemo: false });
    }
    const orgId = user.org.id;
    const [systems, alerts, incidents, audit, sessions, actions, validations, governance] =
      await Promise.all([
        getOrgSystems(orgId),
        getAlerts(orgId),
        getIncidents(orgId),
        getAuditEvents(orgId),
        getAgentSessions(orgId),
        getAgentActions(orgId),
        getValidationRuns(orgId),
        getGovernance(orgId),
      ]);
    const stats = await getEstateStats(orgId, systems);
    return NextResponse.json({
      isDemo: user.org.seededDemo,
      systems,
      stats,
      alerts,
      incidents,
      audit,
      agents: { sessions, actions },
      validations,
      governance,
    });
  } catch (e) {
    return jsonError(e);
  }
}
