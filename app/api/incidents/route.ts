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
    const incidents = await prisma.incident.findMany({
      where: { orgId: user.org.id },
      include: { events: { orderBy: { at: "asc" } } },
      orderBy: { openedAt: "desc" },
    });
    return NextResponse.json({ incidents });
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
    const title = String(body.title ?? "").trim();
    const severity = String(body.severity ?? "").trim();
    const description = String(body.description ?? "").trim();
    if (!systemName || !title || !severity || !description) {
      return NextResponse.json(
        { error: "systemName, title, severity and description are required." },
        { status: 400 },
      );
    }
    const incident = await prisma.incident.create({
      data: {
        orgId: user.org.id,
        systemId: body.systemId ? String(body.systemId) : null,
        systemName,
        title,
        severity,
        status: "Investigating",
        detectedBy: body.detectedBy ? String(body.detectedBy) : user.name,
        owner: body.owner ? String(body.owner) : user.name,
        description,
        impact: body.impact ? String(body.impact) : null,
        suspectedCause: body.suspectedCause ? String(body.suspectedCause) : null,
        affectedPeriod: body.affectedPeriod ? String(body.affectedPeriod) : null,
        affectedPopulation: body.affectedPopulation ? String(body.affectedPopulation) : null,
        events: {
          create: [{ actor: user.name, kind: "detect", text: `Incident opened: ${title}` }],
        },
      },
      include: { events: { orderBy: { at: "asc" } } },
    });
    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Opened incident",
      object: title,
      category: "Incident",
      systemId: incident.systemId,
    });
    return NextResponse.json(incident, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
