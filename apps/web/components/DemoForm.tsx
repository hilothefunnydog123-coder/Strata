"use client";
import { useState } from "react";

export function DemoForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError("");
    const form = new FormData(e.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Something went wrong.");
      }
      setState("done");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-lg border border-chrome-200 bg-white p-6">
        <div className="a-mono text-[11px] uppercase tracking-wide text-[color:var(--a-stance-covered)]">Received</div>
        <p className="mt-2 text-ink">Thanks — we have your request and will be in touch to schedule a walkthrough of your indication and codes.</p>
      </div>
    );
  }

  const field = "w-full rounded border border-chrome-200 bg-white px-3 py-2 text-[14px] text-ink a-focusable outline-none focus:border-citation";
  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-chrome-200 bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-[12px] text-chrome-500">Name<input name="name" required className={field} /></label>
        <label className="grid gap-1 text-[12px] text-chrome-500">Work email<input name="email" type="email" required className={field} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-[12px] text-chrome-500">Company<input name="company" required className={field} /></label>
        <label className="grid gap-1 text-[12px] text-chrome-500">Role<input name="role" placeholder="VP Market Access" className={field} /></label>
      </div>
      <label className="grid gap-1 text-[12px] text-chrome-500">
        What are you trying to get covered?
        <textarea name="message" rows={3} placeholder="Indication, codes, and the trial decision in front of you." className={field} />
      </label>
      {state === "error" && <div className="text-[13px] text-[color:var(--a-stance-not_covered)]">{error}</div>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "sending"} className="rounded bg-ink text-paper px-4 py-2 text-[14px] hover:bg-chrome-700 disabled:opacity-60 a-focusable">
          {state === "sending" ? "Sending…" : "Request a demo"}
        </button>
        <span className="text-[12px] text-chrome-500">No self-signup. We provision accounts after a contract.</span>
      </div>
    </form>
  );
}
