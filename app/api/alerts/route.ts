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
    const alerts = await prisma.alert.findMany({
      where: { orgId: user.org.id },
      orderBy: { at: "desc" },
    });
    return NextResponse.json({ alerts });
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
    const category = String(body.category ?? "").trim();
    const severity = String(body.severity ?? "").trim();
    const title = String(body.title ?? "").trim();
    if (!systemName || !category || !severity || !title) {
      return NextResponse.json(
        { error: "systemName, category, severity and title are required." },
        { status: 400 },
      );
    }
    const alert = await prisma.alert.create({
      data: {
        orgId: user.org.id,
        systemId: body.systemId ? String(body.systemId) : null,
        systemName,
        category,
        severity,
        title,
        detail: body.detail ? String(body.detail) : null,
        recommendedAction: body.recommendedAction ? String(body.recommendedAction) : null,
        changeSummary: body.changeSummary ? String(body.changeSummary) : null,
        ruleId: body.ruleId ? String(body.ruleId) : null,
        linkTab: body.linkTab ? String(body.linkTab) : null,
        status: "Active",
      },
    });
    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Raised alert",
      object: title,
      category: "Configuration",
      systemId: alert.systemId,
    });
    return NextResponse.json(alert, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    if (!user.org) {
      return NextResponse.json({ error: "Your account is not attached to an organization." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "Alert id is required." }, { status: 400 });
    const data: { status?: string; owner?: string } = {};
    if (typeof body.status === "string" && body.status) data.status = body.status;
    if (typeof body.owner === "string") data.owner = body.owner;

    const updated = await prisma.alert.updateMany({
      where: { id, orgId: user.org.id },
      data,
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Alert not found." }, { status: 404 });
    }
    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Updated alert",
      object: id,
      category: "Configuration",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
