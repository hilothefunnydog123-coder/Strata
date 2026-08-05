/**
 * A fabricated decision, quoted perfectly, is still fabricated.
 *
 * The corpus in production held five documents and exactly two holdings, and
 * both of those holdings came from DEMO-DAB-0001 and DEMO-DAB-0002: decisions
 * written for the demonstration, hosted at example.invalid, put there by the
 * seeder that runs as part of deployment. Retrieval had no filter. Any appeal
 * generated for any hospital could have cited them, and the citation would have
 * been offered to a reviewer as authority with a working click through to its
 * source panel.
 *
 * Verification cannot catch this and never could. It proves a quote appears in
 * the passage it cites, and for a seeded document it does, because the seeder
 * slices its quotes out of its own text. Every layer of the citation invariant
 * passed on data that was invented. What was missing was any record of how a
 * document got into the database, which is a different question from whether it
 * is internally consistent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { holding, sourceDocument, sourceSpan } from '@/lib/db/schema';
import { retrieveAuthority } from '@/lib/corpus/retrieve';

/** Text long enough to span and quote, in the shape a decision uses. */
const DECISION_TEXT =
  'The Board concludes that a Medicare Advantage organization may not apply ' +
  'coverage criteria more restrictive than those of Traditional Medicare when ' +
  'determining whether a skilled nursing facility stay is covered under the plan.';

const QUOTE = 'may not apply coverage criteria more restrictive than those of Traditional Medicare';

async function seed(citation: string, provenance: 'crawled' | 'demo', url: string) {
  const [document] = await db
    .insert(sourceDocument)
    .values({
      sourceType: 'dab_decision',
      citation,
      title: citation,
      url,
      retrievedAt: new Date(),
      contentHash: `${citation}-hash`.padEnd(64, '0').slice(0, 64),
      rawPath: `test/${citation}`,
      parsedAt: new Date(),
      extractedAt: new Date(),
      provenance,
    })
    .returning();

  const [span] = await db
    .insert(sourceSpan)
    .values({
      sourceDocumentId: document!.id,
      ordinal: 1,
      page: 1,
      charStart: 0,
      charEnd: DECISION_TEXT.length,
      text: DECISION_TEXT,
      headingPath: [],
    })
    .returning();

  await db.insert(holding).values({
    sourceDocumentId: document!.id,
    spanId: span!.id,
    // Sliced out of the text above, so it verifies exactly as the real thing
    // would. That is the whole difficulty: this record is internally perfect.
    verbatimQuote: QUOTE,
    issue: 'Whether a plan may apply more restrictive criteria than Traditional Medicare.',
    ruleApplied: 'A plan may not apply criteria more restrictive than Traditional Medicare.',
    outcome: 'claimant_favorable',
    serviceType: 'skilled_nursing',
    payerType: 'medicare_advantage',
    denialBasis: 'proprietary_criteria',
    verifiedAt: new Date(),
    embedding: null,
  });

  return document!.id;
}

let crawledId = '';
let demoId = '';

beforeAll(async () => {
  await db.delete(holding);
  await db.delete(sourceSpan);
  await db.delete(sourceDocument);

  crawledId = await seed('DAB No. 9100', 'crawled', 'https://www.hhs.gov/dab/decisions/9100.html');
  demoId = await seed('DEMO-DAB-0001', 'demo', 'https://example.invalid/demo/decision-0001');
});

afterAll(async () => {
  await db.delete(holding);
  await db.delete(sourceSpan);
  await db.delete(sourceDocument);
});

describe('what retrieval will offer a real appeal', () => {
  const query = {
    text: 'skilled nursing facility coverage criteria more restrictive than Traditional Medicare',
    serviceType: 'skilled_nursing' as const,
    payerType: 'medicare_advantage' as const,
    denialBasis: 'proprietary_criteria' as const,
  };

  it('offers the crawled decision', async () => {
    // The control. If this fails the test proves nothing about the exclusion
    // below, because an empty result would satisfy it either way.
    const results = await retrieveAuthority({ ...query, limit: 20 });

    expect(results.map((r) => r.citation)).toContain('DAB No. 9100');
  });

  it('never offers the seeded one, though it matches every facet', async () => {
    // Same service type, same payer type, same denial basis, same words, same
    // quote. Nothing about the content distinguishes them. Only the record of
    // where the document came from does.
    const results = await retrieveAuthority({ ...query, limit: 20 });

    expect(results.map((r) => r.citation)).not.toContain('DEMO-DAB-0001');
    expect(results.every((r) => !r.url.includes('example.invalid'))).toBe(true);
  });

  it('the seeded holding is verified, so verification was never going to stop it', async () => {
    // Stated as a test because it is the part that is easy to assume away. The
    // demonstration data is not malformed or half written: it passes every
    // check the product applies to a citation, and it is still not authority.
    const rows = await db
      .select()
      .from(holding)
      .where(eq(holding.sourceDocumentId, demoId));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.verifiedAt).not.toBeNull();
    expect(DECISION_TEXT).toContain(rows[0]!.verbatimQuote);
  });

  it('defaults a document to crawled, so only the seeder has to say otherwise', async () => {
    // The fetch stage writes no provenance. If the default were demo, real
    // ingestion would silently produce a corpus nothing could cite, which fails
    // in the safe direction but fails all the same.
    const [row] = await db.select().from(sourceDocument).where(eq(sourceDocument.id, crawledId));

    expect(row!.provenance).toBe('crawled');
  });
});
