"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { CommandMenu } from "./CommandMenu";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <div className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-edge lg:block">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-edge shadow-pop animate-slide-in">
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute -right-10 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md bg-panel text-fg-muted"
              aria-label="Close navigation"
            >
              <X className="h-4 w-4" />
            </button>
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        <TopBar
          onOpenSearch={() => setSearchOpen(true)}
          onOpenMenu={() => setDrawerOpen(true)}
        />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>

      <CommandMenu open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
