"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "./AppShell";
import { StrataMark } from "./Brand";

const MARKETING = new Set(["/", "/login", "/request-demo", "/download"]);

function isMarketing(pathname: string): boolean {
  return MARKETING.has(pathname) || pathname.startsWith("/request-demo");
}

function Splash({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas">
      <StrataMark className="h-10 w-10 animate-pulse" />
      <div className="text-sm font-semibold text-fg-muted">{label}</div>
    </div>
  );
}

function AppGate({ children }: { children: React.ReactNode }) {
  const { session, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !session) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [ready, session, router, pathname]);

  if (!ready) return <Splash label="Loading Strata" />;
  if (!session) return <Splash label="Redirecting to sign in" />;
  return <AppShell>{children}</AppShell>;
}

function OwnerGate({ children }: { children: React.ReactNode }) {
  const { session, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) router.replace("/login?next=/admin");
    else if (ready && session && !session.isOwner) router.replace("/overview");
  }, [ready, session, router]);

  if (!ready) return <Splash label="Loading Strata" />;
  if (!session || !session.isOwner) return <Splash label="Checking access" />;
  return <>{children}</>;
}

export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isMarketing(pathname)) return <>{children}</>;
  if (pathname.startsWith("/admin")) return <OwnerGate>{children}</OwnerGate>;
  return <AppGate>{children}</AppGate>;
}
