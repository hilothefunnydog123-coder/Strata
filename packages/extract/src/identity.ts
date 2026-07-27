/** Deterministic ids so fixtures, golden labels, and stored rows agree offline. */
export function makePolicyDocId(source: string, externalId: string, version: number): string {
  const slug = externalId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `doc_${source}_${slug}_v${version}`;
}

export function makeSpanId(policyDocumentId: string, ordinal: number): string {
  return `${policyDocumentId}_s${ordinal}`;
}

export function makeCriterionId(spanId: string, index: number): string {
  return `${spanId}_c${index}`;
}
