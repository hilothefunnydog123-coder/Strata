import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    if (!user.org) return NextResponse.json({ members: [] });
    const members = await prisma.user.findMany({
      where: { orgId: user.org.id },
      select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ members });
  } catch (e) {
    return jsonError(e);
  }
}
