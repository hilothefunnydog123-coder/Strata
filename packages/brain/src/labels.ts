import { CRITERION_KINDS, type CriterionKind } from "@assent/core";

/**
 * The classifier's label space: the 12 criterion kinds plus an explicit NONE
 * class for text that is not a binding requirement (background, definitions,
 * literature summaries, section lead-ins). NONE is the majority class and
 * predicting it is the correct answer most of the time.
 */
export const NONE = "none" as const;
export type BrainLabel = CriterionKind | typeof NONE;

export const LABELS: BrainLabel[] = [NONE, ...CRITERION_KINDS];

export const LABEL_INDEX: Record<string, number> = Object.fromEntries(
  LABELS.map((l, i) => [l, i]),
);

export function labelToIndex(l: BrainLabel): number {
  const i = LABEL_INDEX[l];
  if (i === undefined) throw new Error(`unknown label "${l}"`);
  return i;
}

export function indexToLabel(i: number): BrainLabel {
  const l = LABELS[i];
  if (!l) throw new Error(`label index out of range: ${i}`);
  return l;
}

export function isCriterionLabel(l: BrainLabel): l is CriterionKind {
  return l !== NONE;
}
