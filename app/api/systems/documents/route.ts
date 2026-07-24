import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import type { SystemDoc } from "@/lib/systemInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!user.org) return NextResponse.json({ docs: [] });
    const systemId = new URL(req.url).searchParams.get("systemId");
    const rows = await prisma.systemDocument.findMany({
      where: { orgId: user.org.id, ...(systemId ? { systemId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    const docs: SystemDoc[] = rows.map((d) => ({
      id: d.id,
      systemId: d.systemId,
      name: d.name,
      type: d.type as SystemDoc["type"],
      status: d.status as SystemDoc["status"],
      addedBy: d.addedBy,
      addedAt: d.createdAt.getTime(),
      note: d.note ?? undefined,
    }));
    return NextResponse.json({ docs });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.org) return NextResponse.json({ error: "No organization." }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const systemId = String(body.systemId ?? "").trim();
    const name = String(body.name ?? "").trim();
    if (!systemId || !name) {
      return NextResponse.json({ error: "System and document name are required." }, { status: 400 });
    }
    const doc = await prisma.systemDocument.create({
      data: {
        orgId: user.org.id,
        systemId,
        name,
        type: String(body.type ?? "Other"),
        status: "Draft",
        addedBy: user.name,
        note: body.note ? String(body.note) : null,
      },
    });
    return NextResponse.json({
      doc: {
        id: doc.id,
        systemId: doc.systemId,
        name: doc.name,
        type: doc.type,
        status: doc.status,
        addedBy: doc.addedBy,
        addedAt: doc.createdAt.getTime(),
        note: doc.note ?? undefined,
      },
    }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    if (!user.org) return NextResponse.json({ error: "No organization." }, { status: 400 });
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Document id required." }, { status: 400 });
    await prisma.systemDocument.deleteMany({ where: { id, orgId: user.org.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
