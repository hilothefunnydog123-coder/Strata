import type { Criterion, CoverageStanceRecord, DocumentSpan } from "./types";
import type { CriterionKind, CriterionOperator } from "./criterion";
import type { CoverageStance } from "./stance";
import type { EvidenceFacet } from "./types";

/**
 * ── THE CITATION INVARIANT (PROMPT §5) ──────────────────────────────────────
 *
 *   No claim may exist in this system without a verbatim span of source text
 *   supporting it, and that span must be programmatically verified to exist in
 *   the stored source document.
 *
 * This module is Level 1 (types) and Level 3 (verification) of the four-level
 * enforcement. It is deliberately the only sanctioned way to construct a
 * Criterion or a CoverageStanceRecord. Normalization is shared between the
 * boolean check and the offset locator so that "it verifies" and "we can
 * highlight it" can never disagree.
 *
 * Precision beats recall by an enormous margin here. On failure a claim is
 * DISCARDED and recorded as a rejection. It is NEVER repaired into acceptance.
 */

const ZERO_WIDTH = /[​‌‍﻿]/;

/** Normalize a single code point for matching: unify quotes, dashes, spaces. */
function normChar(ch: string): string {
  // Smart quotes / primes → straight.
  if (ch === "‘" || ch === "’" || ch === "‛" || ch === "′") return "'";
  if (ch === "“" || ch === "”" || ch === "‟" || ch === "″") return '"';
  // Dash family → hyphen-minus.
  if (
    ch === "‐" || ch === "‑" || ch === "‒" || ch === "–" ||
    ch === "—" || ch === "―" || ch === "−"
  ) {
    return "-";
  }
  return ch;
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch) || ch === " " || ch === " " || ch === " ";
}

export interface Normalized {
  /** The normalized text used for matching. */
  norm: string;
  /**
   * map[i] = index in the ORIGINAL string of the first code unit that produced
   * norm[i]. map has length norm.length + 1; map[norm.length] = original.length,
   * so a match end index in `norm` maps cleanly back to an original offset.
   */
  map: number[];
}

/**
 * Build the normalized form of `text` with an index map back to original offsets.
 * Whitespace runs collapse to a single space; zero-width chars are dropped;
 * unicode is NFKC-folded per code point. This one function backs both
 * verifyQuote() and locateQuote() so highlighting can never drift from verification.
 */
export function buildNormalized(text: string): Normalized {
  const norm: string[] = [];
  const map: number[] = [];
  let pendingSpaceOrigin = -1; // origin index of an in-progress whitespace run

  const chars = Array.from(text); // iterate by code point
  let orig = 0; // running original code-unit offset
  for (const ch of chars) {
    const width = ch.length; // code units this code point occupies
    if (ZERO_WIDTH.test(ch)) {
      orig += width;
      continue;
    }
    if (isWhitespace(ch)) {
      if (pendingSpaceOrigin < 0) pendingSpaceOrigin = orig;
      orig += width;
      continue;
    }
    // Flush a pending whitespace run as one space.
    if (pendingSpaceOrigin >= 0) {
      norm.push(" ");
      map.push(pendingSpaceOrigin);
      pendingSpaceOrigin = -1;
    }
    const folded = normChar(ch).normalize("NFKC");
    for (const f of folded) {
      norm.push(f);
      map.push(orig);
    }
    orig += width;
  }
  // A trailing whitespace run is intentionally not emitted (collapses to nothing).
  map.push(text.length);
  return { norm: norm.join(""), map };
}

/** Normalize a quote for matching (whitespace/unicode-folded and trimmed). */
export function normalizeQuote(quote: string): string {
  return buildNormalized(quote).norm.trim();
}

export type VerifyResult =
  | { ok: true; normalizedQuote: string }
  | { ok: false; reason: string };

/**
 * The core invariant check. Returns ok only if the (normalized) quote is a
 * substring of the (normalized) span text. No fuzzy matching, no repair.
 */
export function verifyQuote(spanText: string, quote: string): VerifyResult {
  const q = normalizeQuote(quote);
  if (q.length === 0) return { ok: false, reason: "empty quote" };
  if (q.length < 3) return { ok: false, reason: "quote too short to be a citation" };
  const { norm } = buildNormalized(spanText);
  if (norm.includes(q)) return { ok: true, normalizedQuote: q };
  return { ok: false, reason: "quote not found verbatim in span text" };
}

export interface QuoteLocation {
  start: number; // offset in the ORIGINAL span text
  end: number; // offset in the ORIGINAL span text (exclusive)
}

/**
 * Locate a verified quote's character offsets in the ORIGINAL span text, so the
 * UI can highlight the exact source substring. Returns null when the quote does
 * not verify. This is what powers the signature citation highlight.
 */
export function locateQuote(spanText: string, quote: string): QuoteLocation | null {
  const q = normalizeQuote(quote);
  if (q.length < 3) return null;
  const { norm, map } = buildNormalized(spanText);
  const at = norm.indexOf(q);
  if (at < 0) return null;
  const start = map[at]!;
  const end = map[at + q.length]!;
  return { start, end };
}

// ─── Guarded construction ────────────────────────────────────────────────────

export interface CriterionDraft {
  kind: CriterionKind;
  subject: string;
  requirementText: string;
  operator?: CriterionOperator | null;
  value?: string | null;
  unit?: string | null;
  evidence?: EvidenceFacet;
  verbatimQuote: string; // required in the draft too — Level 1 reaches the extractor
  confidence: number;
}

export interface CriterionMeta {
  id: string;
  extractedByModel: string;
  extractedAt: string;
}

export type Rejection = { rawModelOutput: string; rejectionReason: string; spanId: string };

export type ConstructResult<T> =
  | { ok: true; value: T }
  | { ok: false; rejection: Rejection };

/**
 * The ONLY sanctioned constructor for a Criterion. Verifies the quote against the
 * span and refuses to produce a Criterion otherwise — returning a Rejection that
 * the caller writes to RejectedExtraction. There is intentionally no code path
 * that yields a Criterion with an unverified quote.
 */
export function makeVerifiedCriterion(
  draft: CriterionDraft,
  span: DocumentSpan,
  meta: CriterionMeta,
): ConstructResult<Criterion> {
  const v = verifyQuote(span.text, draft.verbatimQuote);
  if (!v.ok) {
    return {
      ok: false,
      rejection: {
        spanId: span.id,
        rawModelOutput: JSON.stringify(draft),
        rejectionReason: v.reason,
      },
    };
  }
  const criterion: Criterion = {
    id: meta.id,
    policyDocumentId: span.policyDocumentId,
    kind: draft.kind,
    subject: draft.subject,
    requirementText: draft.requirementText,
    operator: draft.operator ?? null,
    value: draft.value ?? null,
    unit: draft.unit ?? null,
    evidence: draft.evidence ?? {},
    spanId: span.id,
    verbatimQuote: draft.verbatimQuote,
    confidence: draft.confidence,
    extractedByModel: meta.extractedByModel,
    extractedAt: meta.extractedAt,
  };
  return { ok: true, value: criterion };
}

export interface StanceDraft {
  stance: CoverageStance;
  codeId: string;
  verbatimQuote: string;
}

/** The ONLY sanctioned constructor for a CoverageStanceRecord (same invariant). */
export function makeVerifiedStance(
  draft: StanceDraft,
  span: DocumentSpan,
  meta: { id: string },
): ConstructResult<CoverageStanceRecord> {
  const v = verifyQuote(span.text, draft.verbatimQuote);
  if (!v.ok) {
    return {
      ok: false,
      rejection: {
        spanId: span.id,
        rawModelOutput: JSON.stringify(draft),
        rejectionReason: v.reason,
      },
    };
  }
  return {
    ok: true,
    value: {
      id: meta.id,
      policyDocumentId: span.policyDocumentId,
      codeId: draft.codeId,
      stance: draft.stance,
      spanId: span.id,
      verbatimQuote: draft.verbatimQuote,
    },
  };
}
