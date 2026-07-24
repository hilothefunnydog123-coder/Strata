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
      currentStage?: string;
      steps?: string;
      blockingReason?: string;
    } = {};
    if (typeof body.status === "string" && body.status) data.status = body.status;
    if (typeof body.currentStage === "string" && body.currentStage) data.currentStage = body.currentStage;
    if (Array.isArray(body.steps)) data.steps = JSON.stringify(body.steps);
    if (typeof body.blockingReason === "string") data.blockingReason = body.blockingReason;

    const updated = await prisma.governanceItem.updateMany({
      where: { id: params.id, orgId: user.org.id },
      data,
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Governance item not found." }, { status: 404 });
    }

    const item = await prisma.governanceItem.findFirst({
      where: { id: params.id, orgId: user.org.id },
    });
    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: body.status ? "Recorded governance decision" : "Advanced governance workflow",
      object: item?.systemName ?? params.id,
      category: "Approval",
      systemId: item?.systemId,
    });
    return NextResponse.json(item);
  } catch (e) {
    return jsonError(e);
  }
}
