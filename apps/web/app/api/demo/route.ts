import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DemoRequestSchema } from "@assent/core";
import { db, schema } from "@/lib/db";
import { sendDemoNotification, demoNotifyRecipient, type DemoNotification } from "@/lib/mail";

export const runtime = "nodejs";

/**
 * Request-a-demo (PROMPT §11 M5): validate, persist to Postgres, notify.
 *
 * Persistence is the source of truth; the notification is best-effort. `notified_at`
 * is set only when a transport actually accepted the message, so an unsent lead is
 * always recoverable with:
 *   select * from demo_request where notified_at is null order by created_at desc;
 */
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
  const submittedAt = new Date();
  try {
    await db().insert(schema.demoRequest).values({ id, name, email, company, role, message, createdAt: submittedAt });
  } catch (err) {
    console.error("[demo] failed to persist:", err);
    return NextResponse.json({ error: "Could not record your request. Please email us." }, { status: 500 });
  }

  await notify({ id, name, email, company, role, message, submittedAt });

  return NextResponse.json({ ok: true });
}

/**
 * Deliver the notification and record whether it landed. Never throws: a mail
 * outage must not turn a captured lead into a 500.
 */
async function notify(payload: DemoNotification): Promise<void> {
  try {
    const result = await sendDemoNotification(payload);
    if (result.ok) {
      console.log(`[demo] notified ${demoNotifyRecipient()} via ${result.via} for ${payload.email} (${payload.id})`);
      await db()
        .update(schema.demoRequest)
        .set({ notifiedAt: new Date() })
        .where(eq(schema.demoRequest.id, payload.id));
      return;
    }
    warnUndelivered(payload, result.via, result.error ?? "unknown error");
  } catch (err) {
    warnUndelivered(payload, "none", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Loud enough to notice in any log drain, complete enough to answer the lead by
 * hand from this line alone. `notified_at` stays null so the row stays in the queue.
 */
function warnUndelivered(payload: DemoNotification, via: string, error: string): void {
  console.warn(
    [
      "",
      "!! [demo] LEAD NOT EMAILED — the request is saved but nobody was notified.",
      `   transport   ${via}`,
      `   reason      ${error}`,
      `   intended to ${demoNotifyRecipient()}`,
      `   request id  ${payload.id}`,
      `   submitted   ${payload.submittedAt.toISOString()}`,
      `   name        ${payload.name}`,
      `   email       ${payload.email}`,
      `   company     ${payload.company}`,
      `   role        ${payload.role || "—"}`,
      `   message     ${payload.message ? payload.message.replace(/\s+/g, " ") : "—"}`,
      "   recover     select * from demo_request where notified_at is null order by created_at desc;",
      "",
    ].join("\n"),
  );
}
