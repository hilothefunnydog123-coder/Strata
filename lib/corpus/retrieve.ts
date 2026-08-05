/**
 * Finding the authority that decides a case like this one.
 *
 * Three signals, combined deliberately rather than blended into one opaque
 * score:
 *
 *   1. Structured match. Same service type, same payer type, same denial basis.
 *      These are the facts an adjudicator would use to decide whether a prior
 *      decision is on point, so they carry the most weight.
 *   2. Outcome. A holding where the claimant lost is not useless, but it is not
 *      what we are looking for, so it is scored down rather than filtered out:
 *      knowing the strongest contrary authority matters to a legal reviewer.
 *   3. Similarity. Lexical overlap between the denial's own language and the
 *      holding, which catches the cases the structured columns miss.
 *
 * On the choice not to hard filter by service type: the strongest argument in
 * this domain, that 42 CFR 422.101(b) forbids a Medicare Advantage plan from
 * applying criteria more restrictive than Traditional Medicare, does not depend
 * on the prior decision having involved skilled nursing. A holding that a plan
 * may not substitute proprietary criteria is authority for that proposition
 * whatever service it arose from. Filtering it out because the service differs
 * would discard the best authority we have. See CORPUS.md section 1.
 */
import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { holding, sourceDocument, sourceSpan } from '@/lib/db/schema';
import { cosine, embed } from './embed';

export interface RetrievalQuery {
  serviceType: string | null;
  payerType: string | null;
  denialBasis: string | null;
  /** The denial's own language, used for the similarity signal. */
  text: string;
  limit?: number;
}

export interface RetrievedHolding {
  holdingId: string;
  spanId: string;
  sourceDocumentId: string;
  citation: string;
  title: string;
  url: string;
  decidedAt: Date | null;
  sourceType: string;
  issue: string;
  ruleApplied: string;
  verbatimQuote: string;
  outcome: string;
  serviceType: string | null;
  payerType: string | null;
  denialBasis: string | null;
  spanText: string;
  score: number;
  /** Why this was retrieved, shown to the specialist and the legal reviewer. */
  reasons: string[];
}

const WEIGHTS = {
  denialBasis: 3.0,
  payerType: 2.0,
  serviceType: 1.5,
  claimantFavorable: 1.0,
  planFavorable: -0.75,
  similarity: 2.5,
} as const;

/**
 * Retrieve and rank.
 *
 * Only verified holdings are candidates. A holding whose quote has not been
 * checked against its source has no business being available to cite, which is
 * the same rule the pipeline applies when it deletes the ones that fail.
 */
export async function retrieveAuthority(
  query: RetrievalQuery,
): Promise<RetrievedHolding[]> {
  const limit = query.limit ?? 12;

  // Narrow first. Anything matching at least one structured facet, plus every
  // proprietary criteria holding regardless of facet, because that argument
  // travels across service types.
  const facets = [
    query.denialBasis
      ? eq(holding.denialBasis, query.denialBasis as 'medical_necessity')
      : undefined,
    query.payerType
      ? eq(holding.payerType, query.payerType as 'medicare_advantage')
      : undefined,
    query.serviceType
      ? eq(holding.serviceType, query.serviceType as 'skilled_nursing')
      : undefined,
    eq(holding.denialBasis, 'proprietary_criteria'),
  ].filter(Boolean);

  const rows = await db
    .select({
      holdingId: holding.id,
      spanId: holding.spanId,
      sourceDocumentId: holding.sourceDocumentId,
      issue: holding.issue,
      ruleApplied: holding.ruleApplied,
      verbatimQuote: holding.verbatimQuote,
      outcome: holding.outcome,
      serviceType: holding.serviceType,
      payerType: holding.payerType,
      denialBasis: holding.denialBasis,
      embedding: holding.embedding,
      citation: sourceDocument.citation,
      title: sourceDocument.title,
      url: sourceDocument.url,
      decidedAt: sourceDocument.decidedAt,
      sourceType: sourceDocument.sourceType,
      spanText: sourceSpan.text,
    })
    .from(holding)
    .innerJoin(sourceDocument, eq(holding.sourceDocumentId, sourceDocument.id))
    .innerJoin(sourceSpan, eq(holding.spanId, sourceSpan.id))
    .where(
      and(
        isNotNull(holding.verifiedAt),
        // Nothing the demonstration seeder wrote may be offered to a real
        // appeal, whatever it says about itself.
        //
        // This is not belt and braces on top of verification, it is the only
        // thing standing here. Verification proves a quote appears in the
        // passage it cites, and for seeded documents it does, because the
        // seeder slices its quotes out of its own text. A fabricated decision
        // quoted accurately is still fabricated, and DEMO-DAB-0001 was for a
        // while the only authority this corpus held.
        eq(sourceDocument.provenance, 'crawled'),
        facets.length > 0 ? or(...facets) : sql`true`,
      ),
    )
    // A bound, so a pathological corpus cannot pull the whole table into memory.
    .limit(2000);

  const queryVector = embed(query.text);

  const scored: RetrievedHolding[] = rows.map((row) => {
    let score = 0;
    const reasons: string[] = [];

    if (query.denialBasis && row.denialBasis === query.denialBasis) {
      score += WEIGHTS.denialBasis;
      reasons.push(`same denial basis: ${row.denialBasis.replace(/_/g, ' ')}`);
    }
    if (query.payerType && row.payerType === query.payerType) {
      score += WEIGHTS.payerType;
      reasons.push(`same payer type: ${row.payerType.replace(/_/g, ' ')}`);
    }
    if (query.serviceType && row.serviceType === query.serviceType) {
      score += WEIGHTS.serviceType;
      reasons.push(`same service type: ${row.serviceType.replace(/_/g, ' ')}`);
    }

    if (row.outcome === 'claimant_favorable') {
      score += WEIGHTS.claimantFavorable;
      reasons.push('the appellant prevailed');
    } else if (row.outcome === 'plan_favorable') {
      score += WEIGHTS.planFavorable;
      reasons.push('the plan prevailed, so this is contrary authority');
    }

    if (
      row.denialBasis === 'proprietary_criteria' &&
      query.denialBasis !== 'proprietary_criteria'
    ) {
      // Kept in the set, scored on merit, and labelled so nobody wonders why a
      // decision about a different service is in the list.
      reasons.push('addresses proprietary criteria, which travels across service types');
    }

    const similarity = row.embedding ? cosine(queryVector, row.embedding) : 0;
    score += similarity * WEIGHTS.similarity;
    if (similarity > 0.2) reasons.push('language closely matches the denial');

    return {
      holdingId: row.holdingId,
      spanId: row.spanId,
      sourceDocumentId: row.sourceDocumentId,
      citation: row.citation,
      title: row.title,
      url: row.url,
      decidedAt: row.decidedAt,
      sourceType: row.sourceType,
      issue: row.issue,
      ruleApplied: row.ruleApplied,
      verbatimQuote: row.verbatimQuote,
      outcome: row.outcome,
      serviceType: row.serviceType,
      payerType: row.payerType,
      denialBasis: row.denialBasis,
      spanText: row.spanText,
      score,
      reasons,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * The controlling regulation and manual sections for a service type.
 *
 * Distinct from holdings: these are the rules themselves rather than a decision
 * applying them, and an appeal cites both. Retrieved by citation rather than by
 * similarity, because which regulation governs skilled nursing coverage is a
 * fact, not a search result.
 */
const CONTROLLING_AUTHORITY: Record<string, string[]> = {
  skilled_nursing: ['42 CFR Part 409', '42 CFR Part 422', 'Medicare Benefit Policy Manual, Ch. 8'],
  inpatient_rehab: ['42 CFR Part 412', '42 CFR Part 422', 'Medicare Benefit Policy Manual, Ch. 1'],
  home_health: ['42 CFR Part 409', '42 CFR Part 422'],
  long_term_care_hospital: ['42 CFR Part 412', '42 CFR Part 422'],
  inpatient_acute: ['42 CFR Part 412', '42 CFR Part 422'],
  outpatient: ['42 CFR Part 422'],
  dme: ['42 CFR Part 422'],
  other: ['42 CFR Part 422'],
};

export interface ControllingSpan {
  spanId: string;
  sourceDocumentId: string;
  citation: string;
  title: string;
  url: string;
  page: number | null;
  headingPath: string[];
  text: string;
}

export async function retrieveControllingAuthority(
  serviceType: string,
  terms: readonly string[],
  limit = 10,
): Promise<ControllingSpan[]> {
  const citations = CONTROLLING_AUTHORITY[serviceType] ?? CONTROLLING_AUTHORITY.other!;

  const rows = await db
    .select({
      spanId: sourceSpan.id,
      sourceDocumentId: sourceDocument.id,
      citation: sourceDocument.citation,
      title: sourceDocument.title,
      url: sourceDocument.url,
      page: sourceSpan.page,
      headingPath: sourceSpan.headingPath,
      text: sourceSpan.text,
    })
    .from(sourceSpan)
    .innerJoin(sourceDocument, eq(sourceSpan.sourceDocumentId, sourceDocument.id))
    .where(
      or(...citations.map((citation) => eq(sourceDocument.citation, citation))),
    )
    .limit(5000);

  if (terms.length === 0) return rows.slice(0, limit);

  const needles = terms.map((t) => t.toLowerCase());

  const scored = rows
    .map((row) => {
      const haystack = `${row.headingPath.join(' ')} ${row.text}`.toLowerCase();
      const hits = needles.filter((needle) => haystack.includes(needle)).length;
      return { row, hits };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  return scored.slice(0, limit).map((s) => s.row);
}
