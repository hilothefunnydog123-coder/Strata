import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireOwner } from "@/lib/server/auth";
import { jsonError, uniqueSlug } from "@/lib/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireOwner();
    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { users: true, systems: true } } },
    });
    return NextResponse.json({
      orgs: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        plan: o.plan,
        active: o.active,
        seededDemo: o.seededDemo,
        createdAt: o.createdAt,
        userCount: o._count.users,
        systemCount: o._count.systems,
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireOwner();
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const plan = String(body.plan ?? "Enterprise");
    if (!name) return NextResponse.json({ error: "Organization name is required." }, { status: 400 });
    const slug = await uniqueSlug(name);
    const org = await prisma.organization.create({
      data: { name, slug, plan, seededDemo: false },
    });
    return NextResponse.json({ org }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
