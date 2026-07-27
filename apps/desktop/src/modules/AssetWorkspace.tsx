import { useMemo, useState } from "react";
import type { Asset } from "@assent/core";
import { useAsset, DEFAULT_ASSET } from "../state/asset";
import { useCorpus } from "../data/corpus";
import { MODULES } from "../nav";

/** M3 — Asset Workspace. Define the program you are modeling; M4/M5/M6 key off it.
 *  Persisted to localStorage (see state/asset.tsx). */
export function AssetWorkspace() {
  const corpus = useCorpus();
  const { asset, setAsset, reset } = useAsset();
  const [draft, setDraft] = useState<Asset>(asset);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(asset), [draft, asset]);

  const set = <K extends keyof Asset>(key: K, value: Asset[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSavedAt(null);
  };

  const toggleCode = (codeId: string) => {
    setDraft((d) => ({
      ...d,
      targetCodes: d.targetCodes.includes(codeId)
        ? d.targetCodes.filter((c) => c !== codeId)
        : [...d.targetCodes, codeId],
    }));
    setSavedAt(null);
  };

  const save = () => {
    setAsset(draft);
    setSavedAt(Date.now());
  };

  const consumers = MODULES.filter((m) => ["coverage", "blueprint", "changes"].includes(m.id));

  return (
    <div className="d-flush-scroll">
      <div className="d-head">
        <h1>Asset Workspace</h1>
        <p>Everything downstream keys off this object — the Coverage Map, Evidence Blueprint and Change Watch all read the target codes, indication and population defined here.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
        <div className="d-panel">
          <div className="d-panel-head">Definition</div>
          <div className="d-panel-body" style={{ display: "grid", gap: 12 }}>
            <label className="d-field">
              <span className="d-field-label">Asset name</span>
              <input className="d-input" value={draft.name} onChange={(e) => set("name", e.target.value)} />
            </label>

            <label className="d-field">
              <span className="d-field-label">Indication</span>
              <input className="d-input" value={draft.indication} onChange={(e) => set("indication", e.target.value)} />
            </label>

            <label className="d-field">
              <span className="d-field-label">Intended use</span>
              <textarea className="d-textarea" value={draft.intendedUse} onChange={(e) => set("intendedUse", e.target.value)} />
            </label>

            <div className="d-field">
              <span className="d-field-label">Target codes</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                {corpus.codes.map((c) => {
                  const on = draft.targetCodes.includes(c.id);
                  return (
                    <label key={c.id} className="d-chip" style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer", background: on ? "var(--a-chrome-100)" : "var(--a-chrome-050)" }}>
                      <input type="checkbox" checked={on} onChange={() => toggleCode(c.id)} />
                      <span>{c.code}</span>
                      <span className="d-dim" style={{ fontFamily: "var(--a-font-sans)" }}>{c.system}</span>
                    </label>
                  );
                })}
              </div>
              <span className="d-dim" style={{ marginTop: 4 }}>{draft.targetCodes.length} selected · {draft.targetCodes.join(", ") || "none"}</span>
            </div>

            <label className="d-field">
              <span className="d-field-label">Comparator</span>
              <input className="d-input" value={draft.comparator} onChange={(e) => set("comparator", e.target.value)} />
            </label>

            <label className="d-field">
              <span className="d-field-label">Target population</span>
              <input className="d-input" value={draft.targetPopulation} onChange={(e) => set("targetPopulation", e.target.value)} />
            </label>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="d-btn d-btn--primary" onClick={save} disabled={!dirty}>Save asset</button>
              <button
                className="d-btn"
                title="Restore the seeded demo asset"
                onClick={() => { reset(); setDraft(DEFAULT_ASSET); setSavedAt(null); }}
              >
                Reset to default
              </button>
              {savedAt && !dirty && <span className="d-dim">Saved · persisted to this device</span>}
              {dirty && <span className="d-dim">Unsaved changes</span>}
            </div>
          </div>
        </div>

        <div className="d-panel">
          <div className="d-panel-head">Keys off this asset</div>
          <div className="d-panel-body" style={{ display: "grid", gap: 10 }}>
            {consumers.map((m) => (
              <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span className="a-mono d-dim" style={{ width: 26 }}>{m.num}</span>
                <div>
                  <div className="d-strong">{m.label}</div>
                  <div className="d-dim">{m.blurb}</div>
                </div>
              </div>
            ))}
            <div className="d-dim" style={{ borderTop: "1px solid var(--a-chrome-100)", paddingTop: 8, fontSize: 11 }}>
              Stored locally as <span className="a-mono">assent.desktop.asset</span>. In production the asset lives per-account on the server and syncs to every device.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
