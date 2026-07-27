import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./state/auth";
import { AssetProvider } from "./state/asset";
import { CorpusProvider, buildCorpusApi } from "./data/corpus";
import type { Corpus, CorpusApi } from "./data/corpus";
import { Shell } from "./components/Shell";
import { DeviceAuth } from "./auth/DeviceAuth";
import { CorpusModule } from "./modules/CorpusModule";
import { CriteriaRail } from "./modules/CriteriaRail";
import { AssetWorkspace } from "./modules/AssetWorkspace";
import { CoverageMap } from "./modules/CoverageMap";
import { EvidenceBlueprint } from "./modules/EvidenceBlueprint";
import { ChangeWatch } from "./modules/ChangeWatch";

export function App() {
  return (
    <AuthProvider>
      <AssetProvider>
        <Routes>
          <Route path="/auth" element={<DeviceAuth />} />
          <Route
            element={
              <RequireAuth>
                <CorpusHost />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Navigate to="/corpus" replace />} />
            <Route path="/corpus" element={<CorpusModule />} />
            <Route path="/criteria" element={<CriteriaRail />} />
            <Route path="/criteria/:docId" element={<CriteriaRail />} />
            <Route path="/asset" element={<AssetWorkspace />} />
            <Route path="/coverage" element={<CoverageMap />} />
            <Route path="/blueprint" element={<EvidenceBlueprint />} />
            <Route path="/changes" element={<ChangeWatch />} />
            <Route path="*" element={<Navigate to="/corpus" replace />} />
          </Route>
        </Routes>
      </AssetProvider>
    </AuthProvider>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { authed } = useAuth();
  const location = useLocation();
  if (!authed) return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; api: CorpusApi };

/** Loads `/corpus.json` once, then hands the app the typed selector surface. */
function CorpusHost() {
  const [raw, setRaw] = useState<Corpus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Demo path: fetch the bundled corpus. Production reads @assent/local-db (SQLite).
    fetch(new URL("corpus.json", document.baseURI))
      .then((r) => {
        if (!r.ok) throw new Error(`corpus.json ${r.status}`);
        return r.json() as Promise<Corpus>;
      })
      .then((data) => {
        if (live) setRaw(data);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "failed to load corpus");
      });
    return () => {
      live = false;
    };
  }, []);

  const state: LoadState = useMemo(() => {
    if (error) return { status: "error", message: error };
    if (!raw) return { status: "loading" };
    return { status: "ready", api: buildCorpusApi(raw) };
  }, [raw, error]);

  if (state.status === "loading") {
    return (
      <div className="d-auth">
        <div className="d-auth-status" style={{ color: "var(--a-chrome-300)" }}>
          <span className="d-spinner" /> Loading corpus…
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="d-auth">
        <div className="d-auth-card">
          <div className="d-strong">Could not load the corpus</div>
          <p className="d-dim" style={{ fontSize: 12 }}>{state.message}</p>
        </div>
      </div>
    );
  }

  return (
    <CorpusProvider value={state.api}>
      <Shell>
        <Outlet />
      </Shell>
    </CorpusProvider>
  );
}
