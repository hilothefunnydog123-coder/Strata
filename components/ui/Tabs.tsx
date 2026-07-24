"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export interface TabDef {
  key: string;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabDef[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 overflow-x-auto border-b border-edge",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control for compact option switches (e.g. time ranges). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "sm",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-edge bg-raised p-0.5",
        className,
      )}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-[5px] font-medium transition-colors",
            size === "sm" ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-sm",
            opt.value === value
              ? "bg-panel text-fg shadow-panel"
              : "text-fg-dim hover:text-fg-muted",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
