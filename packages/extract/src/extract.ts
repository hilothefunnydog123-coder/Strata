import {
  makeVerifiedCriterion,
  makeVerifiedStance,
  type Criterion,
  type CoverageStanceRecord,
  type RejectedExtraction,
  type LlmCall,
  type DocumentSpan,
  type CriterionDraft,
} from "@assent/core";
import { classifier, detectStance, CriterionClassifier } from "@assent/brain";
import { CRITERION_KIND_LABEL } from "@assent/core";
import { makeCriterionId } from "./identity";

/**
 * Extraction — powered by @assent/brain, a locally-trained classifier. There is
 * no language model in this path and no network call.
 *
 * WHY THE CITATION INVARIANT IS NOW STRUCTURAL:
 *   The classifier never writes text. It scores candidate clauses that were cut
 *   out of the stored document, so `verbatimQuote` is `span.text.slice(start,end)`
 *   — a literal substring by construction. Fabrication is impossible rather than
 *   filtered after the fact. We still run every draft through
 *   makeVerifiedCriterion as defense in depth; that gate should never fire, and
 *   if it ever does it means segmentation and storage have drifted apart, which
 *   is a bug we want to hear about loudly.
 *
 * The model's failure mode is therefore "surfaced a sentence that is not actually
 * binding" — visible to the user in one click, and recoverable — never "asserted a
 * requirement that does not exist in any document".
 */

export interface SpanContext {
  source: string;
  externalId: string;
  version: number;
  documentTitle: string;
  headingPath: string[];
  prevText?: string;
  nextText?: string;
  /** Retained for API compatibility; unused — extraction is local. */
  model?: string;
  /** Resolve a code string (e.g. "0239U") to a Code id. */
  resolveCode?: (code: string) => string | null;
  /** Codes the document is linked to, used to attach a stance when the span names none. */
  documentCodes?: string[];
}

export interface SpanExtraction {
  criteria: Criterion[];
  stances: CoverageStanceRecord[];
  rejections: RejectedExtraction[];
  /** Always empty now — kept so callers and the schema stay unchanged. */
  llmCall: LlmCall | null;
  rawOutput: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Model identifier recorded on every criterion, for provenance. */
export function extractorName(): string {
  const meta = classifier().meta as { architecture?: string };
  return `assent-brain/${meta.architecture ? "mlp" : "local"}`;
}

/** Extract one span with the local classifier. */
export function extractSpan(span: DocumentSpan, ctx: SpanContext): SpanExtraction {
  const brain = classifier();
  const criteria: Criterion[] = [];
  const stances: CoverageStanceRecord[] = [];
  const rejections: RejectedExtraction[] = [];
  const extractedByModel = extractorName();

  const predictions = brain.extract(span.text, span.headingPath);
  predictions.forEach((p, i) => {
    const draft: CriterionDraft = {
      kind: p.kind,
      subject: subjectFor(p.kind, p.quote),
      requirementText: p.quote,
      operator: null,
      value: null,
      unit: null,
      evidence: {},
      verbatimQuote: p.quote,
      confidence: p.confidence,
    };
    const r = makeVerifiedCriterion(draft, span, {
      id: makeCriterionId(span.id, i),
      extractedByModel,
      extractedAt: nowIso(),
    });
    if (r.ok) criteria.push(r.value);
    else rejections.push({ id: `${span.id}_rc${i}`, createdAt: nowIso(), ...r.rejection });
  });

  // Stance (rules, extractive) — attached to the codes this document covers.
  const st = detectStance(span.text);
  if (st) {
    const codes = ctx.documentCodes ?? [];
    codes.forEach((code, i) => {
      const codeId = ctx.resolveCode?.(code) ?? null;
      if (!codeId) return;
      const r = makeVerifiedStance({ stance: st.stance, codeId, verbatimQuote: st.quote }, span, {
        id: `${span.id}_st${i}`,
      });
      if (r.ok) stances.push(r.value);
      else rejections.push({ id: `${span.id}_rst${i}`, createdAt: nowIso(), ...r.rejection });
    });
  }

  return {
    criteria,
    stances,
    rejections,
    llmCall: null,
    rawOutput: JSON.stringify({ predictions, stance: st }),
  };
}

/**
 * A short normalized subject for the criterion, used for cross-payer clustering.
 * Derived from the kind plus the salient noun phrase, without inventing content.
 */
function subjectFor(kind: string, quote: string): string {
  const label = CRITERION_KIND_LABEL[kind as keyof typeof CRITERION_KIND_LABEL] ?? kind;
  const words = quote.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const salient = words.filter((w) => w.length > 4).slice(0, 4).join(" ");
  return salient ? `${label.toLowerCase()}: ${salient}` : label.toLowerCase();
}

export interface DocumentExtraction {
  criteria: Criterion[];
  stances: CoverageStanceRecord[];
  rejections: RejectedExtraction[];
  llmCalls: LlmCall[];
  /** Fraction of extracted claims that failed verification (PROMPT §5). */
  rejectionRate: number;
}

/** Extract a full document's spans. */
export async function extractDocument(
  spans: DocumentSpan[],
  docCtx: Omit<SpanContext, "headingPath" | "prevText" | "nextText">,
): Promise<DocumentExtraction> {
  const criteria: Criterion[] = [];
  const stances: CoverageStanceRecord[] = [];
  const rejections: RejectedExtraction[] = [];

  const ordered = [...spans].sort((a, b) => a.ordinal - b.ordinal);
  for (const span of ordered) {
    const result = extractSpan(span, { ...docCtx, headingPath: span.headingPath });
    criteria.push(...result.criteria);
    stances.push(...result.stances);
    rejections.push(...result.rejections);
  }

  const claims = criteria.length + stances.length + rejections.length;
  return {
    criteria,
    stances,
    rejections,
    llmCalls: [],
    rejectionRate: claims === 0 ? 0 : rejections.length / claims,
  };
}

export { CriterionClassifier };
