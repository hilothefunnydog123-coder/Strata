"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { UserRole } from "./types";

export interface Account {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  org: string;
  initials: string;
}

export interface Session {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  org: string;
  initials: string;
}

/** Demo hospital accounts. In production these authenticate against the
 *  enterprise identity provider (Okta / Entra) via SSO + SCIM. */
export const ACCOUNTS: Account[] = [
  {
    id: "acc-marsh",
    name: "Dr. Elena Marsh",
    email: "elena.marsh@northstarhealth.org",
    password: "strata",
    role: "AI Governance Lead",
    org: "Northstar Health System",
    initials: "EM",
  },
  {
    id: "acc-whitmore",
    name: "Dr. Alan Whitmore",
    email: "alan.whitmore@northstarhealth.org",
    password: "strata",
    role: "Executive",
    org: "Northstar Health System",
    initials: "AW",
  },
  {
    id: "acc-okonkwo",
    name: "James Okonkwo",
    email: "james.okonkwo@northstarhealth.org",
    password: "strata",
    role: "Compliance Officer",
    org: "Northstar Health System",
    initials: "JO",
  },
];

const KEY = "strata-session";

interface AuthContextValue {
  session: Session | null;
  ready: boolean;
  login: (email: string, password: string) => { ok: boolean; error?: string };
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setSession(JSON.parse(raw));
    } catch {}
    setReady(true);
  }, []);

  const login = useCallback((email: string, password: string) => {
    const acc = ACCOUNTS.find(
      (a) => a.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (!acc) return { ok: false, error: "No account found for that email." };
    if (acc.password !== password) return { ok: false, error: "Incorrect password." };
    const s: Session = {
      id: acc.id,
      name: acc.name,
      email: acc.email,
      role: acc.role,
      org: acc.org,
      initials: acc.initials,
    };
    setSession(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    try {
      localStorage.removeItem(KEY);
    } catch {}
  }, []);

  const value = useMemo(
    () => ({ session, ready, login, logout }),
    [session, ready, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return { session: null, ready: true, login: () => ({ ok: false }), logout: () => {} };
  }
  return ctx;
}
