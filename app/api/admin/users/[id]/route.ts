import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { hashPassword, requireOwner } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const owner = await requireOwner();
    const body = await req.json().catch(() => ({}));
    const data: { active?: boolean; role?: string; passwordHash?: string; name?: string } = {};
    if (typeof body.active === "boolean") data.active = body.active;
    if (typeof body.role === "string") data.role = body.role;
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (typeof body.password === "string" && body.password) {
      if (body.password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
      }
      data.passwordHash = await hashPassword(body.password);
    }
    if (params.id === owner.id && data.active === false) {
      return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
    }
    const user = await prisma.user.update({ where: { id: params.id }, data });
    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const owner = await requireOwner();
    if (params.id === owner.id) {
      return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
    }
    await prisma.user.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
