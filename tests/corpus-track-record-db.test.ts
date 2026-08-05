/**
 * The loop, closed, through the database that actually holds it.
 *
 * The arithmetic is covered separately. What this checks is the join: that an
 * outcome recorded against a denial reaches the holdings the letter cited, and
 * that it reaches only those.
 *
 * The rule worth stating is which citations count. A superseded draft is one a
 * reviewer replaced before the letter left the building, so the holdings it
 * cited were never put to a payer. Crediting them with the outcome would be
 * counting an argument nobody made, and it would quietly reward whatever the
 * first draft happened to reach for.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  appealDraft,
  assertion,
  denial,
  holding,
  organization,
  outcome,
  sourceDocument,
  sourceSpan,
  user,
} from '@/lib/db/schema';
import { trackRecords } from '@/lib/corpus/track-record';

const SPAN_TEXT =
  'Skilled nursing care must be needed and provided on a daily basis for the ' +
  'stay to be covered under the extended care benefit.';

let winner = '';
let loser = '';
let neverCited = '';
let supersededOnly = '';
let orgId = '';
let userId = '';

async function makeHolding(citation: string): Promise<string> {
  const [document] = await db
    .insert(sourceDocument)
    .values({
      sourceType: 'manual',
      citation,
      title: citation,
      url: `https://www.cms.gov/${citation}.pdf`,
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
      charEnd: SPAN_TEXT.length,
      text: SPAN_TEXT,
      headingPath: [],
    })
    .returning();

  const [row] = await db
    .insert(holding)
    .values({
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
    })
    .returning();

  return row!.id;
}

/**
 * One decided appeal: a denial, a draft citing the given holdings, an outcome.
 */
async function decidedAppeal(options: {
  ref: string;
  cites: string[];
  result: 'won' | 'lost' | 'partial' | 'withdrawn';
  draftStatus?: 'ready' | 'superseded';
}) {
  const [record] = await db
    .insert(denial)
    .values({
      organizationId: orgId,
      internalRef: options.ref,
      payerName: 'Test Plan',
      planType: 'medicare_advantage',
      serviceType: 'skilled_nursing',
      claimAmountCents: 100_000,
      isSynthetic: true,
      createdBy: userId,
      status: 'decided',
    })
    .returning();

  const [draft] = await db
    .insert(appealDraft)
    .values({
      denialId: record!.id,
      version: 1,
      bodyJson: '{}',
      status: options.draftStatus ?? 'ready',
      generatedByModel: 'test',
    })
    .returning();

  let ordinal = 0;
  for (const holdingId of options.cites) {
    ordinal += 1;
    await db.insert(assertion).values({
      appealDraftId: draft!.id,
      ordinal,
      section: 'argument',
      kind: 'legal',
      text: 'Daily skilled care was required.',
      sourceKind: 'holding',
      sourceId: holdingId,
      verbatimQuote: 'Skilled nursing care must be needed and provided on a daily basis',
    });
  }

  await db.insert(outcome).values({
    denialId: record!.id,
    result: options.result,
    decidedAt: new Date(),
    amountRecoveredCents: options.result === 'won' ? 100_000 : 0,
    recordedBy: userId,
  });
}

beforeAll(async () => {
  await db.delete(holding);
  await db.delete(sourceSpan);
  await db.delete(sourceDocument);
  await db.delete(denial);
  await db.delete(organization);

  const [org] = await db
    .insert(organization)
    .values({ id: 'org-track', name: 'Track Hospital', slug: 'track-hospital' })
    .returning();
  orgId = org!.id;

  const [operator] = await db
    .insert(user)
    .values({
      id: 'user-track',
      name: 'Operator',
      email: 'track@example.test',
      emailVerified: true,
    })
    .returning();
  userId = operator!.id;

  winner = await makeHolding('WIN-CH-1');
  loser = await makeHolding('LOSE-CH-1');
  neverCited = await makeHolding('UNUSED-CH-1');
  supersededOnly = await makeHolding('SUPERSEDED-CH-1');

  await decidedAppeal({ ref: 'A-1', cites: [winner], result: 'won' });
  await decidedAppeal({ ref: 'A-2', cites: [winner], result: 'won' });
  await decidedAppeal({ ref: 'A-3', cites: [winner], result: 'partial' });
  await decidedAppeal({ ref: 'B-1', cites: [loser], result: 'lost' });
  await decidedAppeal({ ref: 'B-2', cites: [loser], result: 'lost' });
  await decidedAppeal({ ref: 'C-1', cites: [winner], result: 'withdrawn' });
  await decidedAppeal({
    ref: 'D-1',
    cites: [supersededOnly],
    result: 'won',
    draftStatus: 'superseded',
  });
});

afterAll(async () => {
  await db.delete(holding);
  await db.delete(sourceSpan);
  await db.delete(sourceDocument);
  await db.delete(denial);
  await db.delete(organization);
  await db.delete(user);
});

describe('an outcome reaching the holdings the letter cited', () => {
  it('credits a holding for the appeals it was argued in', async () => {
    const records = await trackRecords([winner, loser, neverCited, supersededOnly]);
    const record = records.byHolding.get(winner)!;

    // Two wins and a partial. The withdrawn appeal is not counted at all.
    expect(record.decided).toBe(3);
    expect(record.credit).toBe(2.5);
  });

  it('records a losing argument as decided but uncredited', async () => {
    const records = await trackRecords([winner, loser]);
    const record = records.byHolding.get(loser)!;

    expect(record.decided).toBe(2);
    expect(record.credit).toBe(0);
  });

  it('leaves a holding nobody cited out of the map entirely', async () => {
    // Absent rather than zeroed, so the signal can tell "never tried" apart
    // from "tried and never worked". Those deserve opposite treatment.
    const records = await trackRecords([winner, neverCited]);

    expect(records.byHolding.has(neverCited)).toBe(false);
  });

  it('ignores a draft that was superseded before anyone sent it', async () => {
    // The holding was cited, the appeal was won, and the letter carrying that
    // citation was replaced before it left the building. Crediting it would be
    // counting an argument nobody made.
    const records = await trackRecords([supersededOnly]);

    expect(records.byHolding.has(supersededOnly)).toBe(false);
  });

  it('excludes withdrawn appeals from the corpus base rate too', async () => {
    // Five counted appeals: three on the winner worth 2.5, two on the loser
    // worth 0. Were the withdrawn one counted as a loss the rate would be 5/12.
    const records = await trackRecords([winner, loser]);

    expect(records.baseRate).toBeCloseTo(2.5 / 5, 5);
  });

  it('returns an empty record set rather than querying for nothing', async () => {
    const records = await trackRecords([]);

    expect(records.byHolding.size).toBe(0);
    expect(records.baseRate).toBe(0);
  });
});
