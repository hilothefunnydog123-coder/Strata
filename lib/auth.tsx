"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface Session {
  id: string;
  name: string;
  email: string;
  role: string;
  isOwner: boolean;
  initials: string;
  org: { id: string; name: string; slug: string; seededDemo: boolean } | null;
}

/** Display-only demo accounts surfaced on the sign-in screen. Real credentials
 *  live in the database (seeded); password is `strata`. */
export const DEMO_ACCOUNTS = [
  { name: "Dr. Elena Marsh", email: "elena.marsh@northstarhealth.org", role: "AI Governance Lead" },
  { name: "Dr. Alan Whitmore", email: "alan.whitmore@northstarhealth.org", role: "Executive" },
  { name: "James Okonkwo", email: "james.okonkwo@northstarhealth.org", role: "Compliance Officer" },
];

interface AuthContextValue {
  session: Session | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string; isOwner?: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      setSession(data.user ?? null);
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await refresh();
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error ?? "Sign in failed." };
        await refresh();
        return { ok: true, isOwner: data.isOwner };
      } catch {
        return { ok: false, error: "Network error. Please try again." };
      }
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, ready, login, logout, refresh }),
    [session, ready, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      session: null,
      ready: true,
      login: async () => ({ ok: false }),
      logout: async () => {},
      refresh: async () => {},
    };
  }
  return ctx;
}
