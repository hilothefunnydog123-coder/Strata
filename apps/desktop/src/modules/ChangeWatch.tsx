import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChangeChip } from "@assent/ui";
import { CRITERION_KIND_LABEL, changeDirection } from "@assent/core";
import type { CriterionChange } from "@assent/core";
import { useCorpus } from "../data/corpus";
import { useAsset } from "../state/asset";

const DIRECTION_LABEL: Record<ReturnType<typeof changeDirection>, string> = {
  harder: "makes coverage harder",
  easier: "makes coverage easier",
  neutral: "no change to the bar",
};

/** M6 — Change Watch. Criterion-level diffs, each scored by whether it touches the
 *  current asset's codes. The MolDX L38045 v1→v2 revision lives in the data. */
export function ChangeWatch() {
  const corpus = useCorpus();
  const { asset } = useAsset();
  const navigate = useNavigate();
  const targetCodes = new Set(asset.targetCodes);

  const touchesAsset = (chg: CriterionChange): boolean =>
    corpus.codeIdsForDoc(chg.policyDocumentId).some((c) => targetCodes.has(c));

  // Group by the policy that recorded the change (its supersedes edge gives v1→v2).
  const groups = useMemo(() => {
    const byDoc = new Map<string, CriterionChange[]>();
    for (const chg of corpus.changes) {
      const bucket = byDoc.get(chg.policyDocumentId);
      if (bucket) bucket.push(chg);
      else byDoc.set(chg.policyDocumentId, [chg]);
    }
    return [...byDoc.entries()].map(([docId, changes]) => ({
      docId,
      changes: changes.slice().sort((a, b) => Number(touchesAsset(b)) - Number(touchesAsset(a))),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpus, asset]);

  const affectingCount = corpus.changes.filter(touchesAsset).length;

  return (
    <div className="d-flush-scroll">
      <div className="d-head">
        <h1>Change Watch</h1>
        <p>{corpus.changes.length} criterion-level changes · {affectingCount} touch your asset's codes ({asset.targetCodes.join(", ") || "none"}).</p>
      </div>

      {groups.map(({ docId, changes }) => {
        const toDoc = corpus.documentById(docId);
        const fromDoc = toDoc?.supersedesId ? corpus.documentById(toDoc.supersedesId) : undefined;
        const payer = toDoc ? corpus.payerById(toDoc.payerId) : undefined;
        return (
          <div className="d-panel" key={docId} style={{ marginBottom: 14 }}>
            <div className="d-panel-head">
              <span>{payer?.name ?? ""}</span>
              <span className="a-mono" style={{ color: "var(--a-ink)" }}>{toDoc?.externalId}</span>
              {fromDoc && (
                <span className="a-mono">v1 {fromDoc.effectiveDate} → v2 {toDoc?.effectiveDate}</span>
              )}
            </div>
            <div className="d-panel-body">
              {changes.map((chg) => {
                const from = chg.fromCriterionId ? corpus.criterionById(chg.fromCriterionId) : undefined;
                const to = chg.toCriterionId ? corpus.criterionById(chg.toCriterionId) : undefined;
                const anchor = to ?? from;
                const dir = changeDirection(chg.changeType);
                return (
                  <div className="d-change" key={chg.id}>
                    <div className="d-change-head">
                      <ChangeChip change={chg.changeType} />
                      <span className="d-strong">{anchor ? CRITERION_KIND_LABEL[anchor.kind] : "Requirement"}</span>
                      <span className="d-dim">{anchor?.subject}</span>
                      {touchesAsset(chg) && <span className="d-affects">affects asset</span>}
                      <span className="d-topbar-spacer" />
                      <span className="d-dim">{DIRECTION_LABEL[dir]}</span>
                    </div>
                    <div className="d-change-diff">
                      <div className="d-change-cell">
                        <div className="d-change-cell-label">Was (v1)</div>
                        <div className="d-change-cell-text">{from ? from.requirementText : <span className="d-dim">— not present —</span>}</div>
                      </div>
                      <div className="d-change-cell">
                        <div className="d-change-cell-label">Now (v2)</div>
                        <div className="d-change-cell-text">{to ? to.requirementText : <span className="d-dim">— removed —</span>}</div>
                      </div>
                    </div>
                    <div className="d-change-rationale">{chg.rationale}</div>
                    {anchor && (
                      <div style={{ marginTop: 8 }}>
                        <button
                          className="d-inline-link"
                          onClick={() => navigate(`/criteria/${anchor.policyDocumentId}?criterion=${anchor.id}`)}
                        >
                          View in source →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {groups.length === 0 && <div className="d-empty">No recorded changes in this corpus.</div>}
    </div>
  );
}
