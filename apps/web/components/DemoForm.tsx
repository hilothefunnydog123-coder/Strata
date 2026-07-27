"use client";
import { useId, useState } from "react";

const FIELD =
  "a-focusable w-full rounded border border-chrome-200 bg-white px-3 py-2 text-[14px] text-ink outline-none placeholder:text-chrome-300 focus:border-citation";
const LABEL = "a-mono text-[10px] uppercase tracking-[0.1em] text-chrome-500";

export function DemoForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const noteId = useId();

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
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-chrome-200 bg-white p-6 sm:p-7"
      >
        <div className="a-eyebrow">Received</div>
        <p className="mt-3 max-w-reading font-serif text-[17px] leading-[1.55] text-ink">
          Thanks — we have your request. We will be in touch to schedule a walkthrough of your
          indication and codes.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-chrome-500">
          Replies come from a person, usually within one business day.
        </p>
      </div>
    );
  }

  const busy = state === "sending";
  return (
    <form
      onSubmit={onSubmit}
      noValidate={false}
      className="rounded-lg border border-chrome-200 bg-white p-5 sm:p-6"
    >
      <fieldset disabled={busy} className="m-0 grid gap-4 border-0 p-0">
        <legend className="sr-only">Request a demo</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className={LABEL}>Name</span>
            <input name="name" required autoComplete="name" className={FIELD} />
          </label>
          <label className="grid gap-1.5">
            <span className={LABEL}>Work email</span>
            <input name="email" type="email" required autoComplete="email" className={FIELD} />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className={LABEL}>Company</span>
            <input name="company" required autoComplete="organization" className={FIELD} />
          </label>
          <label className="grid gap-1.5">
            <span className={LABEL}>
              Role <span className="normal-case tracking-normal text-chrome-300">optional</span>
            </span>
            <input
              name="role"
              autoComplete="organization-title"
              placeholder="VP Market Access"
              className={FIELD}
            />
          </label>
        </div>

        <label className="grid gap-1.5">
          <span className={LABEL}>What are you trying to get covered?</span>
          <textarea
            name="message"
            rows={4}
            placeholder="Indication, codes, and the trial decision in front of you."
            className={`${FIELD} resize-y`}
          />
        </label>

        {state === "error" && (
          <p
            role="alert"
            className="border-l-2 border-ink pl-3 text-[13px] leading-relaxed text-ink"
          >
            <span className="a-mono mr-2 text-[10px] uppercase tracking-[0.1em] text-chrome-500">
              Not sent
            </span>
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-chrome-200 pt-4">
          <button
            type="submit"
            aria-describedby={noteId}
            className="a-focusable rounded bg-ink px-5 py-2.5 text-[14px] text-paper hover:bg-chrome-700 disabled:opacity-60"
          >
            {busy ? "Sending…" : "Request a demo"}
          </button>
          <span id={noteId} className="text-[12px] leading-snug text-chrome-500">
            No self-signup. We provision accounts after a contract.
          </span>
        </div>
      </fieldset>
    </form>
  );
}
