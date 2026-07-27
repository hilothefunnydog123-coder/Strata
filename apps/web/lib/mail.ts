import "server-only";

/**
 * Outbound mail for the request-a-demo form.
 *
 * Two real transports, tried in order, whichever is configured:
 *   1. Resend  — plain HTTPS POST, no SDK, works on their shared domain with zero DNS setup.
 *   2. SMTP    — nodemailer against SMTP_URL (e.g. a Gmail app password).
 *
 * If neither is configured we do NOT pretend to have sent: the caller is told
 * `{ ok: false, via: "none" }` so it can leave `notified_at` null and log the lead
 * for recovery from Postgres. A lead is never lost to a mail outage.
 */

/** Where demo notifications go when DEMO_NOTIFY_TO is unset. Deliberately a real inbox. */
const DEFAULT_NOTIFY_TO = "hilothefunnydog123@gmail.com";

/** Resend's shared sending domain — delivers without owning/verifying a domain first. */
const DEFAULT_MAIL_FROM = "Assent <onboarding@resend.dev>";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 15_000;

export interface DemoNotification {
  /** demo_request.id — the row to look up if delivery failed. */
  id: string;
  name: string;
  email: string;
  company: string;
  role: string;
  message: string;
  submittedAt: Date;
}

export type MailTransport = "resend" | "smtp" | "none";

export interface MailResult {
  ok: boolean;
  via: MailTransport;
  error?: string;
}

/** The rendered message, transport-agnostic. */
interface Envelope {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
}

export function demoNotifyRecipient(): string {
  return env("DEMO_NOTIFY_TO") ?? DEFAULT_NOTIFY_TO;
}

/**
 * Send the "someone asked for a demo" notification. Never throws — every failure
 * mode is reported through the returned result.
 */
export async function sendDemoNotification(payload: DemoNotification): Promise<MailResult> {
  const envelope = renderDemoEmail(payload);
  const resendKey = env("RESEND_API_KEY");
  const smtpUrl = env("SMTP_URL");
  let lastError = "";

  if (resendKey) {
    try {
      await sendViaResend(resendKey, envelope);
      return { ok: true, via: "resend" };
    } catch (err) {
      lastError = describe(err);
      console.error(`[mail] Resend delivery failed: ${lastError}`);
      if (!smtpUrl) return { ok: false, via: "resend", error: lastError };
    }
  }

  if (smtpUrl) {
    try {
      await sendViaSmtp(smtpUrl, envelope);
      return { ok: true, via: "smtp" };
    } catch (err) {
      lastError = describe(err);
      console.error(`[mail] SMTP delivery failed: ${lastError}`);
      return { ok: false, via: "smtp", error: lastError };
    }
  }

  return {
    ok: false,
    via: "none",
    error:
      "No mail transport configured. Set RESEND_API_KEY (fastest) or SMTP_URL in the environment; " +
      `notifications are addressed to ${envelope.to}.`,
  };
}

// ─── Transports ──────────────────────────────────────────────────────────────

async function sendViaResend(apiKey: string, e: Envelope): Promise<void> {
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: e.from,
      to: [e.to],
      reply_to: e.replyTo,
      subject: e.subject,
      html: e.html,
      text: e.text,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend responded ${res.status} ${res.statusText}${detail ? ` — ${clip(detail, 400)}` : ""}`);
  }
}

async function sendViaSmtp(url: string, e: Envelope): Promise<void> {
  // Imported lazily so an unconfigured deployment never loads the SMTP stack.
  const { createTransport } = await import("nodemailer");
  const transport = createTransport(url, { connectionTimeout: SEND_TIMEOUT_MS, greetingTimeout: SEND_TIMEOUT_MS });
  try {
    await transport.sendMail({
      from: e.from,
      to: e.to,
      replyTo: e.replyTo,
      subject: e.subject,
      text: e.text,
      html: e.html,
    });
  } finally {
    transport.close();
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderDemoEmail(p: DemoNotification): Envelope {
  const company = p.company.trim() || "unknown company";
  const role = p.role.trim();
  const message = p.message.trim();
  const stamp = timestamp(p.submittedAt);

  const fields: Array<[string, string]> = [
    ["Name", p.name],
    ["Work email", p.email],
    ["Company", company],
    ["Role", role || "—"],
  ];

  const text = [
    `New Assent demo request`,
    ``,
    ...fields.map(([k, v]) => `${k.padEnd(12)} ${v}`),
    ``,
    `What they are trying to get covered`,
    message ? indent(message) : `  (no message provided)`,
    ``,
    `Submitted   ${stamp}`,
    `Request id  ${p.id}`,
    ``,
    `Reply to this email to answer ${firstName(p.name)} directly.`,
  ].join("\n");

  const html = `
<div style="margin:0;padding:24px 12px;background:#F1F1EE;">
  <div style="max-width:600px;margin:0 auto;background:#FBFAF7;border:1px solid #D9DBDE;border-radius:6px;">
    <div style="padding:16px 24px;border-bottom:1px solid #D9DBDE;">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:600;color:#1A1A17;letter-spacing:-0.01em;">Assent</span>
      <span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#5B626E;padding-left:10px;">Demo request</span>
    </div>

    <div style="padding:24px;">
      <p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.35;color:#1A1A17;">
        ${esc(p.name)} at ${esc(company)} asked for a walkthrough.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
        ${fields
          .map(
            ([k, v], i) => `<tr>
          <td style="${i === 0 ? "" : "border-top:1px solid #E9E9E5;"}padding:8px 12px 8px 0;width:110px;vertical-align:top;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#5B626E;">${esc(k)}</td>
          <td style="${i === 0 ? "" : "border-top:1px solid #E9E9E5;"}padding:8px 0;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#1A1A17;">${
            k === "Work email"
              ? `<a href="mailto:${esc(v)}" style="color:#1A1A17;">${esc(v)}</a>`
              : esc(v)
          }</td>
        </tr>`,
          )
          .join("")}
      </table>

      <div style="margin-top:22px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#5B626E;">
        What they are trying to get covered
      </div>
      <div style="margin-top:8px;padding:12px 16px;border-left:2px solid #D9DBDE;background:#FFFFFF;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.6;color:#1A1A17;white-space:pre-wrap;">${
        message ? esc(message) : `<span style="color:#5B626E;font-style:italic;">No message provided.</span>`
      }</div>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:22px;border-top:1px solid #E9E9E5;">
        <tr>
          <td style="padding-top:12px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#5B626E;">Submitted&nbsp;&nbsp;${esc(stamp)}</td>
        </tr>
        <tr>
          <td style="padding-top:4px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#5B626E;">Request&nbsp;id&nbsp;&nbsp;${esc(p.id)}</td>
        </tr>
      </table>
    </div>

    <div style="padding:14px 24px;border-top:1px solid #D9DBDE;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#5B626E;">
      Reply to this email and it goes straight to ${esc(firstName(p.name))} at
      <a href="mailto:${esc(p.email)}" style="color:#2A2E35;">${esc(p.email)}</a>.
    </div>
  </div>
</div>`.trim();

  return {
    to: demoNotifyRecipient(),
    from: env("MAIL_FROM") ?? DEFAULT_MAIL_FROM,
    replyTo: p.email,
    subject: `New Assent demo request — ${company}`,
    text,
    html,
  };
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function env(name: string): string | undefined {
  const raw = process.env[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length > 0 ? value : undefined;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** ISO-8601 UTC — dates are monospace everywhere in this product, and sortable. */
function timestamp(at: Date): string {
  const d = Number.isNaN(at.getTime()) ? new Date() : at;
  return `${d.toISOString().replace(/\.\d{3}Z$/, "Z")} (UTC)`;
}

function firstName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "them";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function indent(block: string): string {
  return block
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}
