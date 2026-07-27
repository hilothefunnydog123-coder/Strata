import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Asset } from "@assent/core";

/**
 * The Asset is the object M4 (Coverage Map), M5 (Evidence Blueprint) and M6
 * (Change Watch) all key off. It is defined in M3 and persisted to localStorage
 * so the terminal remembers the program you are modeling between sessions.
 *
 * In the shipping app the Asset lives server-side (per Account) and syncs; here
 * a single locally-stored asset is enough to drive every downstream module.
 */

const STORAGE_KEY = "assent.desktop.asset";

/** Seeded to the demo corpus (comprehensive genomic profiling) so the downstream
 *  modules show real coverage math the moment the app opens. */
export const DEFAULT_ASSET: Asset = {
  id: "asset_local",
  accountId: "acct_local",
  name: "CGP-Dx (liquid + tissue)",
  indication: "Advanced or metastatic solid tumor; therapy selection",
  intendedUse: "Comprehensive genomic profiling to select targeted therapy",
  targetCodes: ["CPT:81445", "CPT:81479", "PLA:0239U"],
  comparator: "Standard of care single-gene testing",
  targetPopulation: "Adults with advanced/metastatic solid tumors",
};

interface AssetContextValue {
  asset: Asset;
  setAsset: (next: Asset) => void;
  reset: () => void;
}

const AssetContext = createContext<AssetContextValue | null>(null);

function load(): Asset {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ASSET;
    const parsed = JSON.parse(raw) as Partial<Asset>;
    // Merge over defaults so an older/partial record never yields undefined fields.
    return { ...DEFAULT_ASSET, ...parsed, targetCodes: parsed.targetCodes ?? DEFAULT_ASSET.targetCodes };
  } catch {
    return DEFAULT_ASSET;
  }
}

export function AssetProvider({ children }: { children: ReactNode }) {
  const [asset, setAssetState] = useState<Asset>(() => load());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(asset));
    } catch {
      /* storage unavailable (private mode) — the in-memory copy still drives the UI */
    }
  }, [asset]);

  const setAsset = useCallback((next: Asset) => setAssetState(next), []);
  const reset = useCallback(() => setAssetState(DEFAULT_ASSET), []);

  const value = useMemo<AssetContextValue>(() => ({ asset, setAsset, reset }), [asset, setAsset, reset]);
  return <AssetContext.Provider value={value}>{children}</AssetContext.Provider>;
}

export function useAsset(): AssetContextValue {
  const ctx = useContext(AssetContext);
  if (!ctx) throw new Error("useAsset must be used inside <AssetProvider>");
  return ctx;
}
