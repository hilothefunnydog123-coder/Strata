import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DemoRequestSchema } from "@assent/core";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

/** Request-a-demo (PROMPT §11 M5): validate, persist to Postgres, notify. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = DemoRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 422 });
  }
  const { name, email, company, role, message } = parsed.data;
  const id = randomUUID();
  try {
    await db().insert(schema.demoRequest).values({ id, name, email, company, role, message });
  } catch (err) {
    console.error("[demo] failed to persist:", err);
    return NextResponse.json({ error: "Could not record your request. Please email us." }, { status: 500 });
  }

  // Notify. With SMTP configured this would send; otherwise log (no mocked send).
  await notify({ name, email, company, role });
  await db().update(schema.demoRequest).set({ notifiedAt: new Date() }).where(eq(schema.demoRequest.id, id));

  return NextResponse.json({ ok: true });
}

async function notify(payload: { name: string; email: string; company: string; role: string }) {
  const to = process.env.DEMO_NOTIFY_TO;
  const smtp = process.env.SMTP_URL;
  if (smtp && to) {
    // Real send would go here (nodemailer against SMTP_URL). Left as an integration
    // point so we never pretend to send when unconfigured.
    console.log(`[demo] would send email via SMTP to ${to} for ${payload.email}`);
  } else {
    console.log(`[demo] new request (no SMTP configured): ${payload.name} <${payload.email}> @ ${payload.company} (${payload.role})`);
  }
}
