import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Device-auth session state for the demo. `authed` gates the app shell; the
 * `/auth` screen flips it via `approve()` once the (simulated) browser approval
 * lands. Real token storage is described in `auth/DeviceAuth.tsx`.
 */
const STORAGE_KEY = "assent.desktop.authed";

/**
 * Served inside the signed-in console rather than the Tauri webview.
 *
 * The device flow exists so a native app can get a token without ever seeing a
 * password. When the console is already serving these files, that has happened:
 * the request carried a verified session cookie or it would not have been served
 * at all. Pairing a "device" against the browser it is running in would be
 * ceremony, so the shell opens directly.
 */
function consoleHosted(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("host") === "console";
  } catch {
    return false;
  }
}

interface AuthContextValue {
  authed: boolean;
  approve: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean>(() => {
    if (consoleHosted()) return true;
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const approve = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setAuthed(true);
  }, []);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setAuthed(false);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ authed, approve, signOut }), [authed, approve, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
