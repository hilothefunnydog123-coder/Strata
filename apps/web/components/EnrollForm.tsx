"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Setup {
  secret: string;
  uri: string;
  qr: string | null;
  email: string;
  issuer: string;
}

/** Base32 in groups of four — the form authenticator apps ask you to type. */
function grouped(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(" ");
}

export function EnrollForm() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/enroll")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error))))
      .then((j: Setup) => live && setSetup(j))
      .catch((e: Error) => live && setLoadError(e.message || "Could not start enrollment."));
    return () => {
      live = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const totp = String(new FormData(e.currentTarget).get("totp") ?? "").replace(/\s+/g, "");
    const res = await fetch("/api/auth/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ totp }),
    });
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Enrollment failed.");
      setBusy(false);
    }
  }

  if (loadError) return <p className="text-[13px] text-[color:var(--a-stance-not_covered)]">{loadError}</p>;
  if (!setup) return <p className="text-[13px] text-chrome-500">Preparing your authenticator key…</p>;

  const field =
    "w-full rounded border border-chrome-200 bg-white px-3 py-2 text-[14px] text-ink outline-none focus:border-citation a-focusable";

  return (
    <div className="grid gap-5">
      <div className="flex flex-col items-center gap-3">
        {setup.qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- inline data URI, no loader needed
          <img
            src={setup.qr}
            alt={`QR code enrolling ${setup.email} in ${setup.issuer}`}
            width={220}
            height={220}
            className="rounded border border-chrome-200 bg-white p-2"
          />
        ) : null}
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          className="text-[12px] text-citation underline a-focusable"
        >
          {showKey ? "Hide the key" : "Can't scan it? Enter the key by hand"}
        </button>
        {showKey && (
          <code className="a-mono text-[13px] tracking-wider text-ink bg-chrome-50 border border-chrome-200 rounded px-3 py-2 select-all break-all text-center">
            {grouped(setup.secret)}
          </code>
        )}
      </div>

      <form onSubmit={onSubmit} className="grid gap-3">
        <label className="grid gap-1 text-[12px] text-chrome-500">
          Enter the 6-digit code your app is showing now
          <input
            name="totp"
            inputMode="numeric"
            pattern="[0-9 ]*"
            placeholder="123 456"
            required
            autoFocus
            autoComplete="one-time-code"
            className={`${field} a-mono tracking-widest`}
          />
        </label>
        {error && <div className="text-[13px] text-[color:var(--a-stance-not_covered)]">{error}</div>}
        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded bg-ink text-paper px-4 py-2 text-[14px] hover:bg-chrome-700 disabled:opacity-60 a-focusable"
        >
          {busy ? "Verifying…" : "Confirm and finish"}
        </button>
      </form>
    </div>
  );
}
