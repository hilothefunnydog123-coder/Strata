import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    if (!user.org) {
      return NextResponse.json({ error: "Your account is not attached to an organization." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const data: {
      status?: string;
      owner?: string;
      rootCause?: string;
      resolution?: string;
      resolvedAt?: Date;
    } = {};
    if (typeof body.status === "string" && body.status) data.status = body.status;
    if (typeof body.owner === "string" && body.owner) data.owner = body.owner;
    if (typeof body.rootCause === "string") data.rootCause = body.rootCause;
    if (typeof body.resolution === "string") data.resolution = body.resolution;
    if (data.status === "Resolved" || data.status === "Closed") data.resolvedAt = new Date();

    const updated = await prisma.incident.updateMany({
      where: { id: params.id, orgId: user.org.id },
      data,
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }

    if (body.comment) {
      await prisma.incidentEvent.create({
        data: {
          incidentId: params.id,
          actor: user.name,
          kind: typeof body.kind === "string" && body.kind ? body.kind : "comment",
          text: String(body.comment),
        },
      });
    }
    if (data.status) {
      await prisma.incidentEvent.create({
        data: {
          incidentId: params.id,
          actor: user.name,
          kind: "status",
          text: `Status → ${data.status}`,
        },
      });
    }

    const incident = await prisma.incident.findFirst({
      where: { id: params.id, orgId: user.org.id },
      include: { events: { orderBy: { at: "asc" } } },
    });
    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Updated incident",
      object: incident?.title ?? params.id,
      category: "Incident",
      systemId: incident?.systemId,
    });
    return NextResponse.json(incident);
  } catch (e) {
    return jsonError(e);
  }
}
