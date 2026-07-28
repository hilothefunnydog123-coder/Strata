"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const body = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      // Omitted entirely when blank, which is how an account that has not yet
      // enrolled an authenticator reaches /enroll.
      totp: String(form.get("totp") ?? "").replace(/\s+/g, "") || undefined,
    };
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      router.push(j.enroll ? "/enroll" : "/dashboard");
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Sign-in failed.");
      setBusy(false);
    }
  }

  const field = "w-full rounded border border-chrome-200 bg-white px-3 py-2 text-[14px] text-ink outline-none focus:border-citation a-focusable";
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <label className="grid gap-1 text-[12px] text-chrome-500">Work email
        <input name="email" type="email" required autoComplete="username" className={field} />
      </label>
      <label className="grid gap-1 text-[12px] text-chrome-500">Password
        <input name="password" type="password" required autoComplete="current-password" className={field} />
      </label>
      <label className="grid gap-1 text-[12px] text-chrome-500">
        Authenticator code
        <input name="totp" inputMode="numeric" pattern="[0-9 ]*" placeholder="123 456" autoComplete="one-time-code" className={`${field} a-mono tracking-widest`} />
        <span className="text-[11px] text-chrome-300">Leave blank if you have not set one up yet.</span>
      </label>
      {error && <div className="text-[13px] text-[color:var(--a-stance-not_covered)]">{error}</div>}
      <button type="submit" disabled={busy} className="mt-1 rounded bg-ink text-paper px-4 py-2 text-[14px] hover:bg-chrome-700 disabled:opacity-60 a-focusable">
        {busy ? "Verifying…" : "Sign in"}
      </button>
    </form>
  );
}
