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
    const records = await prisma.roiRecord.findMany({
      where: { orgId: user.org.id },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ records });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    if (!user.org) {
      return NextResponse.json({ error: "Your account is not attached to an organization." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const systemId = String(body.systemId ?? "").trim();
    if (!systemId) return NextResponse.json({ error: "systemId is required." }, { status: 400 });

    const annualImpact = Number(body.annualImpact) || 0;
    const implementationCost = Number(body.implementationCost) || 0;
    const operatingCost = Number(body.operatingCost) || 0;
    const headlineLabel = body.headlineLabel != null ? String(body.headlineLabel) : null;
    const headlineValue = body.headlineValue != null ? String(body.headlineValue) : null;
    const breakdown = JSON.stringify(body.breakdown ?? []);

    const record = await prisma.roiRecord.upsert({
      where: { orgId_systemId: { orgId: user.org.id, systemId } },
      create: {
        orgId: user.org.id,
        systemId,
        annualImpact,
        implementationCost,
        operatingCost,
        headlineLabel,
        headlineValue,
        breakdown,
        updatedBy: user.name,
      },
      update: {
        annualImpact,
        implementationCost,
        operatingCost,
        headlineLabel,
        headlineValue,
        breakdown,
        updatedBy: user.name,
      },
    });
    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Updated ROI inputs",
      object: systemId,
      category: "Configuration",
      systemId,
    });
    return NextResponse.json(record);
  } catch (e) {
    return jsonError(e);
  }
}
