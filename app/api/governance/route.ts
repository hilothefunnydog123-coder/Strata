import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    if (!user.org) {
      return NextResponse.json({ error: "Your account is not attached to an organization." }, { status: 400 });
    }
    const items = await prisma.governanceItem.findMany({
      where: { orgId: user.org.id },
      orderBy: { submittedAt: "desc" },
    });
    return NextResponse.json({ items });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.org) {
      return NextResponse.json({ error: "Your account is not attached to an organization." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const systemName = String(body.systemName ?? "").trim();
    if (!systemName) {
      return NextResponse.json({ error: "systemName is required." }, { status: 400 });
    }
    const item = await prisma.governanceItem.create({
      data: {
        orgId: user.org.id,
        systemId: body.systemId ? String(body.systemId) : null,
        systemName,
        category: String(body.category ?? "General"),
        vendor: body.vendor ? String(body.vendor) : "Internal",
        riskLevel: body.riskLevel ? String(body.riskLevel) : "High",
        submittedBy: user.name,
        currentStage: body.currentStage ? String(body.currentStage) : "Intake & Triage",
        status: "In review",
        steps: JSON.stringify(body.steps ?? []),
      },
    });
    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Submitted for governance review",
      object: systemName,
      category: "Approval",
      systemId: item.systemId,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
