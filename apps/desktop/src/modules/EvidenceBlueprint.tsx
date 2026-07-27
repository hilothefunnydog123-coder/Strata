import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildBlueprint } from "@assent/blueprint";
import type { EnrichedCriterion } from "@assent/blueprint";
import { CRITERION_KIND_LABEL, formatLives, LIVES_DENOMINATOR_LABEL } from "@assent/core";
import type { BlueprintPayload, RequirementCluster } from "@assent/core";
import { LivesBar } from "@assent/ui";
import { useCorpus } from "../data/corpus";
import { useAsset } from "../state/asset";

const DENOM = LIVES_DENOMINATOR_LABEL.modeled_corpus;

/**
 * M5 — Evidence Blueprint. Real clustering via `@assent/blueprint`'s
 * `buildBlueprint` (criteria enriched with the asserting payer, from ACTIVE
 * policy versions only so lives are never double-counted across a v1→v2 pair).
 * The scenario tool below recomputes coverage live: a payer is unlocked when the
 * design satisfies EVERY requirement cluster that payer demands — the same rule
 * the package's frontier synthesis uses.
 */
export function EvidenceBlueprint() {
  const corpus = useCorpus();
  const { asset } = useAsset();
  const navigate = useNavigate();

  const input = useMemo(() => {
    const criteria: EnrichedCriterion[] = [];
    for (const doc of corpus.activeDocuments) {
      for (const c of corpus.criteriaByDoc(doc.id)) criteria.push({ ...c, payerId: doc.payerId });
    }
    const codesByDoc: Record<string, string[]> = {};
    for (const doc of corpus.documents) codesByDoc[doc.id] = corpus.codeIdsForDoc(doc.id);
    return { asset, criteria, codesByDoc, payers: corpus.payers, coveredLives: corpus.coveredLives };
  }, [corpus, asset]);

  const [payload, setPayload] = useState<BlueprintPayload | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    setPayload(null);
    void buildBlueprint(input).then((p) => {
      if (!live) return;
      setPayload(p);
      setSelected(new Set(p.clusters.map((c) => c.id))); // start with every design decision taken
      setExpanded(new Set());
    });
    return () => {
      live = false;
    };
  }, [input]);

  // Scenario recompute — mirrors packages/blueprint/frontier.ts unlock logic.
  const scenario = useMemo(() => {
    if (!payload) return { lives: 0, unlocked: [] as string[], demanders: [] as string[] };
    const demanders = [...new Set(payload.clusters.flatMap((c) => c.payerIds))];
    const demanded = new Map<string, Set<string>>();
    for (const p of demanders) demanded.set(p, new Set());
    for (const c of payload.clusters) for (const p of c.payerIds) demanded.get(p)!.add(c.id);
    const unlocked = demanders.filter((p) => [...(demanded.get(p) ?? new Set())].every((cid) => selected.has(cid)));
    const lives = unlocked.reduce((s, p) => s + corpus.livesForPayer(p), 0);
    return { lives, unlocked, demanders };
  }, [payload, selected, corpus]);

  if (!payload) {
    return (
      <div className="d-flush-scroll">
        <div className="d-auth-status"><span className="d-spinner" /> Building blueprint…</div>
      </div>
    );
  }

  const total = payload.totalCorpusLives;
  const scenarioPct = total > 0 ? Math.round((scenario.lives / total) * 100) : 0;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="d-flush-scroll">
      <div className="d-head">
        <h1>Evidence Blueprint</h1>
        <p>{payload.narrative}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)", gap: 12, alignItems: "start", marginBottom: 12 }}>
        {/* Scenario tool */}
        <div className="d-panel">
          <div className="d-panel-head">Scenario · coverage if this evidence package ships</div>
          <div className="d-panel-body">
            <div className="d-scenario-metric">{scenarioPct}%</div>
            <div className="d-dim" style={{ marginBottom: 10 }}>
              {formatLives(scenario.lives)} {DENOM} · {scenario.unlocked.length} of {scenario.demanders.length} requiring payers unlocked
            </div>
            <LivesBar lives={scenario.lives} total={total} denominatorLabel={DENOM} color="var(--a-chrome-700)" />
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button className="d-btn" onClick={() => setSelected(new Set(payload.clusters.map((c) => c.id)))}>Select all</button>
              <button className="d-btn" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
            <p className="d-dim" style={{ fontSize: 11, marginTop: 10 }}>
              Toggle the requirement clusters your trial will satisfy. A payer only counts once every cluster it demands is checked.
            </p>
          </div>
        </div>

        {/* Frontier path from buildBlueprint */}
        <div className="d-panel">
          <div className="d-panel-head">Evidence frontier · the cheapest path to more lives</div>
          <table className="d-table">
            <thead>
              <tr>
                <th>Design step</th>
                <th style={{ textAlign: "right" }}>+ Lives</th>
                <th style={{ textAlign: "right" }}>Cumulative</th>
                <th>Build cost</th>
              </tr>
            </thead>
            <tbody>
              {payload.frontier.map((step, i) => (
                <tr key={i}>
                  <td>{step.label}</td>
                  <td className="a-mono" style={{ textAlign: "right" }}>{formatLives(step.livesUnlocked)}</td>
                  <td className="a-mono" style={{ textAlign: "right" }}>{Math.round(step.cumulativePct * 100)}%</td>
                  <td><span className="d-tag">{step.costHint}</span></td>
                </tr>
              ))}
              {payload.frontier.length === 0 && (
                <tr><td colSpan={4}><div className="d-empty">No frontier for this asset's codes.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="d-panel">
        <div className="d-panel-head">Requirement clusters · ranked by lives behind them</div>
        <div>
          {payload.clusters.map((cl) => (
            <ClusterRow
              key={cl.id}
              cluster={cl}
              total={total}
              selected={selected.has(cl.id)}
              expanded={expanded.has(cl.id)}
              onToggleSelect={() => toggle(cl.id)}
              onToggleExpand={() => toggleExpand(cl.id)}
              payerName={(id) => corpus.payerById(id)?.name ?? id}
              onJump={(docId, criterionId) => navigate(`/criteria/${docId}?criterion=${criterionId}`)}
            />
          ))}
          {payload.clusters.length === 0 && <div className="d-empty">No requirement clusters for this asset's codes.</div>}
        </div>
      </div>
    </div>
  );
}

function ClusterRow({
  cluster, total, selected, expanded, onToggleSelect, onToggleExpand, payerName, onJump,
}: {
  cluster: RequirementCluster;
  total: number;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  payerName: (id: string) => string;
  onJump: (docId: string, criterionId: string) => void;
}) {
  return (
    <div className="d-cluster">
      <div className="d-cluster-head">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Include ${cluster.label}`} onClick={(e) => e.stopPropagation()} />
        <span className="d-disclose" onClick={onToggleExpand} role="button" aria-expanded={expanded} tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleExpand(); } }}>
          {expanded ? "▾" : "▸"}
        </span>
        <div className="d-cluster-grip" onClick={onToggleExpand} style={{ cursor: "pointer" }}>
          <div className="d-cluster-title">{cluster.label}</div>
          <div className="d-cluster-sub">
            {CRITERION_KIND_LABEL[cluster.kind]} · {cluster.payerCount} payer{cluster.payerCount === 1 ? "" : "s"} · strictness {cluster.strictness.toFixed(2)}
          </div>
        </div>
        <div className="d-cluster-bar">
          <LivesBar lives={cluster.livesCovered} total={total} denominatorLabel={DENOM} color="var(--a-chrome-500)" />
        </div>
      </div>

      {expanded && (
        <div className="d-cluster-detail">
          <div className="d-dim" style={{ marginBottom: 4 }}>
            Required by: {cluster.payerIds.map(payerName).join(", ")}
          </div>
          {cluster.citations.map((cit) => (
            <div
              className="d-cite"
              key={cit.criterionId}
              onClick={() => onJump(cit.policyDocumentId, cit.criterionId)}
              title="Open in the Criteria Rail"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") onJump(cit.policyDocumentId, cit.criterionId); }}
            >
              <div className="d-cite-quote">“{cit.verbatimQuote}”</div>
              <div className="d-cite-src">{payerName(cit.payerId)} · <span className="a-mono">{cit.spanId}</span> → view source</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
