import { useLocation, useNavigate } from "react-router-dom";
import { useAsset } from "../state/asset";
import { useAuth } from "../state/auth";
import { moduleForPath } from "../nav";

export function Topbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { asset } = useAsset();
  const { signOut } = useAuth();
  const mod = moduleForPath(location.pathname);
  const primaryCode = asset.targetCodes[0];

  return (
    <header className="d-topbar">
      <div>
        <span className="d-topbar-title">{mod ? `${mod.num} · ${mod.label}` : "Assent Desktop"}</span>{" "}
        <span className="d-topbar-sub">{mod?.blurb}</span>
      </div>

      <div className="d-topbar-spacer" />

      <button
        className="d-asset-chip"
        onClick={() => navigate("/asset")}
        title="Active asset — everything downstream keys off this"
        style={{ cursor: "pointer", background: "none" }}
      >
        Asset <b>{asset.name}</b>
        {primaryCode ? <span className="a-mono">{primaryCode}</span> : null}
      </button>

      <button className="d-btn" onClick={onOpenPalette} title="Command palette (⌘K / Ctrl+K)">
        Search <span className="d-kbd" style={{ marginLeft: 4, color: "var(--a-chrome-500)", borderColor: "var(--a-chrome-200)" }}>⌘K</span>
      </button>
      <button className="d-btn" onClick={signOut} title="Sign out of this device">
        Sign out
      </button>
    </header>
  );
}
