import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ModuleRail } from "./ModuleRail";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";

/** The app frame: fixed module rail, a thin topbar, the dense content region,
 *  and the global command palette wired to ⌘K / Ctrl+K. */
export function Shell({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="d-shell">
      <ModuleRail onOpenPalette={openPalette} />
      <div className="d-main">
        <Topbar onOpenPalette={openPalette} />
        <div className="d-content-host">{children}</div>
      </div>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
