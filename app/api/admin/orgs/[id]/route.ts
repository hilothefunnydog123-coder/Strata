import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireOwner } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireOwner();
    const body = await req.json().catch(() => ({}));
    const data: { active?: boolean; name?: string; plan?: string } = {};
    if (typeof body.active === "boolean") data.active = body.active;
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (typeof body.plan === "string") data.plan = body.plan;
    const org = await prisma.organization.update({ where: { id: params.id }, data });
    return NextResponse.json({ org });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireOwner();
    const org = await prisma.organization.findUnique({ where: { id: params.id } });
    if (org?.seededDemo) {
      return NextResponse.json({ error: "The demo organization cannot be deleted." }, { status: 400 });
    }
    await prisma.organization.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
