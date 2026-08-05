/**
 * A rule nobody labelled is still the rule.
 *
 * Retrieval narrows before it scores, and it narrowed on facet equality: same
 * denial basis, same payer type, same service type, or tagged proprietary
 * criteria. That was safe while every holding came from a DAB decision, which
 * states all three because it decides a case about them.
 *
 * A manual chapter decides nothing. It states the rule a decision would apply
 * and leaves every facet null, and SQL null is not equal to anything, including
 * the value being searched for. So no holding drawn from a manual could pass
 * the narrowing, ever, whatever the query.
 *
 * That was not theoretical. The corpus held 39 verified holdings out of four
 * CMS manual chapters, each with a quote checked character for character
 * against its source PDF, each embedded, and retrieveAuthority returned zero
 * for every query that could be put to it. Generation then refused to draft for
 * want of authority it was holding the entire time.
 *
 * Scoring was never the problem and needs no change: a holding with no facets
 * collects none of the structured weights and ranks on similarity, which is the
 * right treatment for a rule statement. The bug was in deciding what was
 * allowed to be scored at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { holding, sourceDocument, sourceSpan } from '@/lib/db/schema';
import { retrieveAuthority } from '@/lib/corpus/retrieve';

/** The shape a Benefit Policy Manual passage has: a rule, no case. */
const MANUAL_TEXT =
  'Skilled nursing care must be needed and provided on a daily basis, and as a ' +
  'practical matter can only be provided in a skilled nursing facility on an ' +
  'inpatient basis, for the stay to be covered.';

/** The shape a decision has: a case, decided, with every facet stated. */
const DECISION_TEXT =
  'The Board concludes that the plan applied criteria more restrictive than ' +
  'Traditional Medicare in denying the skilled nursing facility stay at issue.';

async function seedManualRule(citation: string, text: string, quote: string) {
  const [document] = await db
    .insert(sourceDocument)
    .values({
      sourceType: 'manual',
      citation,
      title: citation,
      url: `https://www.cms.gov/${citation.replace(/\W+/g, '-')}.pdf`,
      retrievedAt: new Date(),
      contentHash: `${citation}-hash`.padEnd(64, '0').slice(0, 64),
      rawPath: `test/${citation}`,
      parsedAt: new Date(),
      extractedAt: new Date(),
      provenance: 'crawled',
    })
    .returning();

  const [span] = await db
    .insert(sourceSpan)
    .values({
      sourceDocumentId: document!.id,
      ordinal: 1,
      page: 1,
      charStart: 0,
      charEnd: text.length,
      text,
      headingPath: ['Level of care requirement'],
    })
    .returning();

  await db.insert(holding).values({
    sourceDocumentId: document!.id,
    spanId: span!.id,
    verbatimQuote: quote,
    issue: 'Whether daily skilled nursing care was required.',
    ruleApplied: 'Skilled care must be needed on a daily basis for the stay to be covered.',
    // Every one of these null, which is the honest answer for a manual and the
    // exact condition that made the holding invisible.
    outcome: null,
    serviceType: null,
    payerType: null,
    denialBasis: null,
    verifiedAt: new Date(),
    embedding: null,
  });

  return document!.id;
}

async function seedDecision(citation: string) {
  const [document] = await db
    .insert(sourceDocument)
    .values({
      sourceType: 'dab_decision',
      citation,
      title: citation,
      url: `https://www.hhs.gov/dab/decisions/${citation.replace(/\W+/g, '')}.html`,
      retrievedAt: new Date(),
      contentHash: `${citation}-dec`.padEnd(64, '0').slice(0, 64),
      rawPath: `test/${citation}`,
      parsedAt: new Date(),
      extractedAt: new Date(),
      provenance: 'crawled',
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
    verbatimQuote: 'the plan applied criteria more restrictive than Traditional Medicare',
    issue: 'Whether the plan applied more restrictive criteria.',
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

beforeAll(async () => {
  await db.delete(holding);
  await db.delete(sourceSpan);
  await db.delete(sourceDocument);

  await seedManualRule(
    'Medicare Benefit Policy Manual, Ch. 8',
    MANUAL_TEXT,
    'Skilled nursing care must be needed and provided on a daily basis',
  );
  await seedDecision('DAB No. 9200');
});

afterAll(async () => {
  await db.delete(holding);
  await db.delete(sourceSpan);
  await db.delete(sourceDocument);
});

describe('a holding out of a manual, which labels nothing', () => {
  const query = {
    text: 'the beneficiary did not require daily skilled nursing care',
    serviceType: 'skilled_nursing' as const,
    payerType: 'medicare_advantage' as const,
    denialBasis: 'medical_necessity' as const,
  };

  it('is offered to an appeal at all', async () => {
    // The whole point. Zero here means a verified, embedded, citable corpus
    // that no appeal can reach, which is what the corpus actually was.
    const results = await retrieveAuthority({ ...query, limit: 20 });

    expect(results.map((r) => r.citation)).toContain('Medicare Benefit Policy Manual, Ch. 8');
  });

  it('is offered even when the query shares no facet with anything', async () => {
    // A denial whose basis and service match nothing in the corpus still has to
    // reach the rules. Under facet equality this returned nothing at all.
    const results = await retrieveAuthority({
      text: 'the stay was not covered',
      serviceType: 'dme',
      payerType: 'commercial',
      denialBasis: 'administrative',
      limit: 20,
    });

    expect(results.map((r) => r.citation)).toContain('Medicare Benefit Policy Manual, Ch. 8');
  });

  it('says why it is in the list, since no facet can explain it', async () => {
    // These reasons are shown to the specialist and the legal reviewer. A row
    // arriving with an empty explanation is worse than useless in front of
    // someone deciding whether to sign the letter.
    const results = await retrieveAuthority({ ...query, limit: 20 });
    const manual = results.find((r) => r.citation === 'Medicare Benefit Policy Manual, Ch. 8');

    expect(manual!.reasons.length).toBeGreaterThan(0);
    expect(manual!.reasons.join(' ')).toMatch(/states a rule rather than deciding a case/);
  });

  it('does not claim a facet match it does not have', async () => {
    const results = await retrieveAuthority({ ...query, limit: 20 });
    const manual = results.find((r) => r.citation === 'Medicare Benefit Policy Manual, Ch. 8');

    expect(manual!.reasons.join(' ')).not.toMatch(/same (denial basis|payer type|service type)/);
    expect(manual!.serviceType).toBeNull();
    expect(manual!.denialBasis).toBeNull();
  });
});

describe('what including the rules did not cost', () => {
  it('still ranks a decision that matches on the facts above a bare rule', async () => {
    // Widening the net must not flatten the ranking. A decision matching payer
    // type and service type, that the claimant won, is stronger authority for
    // this denial than a manual provision that matches nothing, and it has to
    // come out on top.
    const results = await retrieveAuthority({
      text: 'the plan applied criteria more restrictive than Traditional Medicare',
      serviceType: 'skilled_nursing',
      payerType: 'medicare_advantage',
      denialBasis: 'proprietary_criteria',
      limit: 20,
    });

    expect(results[0]!.citation).toBe('DAB No. 9200');
    expect(results[0]!.score).toBeGreaterThan(
      results.find((r) => r.citation === 'Medicare Benefit Policy Manual, Ch. 8')!.score,
    );
  });

  it('still refuses anything the demonstration seeder wrote', async () => {
    // The rules clause must not become a way back in for seeded documents,
    // whose holdings would also be null if someone wrote them that way. The
    // provenance filter is separate and still absolute.
    const [document] = await db
      .insert(sourceDocument)
      .values({
        sourceType: 'manual',
        citation: 'DEMO-MANUAL-0001',
        title: 'Seeded manual',
        url: 'https://example.invalid/demo/manual-0001',
        retrievedAt: new Date(),
        contentHash: 'demo-manual-hash'.padEnd(64, '0').slice(0, 64),
        rawPath: 'test/demo-manual',
        parsedAt: new Date(),
        extractedAt: new Date(),
        provenance: 'demo',
      })
      .returning();

    const [span] = await db
      .insert(sourceSpan)
      .values({
        sourceDocumentId: document!.id,
        ordinal: 1,
        page: 1,
        charStart: 0,
        charEnd: MANUAL_TEXT.length,
        text: MANUAL_TEXT,
        headingPath: [],
      })
      .returning();

    await db.insert(holding).values({
      sourceDocumentId: document!.id,
      spanId: span!.id,
      verbatimQuote: 'Skilled nursing care must be needed and provided on a daily basis',
      issue: 'Whether daily skilled care was required.',
      ruleApplied: 'Skilled care must be needed on a daily basis.',
      outcome: null,
      serviceType: null,
      payerType: null,
      denialBasis: null,
      verifiedAt: new Date(),
      embedding: null,
    });

    const results = await retrieveAuthority({
      text: 'the beneficiary did not require daily skilled nursing care',
      serviceType: 'skilled_nursing',
      payerType: 'medicare_advantage',
      denialBasis: 'medical_necessity',
      limit: 20,
    });

    expect(results.map((r) => r.citation)).not.toContain('DEMO-MANUAL-0001');
  });
});
