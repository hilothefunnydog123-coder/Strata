import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { jsonError } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { generateApiKey } from "@/lib/server/apikey";
import { writeAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    if (!user.org) {
      return NextResponse.json(
        { error: "Your account is not attached to an organization." },
        { status: 400 }
      );
    }
    const keys = await prisma.apiKey.findMany({
      where: { orgId: user.org.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        createdBy: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ keys });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.org) {
      return NextResponse.json(
        { error: "Your account is not attached to an organization." },
        { status: 400 }
      );
    }
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim() || "Ingestion key";

    const { plaintext, prefix, hash } = generateApiKey();
    const key = await prisma.apiKey.create({
      data: {
        orgId: user.org.id,
        name,
        prefix,
        hash,
        createdBy: user.name,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        createdBy: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Created API key",
      object: name,
      category: "Access",
    });

    return NextResponse.json({ key, plaintext }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    if (!user.org) {
      return NextResponse.json(
        { error: "Your account is not attached to an organization." },
        { status: 400 }
      );
    }
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Key id is required." }, { status: 400 });
    }

    const result = await prisma.apiKey.updateMany({
      where: { id, orgId: user.org.id },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "API key not found." }, { status: 404 });
    }

    await writeAudit({
      orgId: user.org.id,
      actor: user.name,
      actorRole: user.role,
      action: "Revoked API key",
      object: id,
      category: "Access",
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
