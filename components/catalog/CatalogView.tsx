"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { RiskBadge, StatusBadge, Chip } from "@/components/ui/Badge";
import { CATEGORY_ORDER } from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import type { AISystem } from "@/lib/types";

function ProfileField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-medium uppercase tracking-wide text-fg-dim">{label}</dt>
      <dd className="mt-0.5 truncate text-xs text-fg">{value}</dd>
    </div>
  );
}

function CatalogCard({ s }: { s: AISystem }) {
  return (
    <Link
      href={`/registry/${s.id}`}
      className="group flex flex-col rounded-lg border border-edge bg-panel p-4 transition-colors hover:border-edge-strong hover:bg-hover"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-fg">{s.name}</h3>
            {s.isAgent && (
              <span className="shrink-0 rounded bg-info/10 px-1 text-[0.6rem] font-semibold uppercase text-info">
                Agent
              </span>
            )}
          </div>
          <div className="mt-0.5 text-2xs text-fg-dim">{s.category}</div>
        </div>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-fg-dim transition-transform group-hover:translate-x-0.5" />
      </div>

      <p className="mt-2 text-xs leading-relaxed text-fg-muted line-clamp-2">{s.purpose}</p>

      <div className="mt-3 flex items-center gap-3">
        <StatusBadge status={s.status} />
        <RiskBadge risk={s.riskLevel} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-edge pt-3">
        <ProfileField label="Owner" value={s.ownerContact} />
        <ProfileField label="Department" value={s.department} />
        <ProfileField label="Vendor" value={s.isInternal ? "Internal" : s.vendor} />
        <ProfileField label="Model type" value={s.modelClass} />
        <ProfileField label="Version" value={<span className="font-mono">{s.currentVersion}</span>} />
        <ProfileField label="Environment" value={s.environment} />
        <ProfileField label="Data class" value={s.dataClassification} />
        <ProfileField label="Regulatory" value={s.regulatoryClass} />
        <ProfileField label="Validation" value={s.validation.status} />
        <ProfileField label="Next review" value={s.flags.overdueValidation ? "Overdue" : fmtDate(s.nextValidationAt)} />
      </dl>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {s.tags.map((t) => (
          <Chip key={t}>{t}</Chip>
        ))}
      </div>
    </Link>
  );
}

export function CatalogView({ systems }: { systems: AISystem[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return systems.filter((s) => {
      if (cat !== "All" && s.category !== cat) return false;
      if (query) {
        const hay = `${s.name} ${s.description} ${s.purpose} ${s.ownerContact} ${s.vendor} ${s.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [systems, q, cat]);

  const cats = ["All", ...CATEGORY_ORDER.filter((c) => systems.some((s) => s.category === c))];

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the catalog by name, purpose, owner…"
            className="h-9 w-full rounded-md border border-edge bg-panel pl-8 pr-3 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                cat === c
                  ? "border-accent/40 bg-accent-soft text-fg"
                  : "border-edge bg-panel text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((s) => (
          <CatalogCard key={s.id} s={s} />
        ))}
      </div>
      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-edge py-16 text-center text-sm text-fg-dim">
          No AI systems match your search.
        </div>
      )}
    </div>
  );
}
