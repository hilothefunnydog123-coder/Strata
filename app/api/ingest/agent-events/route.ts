import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { jsonError } from "@/lib/server/api";
import { requireApiKey } from "@/lib/server/apikey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { orgId } = await requireApiKey(req);
    const body = await req.json().catch(() => ({}));

    const rawEvents: any[] = Array.isArray(body.events) ? body.events : [];

    // Append to an existing session for this org when a known sessionId is given;
    // otherwise start a new session.
    let session =
      typeof body.sessionId === "string" && body.sessionId
        ? await prisma.agentSession.findFirst({ where: { id: body.sessionId, orgId } })
        : null;

    if (!session) {
      const systemId = typeof body.systemId === "string" ? body.systemId.trim() : "";
      const label = typeof body.label === "string" ? body.label.trim() : "";
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      if (!systemId || !label || !subject) {
        return NextResponse.json(
          { error: "systemId, label, and subject are required to start a session." },
          { status: 400 }
        );
      }
      const riskFlags = Array.isArray(body.riskFlags)
        ? body.riskFlags.filter((f: unknown) => typeof f === "string")
        : [];
      const anomalyScore = Number(body.anomalyScore);
      session = await prisma.agentSession.create({
        data: {
          orgId,
          systemId,
          label,
          subject,
          status:
            typeof body.status === "string" && body.status.trim()
              ? body.status.trim()
              : "In progress",
          outcome:
            typeof body.outcome === "string" && body.outcome.trim() ? body.outcome.trim() : null,
          riskFlags: JSON.stringify(riskFlags),
          anomalyScore: Number.isNaN(anomalyScore) ? 0 : anomalyScore,
        },
      });
    }

    const sess = session;
    let inserted = 0;
    if (rawEvents.length > 0) {
      const data = rawEvents
        .filter((e) => e && typeof e === "object")
        .map((e, i) => ({
          sessionId: sess.id,
          step: Number.isFinite(Number(e.step)) ? Math.trunc(Number(e.step)) : i + 1,
          kind: String(e.kind ?? ""),
          summary: String(e.summary ?? ""),
          detail: typeof e.detail === "string" ? e.detail : null,
          tool: typeof e.tool === "string" ? e.tool : null,
          dataSource: typeof e.dataSource === "string" ? e.dataSource : null,
          status: typeof e.status === "string" && e.status.trim() ? e.status.trim() : "normal",
          durationMs: Number.isFinite(Number(e.durationMs))
            ? Math.trunc(Number(e.durationMs))
            : null,
          riskNote: typeof e.riskNote === "string" ? e.riskNote : null,
        }));
      if (data.length > 0) {
        const result = await prisma.agentEvent.createMany({ data });
        inserted = result.count;
      }
    }

    return NextResponse.json({ ok: true, sessionId: sess.id, events: inserted });
  } catch (e) {
    return jsonError(e);
  }
}
