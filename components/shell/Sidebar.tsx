"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { ORG } from "@/lib/constants";
import { alerts as staticAlerts, estate, incidents } from "@/lib/data";
import { useSimulation } from "@/lib/simulation";
import { Brand } from "./Brand";
import { navSections, type NavItem } from "./nav";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { injectedAlerts } = useSimulation();

  const openAlerts =
    staticAlerts.filter((a) => !["Resolved", "Muted"].includes(a.status)).length +
    injectedAlerts.length;
  const openIncidents = incidents.filter((i) =>
    ["Investigating", "Contained", "Monitoring"].includes(i.status),
  ).length;

  const badgeFor = (item: NavItem): number | undefined => {
    if (item.badgeKey === "alerts") return openAlerts;
    if (item.badgeKey === "incidents") return openIncidents;
    if (item.badgeKey === "approvals") return estate.awaitingApproval;
    return undefined;
  };

  const isActive = (item: NavItem) =>
    item.match ? item.match(pathname) : pathname === item.href;

  return (
    <aside className="flex h-full w-full flex-col bg-panel">
      <div className="flex h-14 items-center border-b border-edge px-4">
        <Link href="/" onClick={onNavigate} className="outline-none">
          <Brand />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {navSections.map((section) => (
          <div key={section.title} className="mb-5">
            <div className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-[0.13em] text-fg-dim">
              {section.title}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item);
                const badge = badgeFor(item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-accent-soft font-medium text-fg"
                        : "text-fg-muted hover:bg-hover hover:text-fg",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        active ? "text-accent" : "text-fg-dim group-hover:text-fg-muted",
                      )}
                      strokeWidth={2}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge !== undefined && badge > 0 && (
                      <span
                        className={cn(
                          "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-2xs font-semibold tnum",
                          item.badgeKey === "alerts"
                            ? "bg-critical/15 text-critical"
                            : "bg-raised text-fg-muted",
                        )}
                      >
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-edge p-3">
        <div className="flex items-center gap-2.5 rounded-md bg-raised px-2.5 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 text-2xs font-bold text-accent">
            NH
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-fg">{ORG.name}</div>
            <div className="truncate text-2xs text-fg-dim">
              {ORG.hospitals} hospitals · {estate.total} AI systems
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
