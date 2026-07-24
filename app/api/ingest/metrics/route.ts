import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { jsonError } from "@/lib/server/api";
import { requireApiKey } from "@/lib/server/apikey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_POINTS = 5000;

export async function POST(req: Request) {
  try {
    const { orgId } = await requireApiKey(req);
    const body = await req.json().catch(() => null);

    // Accept a single point, { points: [...] }, or a bare array.
    let raw: any[];
    if (Array.isArray(body)) {
      raw = body;
    } else if (body && Array.isArray(body.points)) {
      raw = body.points;
    } else if (body && typeof body === "object") {
      raw = [body];
    } else {
      raw = [];
    }

    if (raw.length > MAX_POINTS) {
      return NextResponse.json(
        { error: `Too many points in one request (max ${MAX_POINTS}).` },
        { status: 400 }
      );
    }

    const now = new Date();
    const data: {
      orgId: string;
      systemId: string;
      metric: string;
      value: number;
      subgroup: string | null;
      ts: Date;
    }[] = [];

    for (const p of raw) {
      if (!p || typeof p !== "object") continue;
      const systemId = typeof p.systemId === "string" ? p.systemId.trim() : "";
      const metric = typeof p.metric === "string" ? p.metric.trim() : "";
      if (!systemId || !metric) continue;
      if (p.value === undefined || p.value === null || p.value === "") continue;
      const value = Number(p.value);
      if (Number.isNaN(value)) continue;

      let ts = now;
      if (p.ts !== undefined && p.ts !== null && p.ts !== "") {
        const d = new Date(p.ts);
        if (!Number.isNaN(d.getTime())) ts = d;
      }

      const subgroup =
        typeof p.subgroup === "string" && p.subgroup.trim() ? p.subgroup.trim() : null;

      data.push({ orgId, systemId, metric, value, subgroup, ts });
    }

    if (data.length === 0) {
      return NextResponse.json({ error: "No valid metric points." }, { status: 400 });
    }

    const result = await prisma.metricPoint.createMany({ data });
    return NextResponse.json({ ok: true, ingested: result.count });
  } catch (e) {
    return jsonError(e);
  }
}
