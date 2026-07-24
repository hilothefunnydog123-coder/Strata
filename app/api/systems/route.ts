import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/api";
import type { CustomSystemInput } from "@/lib/systemInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    if (!user.org) {
      return NextResponse.json({ registered: [], isDemo: false });
    }
    const rows = await prisma.registeredSystem.findMany({
      where: { orgId: user.org.id },
      orderBy: { createdAt: "desc" },
    });
    const registered = rows
      .map((r) => {
        try {
          return JSON.parse(r.data) as CustomSystemInput;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return NextResponse.json({ registered, isDemo: user.org.seededDemo });
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
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "System name is required." }, { status: 400 });

    const slug =
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32) || "system";
    const id = `sys-${slug}-${Math.random().toString(36).slice(2, 8)}`;

    const input: CustomSystemInput = {
      id,
      name,
      description: String(body.description ?? ""),
      purpose: String(body.purpose ?? body.description ?? ""),
      category: body.category,
      modelClass: body.modelClass,
      owner: String(body.owner ?? ""),
      ownerContact: String(body.ownerContact ?? user.name),
      department: String(body.department ?? ""),
      vendor: String(body.vendor ?? "Internal"),
      isInternal: body.isInternal !== false,
      isAgent: !!body.isAgent,
      environment: body.environment ?? "Development",
      riskLevel: body.riskLevel ?? "High",
      regulatoryClass: body.regulatoryClass ?? "Clinical Decision Support (Non-Device)",
      dataClassification: body.dataClassification ?? "PHI",
      headlineLabel: String(body.headlineLabel ?? "Accuracy"),
      headlineValue: Number(body.headlineValue ?? 90),
      inputs: Array.isArray(body.inputs) ? body.inputs : [],
      outputs: Array.isArray(body.outputs) ? body.outputs : [],
      tags: Array.isArray(body.tags) ? body.tags : ["Newly registered"],
      registeredBy: user.name,
      createdAt: Date.now(),
    };

    await prisma.registeredSystem.create({
      data: { id, orgId: user.org.id, data: JSON.stringify(input) },
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
