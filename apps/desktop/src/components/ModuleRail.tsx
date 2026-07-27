import { NavLink } from "react-router-dom";
import { PRODUCT } from "@assent/core";
import { MODULES } from "../nav";
import type { ModuleDef } from "../nav";

const GROUPS: { label: string; ids: string[] }[] = [
  { label: "Research", ids: ["corpus", "criteria"] },
  { label: "Model", ids: ["asset", "coverage", "blueprint"] },
  { label: "Monitor", ids: ["changes"] },
  { label: "Later", ids: ["library", "campaign"] },
];

export function ModuleRail({ onOpenPalette }: { onOpenPalette: () => void }) {
  const byId = new Map<string, ModuleDef>(MODULES.map((m) => [m.id, m]));
  return (
    <nav className="d-rail" aria-label="Modules">
      <div className="d-rail-brand">
        <div className="d-rail-brand-name">{PRODUCT.desktopName}</div>
        <div className="d-rail-brand-sub">Coverage-policy research terminal</div>
      </div>

      {GROUPS.map((g) => (
        <div className="d-rail-group" key={g.label}>
          <div className="d-rail-group-label">{g.label}</div>
          {g.ids.map((id) => {
            const m = byId.get(id);
            if (!m) return null;
            return m.enabled ? (
              <NavLink
                key={m.id}
                to={m.path}
                className={({ isActive }) => "d-rail-item" + (isActive ? " d-rail-item--active" : "")}
                title={m.blurb}
              >
                <span className="d-rail-num">{m.num}</span>
                <span>{m.label}</span>
              </NavLink>
            ) : (
              <div
                key={m.id}
                className="d-rail-item d-rail-item--disabled"
                aria-disabled="true"
                title={`${m.label} — coming soon`}
              >
                <span className="d-rail-num">{m.num}</span>
                <span>{m.label}</span>
                <span className="d-rail-soon">soon</span>
              </div>
            );
          })}
        </div>
      ))}

      <div className="d-rail-foot">
        <button className="d-rail-item" style={{ padding: "6px 0", borderLeft: 0 }} onClick={onOpenPalette}>
          <span>Command palette</span>
          <span className="d-kbd" style={{ marginLeft: "auto" }}>⌘K</span>
        </button>
        <div style={{ marginTop: 8 }}>Offline corpus · fixture build</div>
      </div>
    </nav>
  );
}
