import {
  ExtractionOutputSchema,
  makeVerifiedCriterion,
  makeVerifiedStance,
  type Criterion,
  type CoverageStanceRecord,
  type RejectedExtraction,
  type LlmCall,
  type DocumentSpan,
  type CriterionDraft,
} from "@assent/core";
import { pipelineMode } from "./paths";
import { goldenFor } from "./golden-provider";
import { EXTRACTION_SYSTEM, buildExtractionUserPrompt, type ExtractionContext } from "./prompt";
import { cacheKey, readCache, writeCache } from "./cache";
import { makeCriterionId } from "./identity";
import { makeLlmCall } from "./cost";

export interface SpanContext {
  source: string;
  externalId: string;
  version: number;
  documentTitle: string;
  headingPath: string[];
  prevText?: string;
  nextText?: string;
  model: string;
  /** Resolve a code string (e.g. "0239U") to a Code id. Unresolved stances are rejected, not dropped. */
  resolveCode?: (code: string) => string | null;
}

export interface SpanExtraction {
  criteria: Criterion[];
  stances: CoverageStanceRecord[];
  rejections: RejectedExtraction[];
  llmCall: LlmCall | null;
  rawOutput: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Extract one span through the citation invariant. Offline reads golden labels; live calls the model. */
export async function extractSpan(span: DocumentSpan, ctx: SpanContext): Promise<SpanExtraction> {
  const mode = pipelineMode();
  const promptCtx: ExtractionContext = {
    headingPath: ctx.headingPath,
    prevText: ctx.prevText,
    nextText: ctx.nextText,
    documentTitle: ctx.documentTitle,
  };

  let rawOutput: string;
  let llmCall: LlmCall | null = null;
  let parsedUnknown: unknown;

  if (mode === "fixture") {
    parsedUnknown = goldenFor(ctx.source, ctx.externalId, ctx.version, span.ordinal);
    rawOutput = JSON.stringify(parsedUnknown);
  } else {
    const user = buildExtractionUserPrompt(span, promptCtx);
    const key = cacheKey(ctx.model, EXTRACTION_SYSTEM, user);
    let cached = readCache("extract", key);
    const t0 = Date.now();
    if (!cached) {
      const { callModel } = await import("./anthropic");
      cached = await callModel({ model: ctx.model, system: EXTRACTION_SYSTEM, user });
      writeCache("extract", key, cached);
    }
    rawOutput = cached.text;
    llmCall = makeLlmCall({
      id: `llm_${key.slice(0, 16)}`,
      inputHash: key,
      model: ctx.model,
      promptTokens: cached.promptTokens,
      completionTokens: cached.completionTokens,
      latencyMs: Date.now() - t0,
      stage: "extract",
    });
    try {
      parsedUnknown = JSON.parse(cached.text);
    } catch {
      parsedUnknown = null;
    }
  }

  const parsed = ExtractionOutputSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    // Off-schema output is a rejection for the whole span, never a repair.
    return {
      criteria: [],
      stances: [],
      rejections: [
        {
          id: `${span.id}_rschema`,
          spanId: span.id,
          rawModelOutput: rawOutput.slice(0, 4000),
          rejectionReason: `output failed schema validation: ${parsed.error.issues[0]?.message ?? "invalid"}`,
          createdAt: nowIso(),
        },
      ],
      llmCall,
      rawOutput,
    };
  }

  const criteria: Criterion[] = [];
  const stances: CoverageStanceRecord[] = [];
  const rejections: RejectedExtraction[] = [];
  const extractedByModel = mode === "fixture" ? "fixture-golden" : ctx.model;

  parsed.data.criteria.forEach((draftRaw, i) => {
    const draft: CriterionDraft = {
      kind: draftRaw.kind,
      subject: draftRaw.subject,
      requirementText: draftRaw.requirementText,
      operator: draftRaw.operator,
      value: draftRaw.value,
      unit: draftRaw.unit,
      evidence: draftRaw.evidence,
      verbatimQuote: draftRaw.verbatimQuote,
      confidence: draftRaw.confidence,
    };
    const r = makeVerifiedCriterion(draft, span, {
      id: makeCriterionId(span.id, i),
      extractedByModel,
      extractedAt: nowIso(),
    });
    if (r.ok) criteria.push(r.value);
    else rejections.push({ id: `${span.id}_rc${i}`, createdAt: nowIso(), ...r.rejection });
  });

  parsed.data.stances.forEach((s, i) => {
    const codeId = ctx.resolveCode?.(s.code) ?? null;
    if (!codeId) {
      rejections.push({
        id: `${span.id}_rs${i}`,
        spanId: span.id,
        rawModelOutput: JSON.stringify(s),
        rejectionReason: `stance references unknown code "${s.code}"`,
        createdAt: nowIso(),
      });
      return;
    }
    const r = makeVerifiedStance({ stance: s.stance, codeId, verbatimQuote: s.verbatimQuote }, span, {
      id: `${span.id}_st${i}`,
    });
    if (r.ok) stances.push(r.value);
    else rejections.push({ id: `${span.id}_rst${i}`, createdAt: nowIso(), ...r.rejection });
  });

  return { criteria, stances, rejections, llmCall, rawOutput };
}

export interface DocumentExtraction {
  criteria: Criterion[];
  stances: CoverageStanceRecord[];
  rejections: RejectedExtraction[];
  llmCalls: LlmCall[];
  /** Fraction of extracted claims that failed verification (PROMPT §5). */
  rejectionRate: number;
}

/** Extract a full document's spans, supplying neighbor context (anchored to the target). */
export async function extractDocument(
  spans: DocumentSpan[],
  docCtx: Omit<SpanContext, "headingPath" | "prevText" | "nextText">,
): Promise<DocumentExtraction> {
  const criteria: Criterion[] = [];
  const stances: CoverageStanceRecord[] = [];
  const rejections: RejectedExtraction[] = [];
  const llmCalls: LlmCall[] = [];

  const ordered = [...spans].sort((a, b) => a.ordinal - b.ordinal);
  for (let i = 0; i < ordered.length; i++) {
    const span = ordered[i]!;
    const result = await extractSpan(span, {
      ...docCtx,
      headingPath: span.headingPath,
      prevText: ordered[i - 1]?.text,
      nextText: ordered[i + 1]?.text,
    });
    criteria.push(...result.criteria);
    stances.push(...result.stances);
    rejections.push(...result.rejections);
    if (result.llmCall) llmCalls.push(result.llmCall);
  }

  const claims = criteria.length + stances.length + rejections.length;
  return { criteria, stances, rejections, llmCalls, rejectionRate: claims === 0 ? 0 : rejections.length / claims };
}
