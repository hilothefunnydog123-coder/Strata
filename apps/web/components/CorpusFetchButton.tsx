"use client";
import { useState } from "react";

/**
 * Triggers a live corpus fetch and reports back in place.
 *
 * Exists because the alternative is a redeploy per attempt while chasing an
 * endpoint, and the person doing it is on a phone.
 */
export function CorpusFetchButton() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function run() {
    setState("running");
    setMessage("");
    try {
      const res = await fetch("/api/corpus/fetch", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setState("done");
        setMessage(j.note ?? "Started.");
      } else {
        setState("error");
        setMessage([j.error, j.remedy].filter(Boolean).join(" "));
      }
    } catch {
      setState("error");
      setMessage("Could not reach the server.");
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={run}
        disabled={state === "running"}
        className="rounded bg-ink text-paper px-3 py-1.5 text-[13px] hover:bg-chrome-700 disabled:opacity-60 a-focusable"
      >
        {state === "running" ? "Fetching…" : "Fetch the real corpus now"}
      </button>
      {message && (
        <p className="mt-2 text-[12px] text-chrome-700 max-w-reading">
          {message}{" "}
          {state === "done" && (
            <a href="/api/diagnostics" className="text-citation">
              check the result
            </a>
          )}
        </p>
      )}
    </div>
  );
}
