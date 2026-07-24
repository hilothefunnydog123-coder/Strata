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
    const events = await prisma.auditEvent.findMany({
      where: { orgId: user.org.id },
      orderBy: { at: "desc" },
      take: 200,
    });
    return NextResponse.json({ events });
  } catch (e) {
    return jsonError(e);
  }
}
