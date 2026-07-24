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
    const rules = await prisma.alertRule.findMany({
      where: { orgId: user.org.id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ rules });
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
    const category = String(body.category ?? "").trim();
    const metric = String(body.metric ?? "").trim();
    const op = String(body.op ?? "").trim();
    const severity = String(body.severity ?? "").trim();
    const threshold = Number(body.threshold);
    if (!category || !metric || !severity || (op !== "gt" && op !== "lt") || !Number.isFinite(threshold)) {
      return NextResponse.json(
        { error: "category, metric, op (gt|lt), threshold (number) and severity are required." },
        { status: 400 },
      );
    }
    const rule = await prisma.alertRule.create({
      data: {
        orgId: user.org.id,
        category,
        metric,
        op,
        threshold,
        severity,
        enabled: body.enabled === undefined ? true : !!body.enabled,
      },
    });
    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Created alert rule",
      object: `${metric} ${op} ${threshold}`,
      category: "Policy",
    });
    return NextResponse.json(rule, { status: 201 });
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
    if (!id) return NextResponse.json({ error: "Rule id is required." }, { status: 400 });
    const data: { enabled?: boolean; threshold?: number; severity?: string } = {};
    if (typeof body.enabled === "boolean") data.enabled = body.enabled;
    if (body.threshold !== undefined && Number.isFinite(Number(body.threshold))) {
      data.threshold = Number(body.threshold);
    }
    if (typeof body.severity === "string" && body.severity) data.severity = body.severity;

    await prisma.alertRule.updateMany({ where: { id, orgId: user.org.id }, data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    if (!user.org) {
      return NextResponse.json({ error: "Your account is not attached to an organization." }, { status: 400 });
    }
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Rule id is required." }, { status: 400 });
    await prisma.alertRule.deleteMany({ where: { id, orgId: user.org.id } });
    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Deleted alert rule",
      object: id,
      category: "Policy",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
