import { CRITERION_KINDS, COVERAGE_STANCES } from "@assent/core";
import type { DocumentSpan } from "@assent/core";

export interface ExtractionContext {
  headingPath: string[];
  prevText?: string;
  nextText?: string;
  documentTitle: string;
}

/**
 * The extraction system prompt. Encodes PROMPT §6 Extract verbatim: empty arrays
 * are normal, quotes must be copied character-for-character and minimal, never
 * infer across documents or apply background knowledge, and binding requirements
 * must be distinguished from descriptive background (policies contain long
 * literature reviews; those are not criteria).
 */
export const EXTRACTION_SYSTEM = `You extract binding coverage requirements from a SINGLE span of a US health-insurance medical policy.

You will be given one target span, its section heading path, and two neighboring spans for context ONLY. Extract requirements that are stated in the TARGET span. Do not extract from the neighbors.

Rules — follow exactly:
1. Returning an empty "criteria" array is NORMAL and expected. Most spans contain no binding criteria. Do not invent a requirement to feel productive.
2. Extract only BINDING requirements — conditions a payer requires before it will pay. Descriptive background, literature summaries, definitions offered "for context", and history are NOT criteria. If a sentence says it does not itself establish coverage, it is not a criterion.
3. For every criterion, "verbatimQuote" MUST be copied character-for-character from the target span, and must be the MINIMAL contiguous substring that supports the requirement. Do not paraphrase the quote. Do not stitch together non-contiguous fragments.
4. Never infer across documents. Never apply outside knowledge of what payers usually require. If it is not written in THIS span, it does not exist.
5. "kind" must be one of: ${CRITERION_KINDS.join(", ")}.
6. Also detect an explicit coverage "stance" on a specific code only when the span states one: ${COVERAGE_STANCES.join(", ")}. A stance is not a criterion; put it in "stances".
7. Output STRICT JSON only, matching the schema. temperature is 0.

Schema:
{
  "criteria": [{
    "kind": <one of the kinds>,
    "subject": <short normalized subject>,
    "requirementText": <the requirement stated plainly>,
    "operator": <one of eq,gte,lte,gt,lt,in,exists,not_exists or null>,
    "value": <string or null>,
    "unit": <string or null>,
    "evidence": { "studyDesign"?: ..., "endpoint"?: ..., "comparator"?: ... },
    "verbatimQuote": <exact minimal substring of the target span>,
    "confidence": <0..1>
  }],
  "stances": [{ "code": <code string>, "stance": <stance>, "verbatimQuote": <exact substring> }]
}`;

export function buildExtractionUserPrompt(span: DocumentSpan, ctx: ExtractionContext): string {
  const heading = ctx.headingPath.length ? ctx.headingPath.join(" › ") : "(no heading)";
  const prev = ctx.prevText ? `\nPREVIOUS SPAN (context only):\n"""${ctx.prevText}"""\n` : "";
  const next = ctx.nextText ? `\nNEXT SPAN (context only):\n"""${ctx.nextText}"""\n` : "";
  return `DOCUMENT: ${ctx.documentTitle}
SECTION: ${heading}
${prev}
TARGET SPAN (extract only from here):
"""${span.text}"""
${next}
Return the JSON now.`;
}

/** The exact string the cache is keyed on for a span (model + system + user). */
export function extractionInput(span: DocumentSpan, ctx: ExtractionContext): string {
  return buildExtractionUserPrompt(span, ctx);
}
