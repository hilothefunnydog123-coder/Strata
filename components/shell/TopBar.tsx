"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, LogOut, Menu, Plus, Search, ShieldCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { alerts as staticAlerts } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { useSimulation } from "@/lib/simulation";
import { ThemeToggle } from "./ThemeToggle";

function UserMenu() {
  const { session, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-2xs font-bold text-accent ring-1 ring-inset ring-accent/30 hover:bg-accent/30"
      >
        {session?.initials ?? "?"}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-60 overflow-hidden rounded-lg border border-edge-strong bg-panel shadow-pop animate-fade-in">
          <div className="border-b border-edge px-3.5 py-3">
            <div className="text-sm font-bold text-fg">{session?.name}</div>
            <div className="mt-0.5 text-xs font-medium text-fg-muted">{session?.email}</div>
            <div className="mt-1.5 inline-flex rounded bg-accent-soft px-1.5 py-0.5 text-2xs font-semibold text-accent">
              {session?.role}
            </div>
          </div>
          {session?.isOwner && (
            <Link
              href="/admin"
              className="flex w-full items-center gap-2 border-b border-edge px-3.5 py-2.5 text-left text-sm font-medium text-fg-muted hover:bg-hover hover:text-fg"
            >
              <ShieldCheck className="h-4 w-4" />
              Owner console
            </Link>
          )}
          <button
            onClick={async () => {
              await logout();
              router.push("/login");
            }}
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-medium text-fg-muted hover:bg-hover hover:text-fg"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar({
  onOpenSearch,
  onOpenMenu,
}: {
  onOpenSearch: () => void;
  onOpenMenu: () => void;
}) {
  const { injectedAlerts, run } = useSimulation();
  const openAlerts =
    staticAlerts.filter((a) => !["Resolved", "Muted"].includes(a.status)).length +
    injectedAlerts.length;
  const simActive = run.running || injectedAlerts.length > 0;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-edge bg-canvas/85 px-4 backdrop-blur">
      <button
        type="button"
        onClick={onOpenMenu}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-edge text-fg-muted hover:bg-hover lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onOpenSearch}
        className="group flex h-9 w-full max-w-sm items-center gap-2.5 rounded-md border border-edge bg-panel px-3 text-left text-sm text-fg-dim transition-colors hover:border-edge-strong"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 truncate">Search AI systems, pages, actions…</span>
        <kbd className="hidden rounded border border-edge bg-raised px-1.5 py-0.5 text-2xs font-medium sm:block">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {simActive && (
          <Link
            href="/simulation"
            className="hidden items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs font-medium text-warning sm:inline-flex"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-warning" />
            </span>
            Simulation active
          </Link>
        )}

        <ButtonLink href="/registry?register=1" variant="primary" size="sm" className="hidden md:inline-flex">
          <Plus className="h-3.5 w-3.5" />
          Register AI
        </ButtonLink>

        <Link
          href="/alerts"
          aria-label="Alerts"
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-edge bg-panel text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Bell className="h-4 w-4" />
          {openAlerts > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[0.6rem] font-bold text-white tnum">
              {openAlerts}
            </span>
          )}
        </Link>

        <ThemeToggle />

        <div className="ml-1">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
