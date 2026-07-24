"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { systems } from "@/lib/data";
import { RISK_TEXT } from "@/lib/constants";
import { allNavItems } from "./nav";

interface CommandItem {
  id: string;
  label: string;
  sub: string;
  href: string;
  group: "Navigate" | "AI System";
  risk?: string;
}

export function CommandMenu({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items: CommandItem[] = useMemo(() => {
    const nav: CommandItem[] = allNavItems.map((n) => ({
      id: `nav-${n.href}`,
      label: n.label,
      sub: "Page",
      href: n.href,
      group: "Navigate",
    }));
    const sys: CommandItem[] = systems.map((s) => ({
      id: `sys-${s.id}`,
      label: s.name,
      sub: `${s.category} · ${s.environment} · v${s.currentVersion}`,
      href: `/registry/${s.id}`,
      group: "AI System",
      risk: s.riskLevel,
    }));
    return [...nav, ...sys];
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    return items
      .filter(
        (i) =>
          i.label.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, items]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const go = (item?: CommandItem) => {
    const target = item ?? filtered[active];
    if (target) {
      router.push(target.href);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-edge-strong bg-panel shadow-pop animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-edge px-4">
          <Search className="h-4 w-4 text-fg-dim" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go();
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Search AI systems, pages, actions…"
            className="h-12 w-full bg-transparent text-sm text-fg placeholder:text-fg-dim focus:outline-none"
          />
          <kbd className="hidden rounded border border-edge bg-raised px-1.5 py-0.5 text-2xs text-fg-dim sm:block">
            ESC
          </kbd>
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-fg-dim">
              No matches for “{query}”.
            </div>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                i === active ? "bg-accent-soft" : "hover:bg-hover",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-5 items-center rounded border border-edge bg-raised px-1.5 text-2xs font-medium text-fg-dim",
                )}
              >
                {item.group === "AI System" ? "AI" : "Go"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{item.label}</span>
                <span className="block truncate text-2xs text-fg-dim">{item.sub}</span>
              </span>
              {item.risk && (
                <span className={cn("text-2xs font-medium", RISK_TEXT[item.risk as keyof typeof RISK_TEXT])}>
                  {item.risk}
                </span>
              )}
              {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-fg-dim" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
