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
    const runs = await prisma.validationRun.findMany({
      where: { orgId: user.org.id },
      orderBy: { startedAt: "desc" },
    });
    return NextResponse.json({ runs });
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
    const systemId = String(body.systemId ?? "").trim();
    const systemName = String(body.systemName ?? "").trim();
    const version = String(body.version ?? "").trim();
    if (!systemId || !systemName || !version) {
      return NextResponse.json(
        { error: "systemId, systemName and version are required." },
        { status: 400 },
      );
    }
    const status = body.status ? String(body.status) : "Passed";
    const result = body.result ? String(body.result) : status;
    const completed = status !== "Queued" && status !== "Running";
    const run = await prisma.validationRun.create({
      data: {
        orgId: user.org.id,
        systemId,
        systemName,
        version,
        dataset: String(body.dataset ?? ""),
        datasetSize: Number(body.datasetSize) || 0,
        requestedBy: user.name,
        status,
        result,
        tests: JSON.stringify(body.tests ?? []),
        metrics: JSON.stringify(body.metrics ?? []),
        subgroups: JSON.stringify(body.subgroups ?? []),
        completedAt: completed ? new Date() : null,
      },
    });
    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Started validation run",
      object: systemName,
      category: "Validation",
      systemId,
    });
    return NextResponse.json(run, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
