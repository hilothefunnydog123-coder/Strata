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
    const data: { status?: string; result?: string; decision?: string } = {};
    if (typeof body.status === "string" && body.status) data.status = body.status;
    if (typeof body.result === "string" && body.result) data.result = body.result;
    if (body.decision && typeof body.decision === "object") {
      data.decision = JSON.stringify({
        by: user.name,
        at: new Date().toISOString(),
        decision: body.decision.decision,
        comment: body.decision.comment,
      });
    }

    const updated = await prisma.validationRun.updateMany({
      where: { id: params.id, orgId: user.org.id },
      data,
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Validation run not found." }, { status: 404 });
    }

    const run = await prisma.validationRun.findFirst({
      where: { id: params.id, orgId: user.org.id },
    });
    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Recorded validation decision",
      object: run?.systemName ?? params.id,
      category: "Validation",
      systemId: run?.systemId,
    });
    return NextResponse.json(run);
  } catch (e) {
    return jsonError(e);
  }
}
