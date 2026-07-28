import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isStandalone } from "@/lib/standalone";

export const dynamic = "force-dynamic";

export default async function Device({ searchParams }: { searchParams: { ok?: string; e?: string } }) {
  // Device pairing issues a long-lived token, which needs somewhere durable to keep
  // it. Standalone says so plainly rather than showing a form that cannot work.
  const standalone = isStandalone();
  const pending = standalone
    ? []
    : await db().select().from(schema.deviceAuth)
        .where(and(eq(schema.deviceAuth.approved, false), gt(schema.deviceAuth.expiresAt, new Date())));

  if (standalone) {
    return (
      <div>
        <h1 className="font-serif text-[28px] text-ink">Device approvals</h1>
        <p className="text-[13px] text-chrome-500 mt-1 max-w-reading">
          Pairing a desktop app issues a long-lived token, which needs a database to store.
          The console is running without one, so this stays unavailable until you attach it.
        </p>
        <p className="text-[13px] text-chrome-500 mt-4 max-w-reading">
          You can still use the terminal in this browser — it needs no pairing.{" "}
          <a href="/terminal/?host=console" className="text-citation">Open it</a>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-serif text-[28px] text-ink">Device approvals</h1>
      <p className="text-[13px] text-chrome-500 mt-1 max-w-reading">
        When you sign in to {""}<span className="a-mono">Assent Desktop</span>, it shows a short code. Approve it here to
        pair the device. The app then receives a long-lived token — no password ever enters the app.
      </p>

      {searchParams.ok && <div className="mt-4 text-[13px]" style={{ color: "var(--a-stance-covered)" }}>Device approved. Return to the app.</div>}
      {searchParams.e && <div className="mt-4 text-[13px]" style={{ color: "var(--a-stance-not_covered)" }}>That code was not found or has expired.</div>}

      <form action="/api/device/approve" method="post" className="mt-6 flex items-end gap-2 max-w-md">
        <label className="grid gap-1 text-[12px] text-chrome-500 flex-1">Enter the code shown in the app
          <input name="user_code" placeholder="ABCD-2345" required
            className="w-full rounded border border-chrome-200 bg-white px-3 py-2 a-mono tracking-widest text-ink uppercase outline-none focus:border-citation a-focusable" />
        </label>
        <button className="rounded bg-ink text-paper px-4 py-2 text-[14px] hover:bg-chrome-700 a-focusable">Approve</button>
      </form>

      <h2 className="font-serif text-[18px] text-ink mt-10">Pending requests</h2>
      {pending.length === 0 ? (
        <p className="text-[13px] text-chrome-500 mt-2">No pending device requests.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2 max-w-md">
          {pending.map((p) => (
            <li key={p.id} className="flex items-center justify-between border border-chrome-200 rounded px-4 py-2.5">
              <span className="a-mono text-[15px] tracking-widest text-ink">{p.userCode}</span>
              <form action="/api/device/approve" method="post">
                <input type="hidden" name="user_code" value={p.userCode} />
                <button className="rounded border border-chrome-200 px-3 py-1.5 text-[13px] hover:bg-chrome-50 a-focusable">Approve</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
