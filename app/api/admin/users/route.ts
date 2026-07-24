import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { hashPassword, requireOwner } from "@/lib/server/auth";
import { isValidEmail, jsonError } from "@/lib/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function shape(u: {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  isOwner: boolean;
  orgId: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    isOwner: u.isOwner,
    orgId: u.orgId,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export async function GET(req: Request) {
  try {
    await requireOwner();
    const orgId = new URL(req.url).searchParams.get("orgId");
    const users = await prisma.user.findMany({
      where: orgId ? { orgId } : {},
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ users: users.map(shape) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireOwner();
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const role = String(body.role ?? "Administrator");
    const orgId = body.orgId ? String(body.orgId) : null;

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email, and password are required." }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });
    }
    if (orgId) {
      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      if (!org) return NextResponse.json({ error: "Organization not found." }, { status: 404 });
    }

    const user = await prisma.user.create({
      data: { name, email, role, orgId, passwordHash: await hashPassword(password), isOwner: false },
    });
    return NextResponse.json({ user: shape(user) }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
