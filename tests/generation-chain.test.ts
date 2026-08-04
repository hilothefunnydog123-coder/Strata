/**
 * The generation chain, run end to end for the first time.
 *
 * Until now this had never executed. Classification, fact extraction,
 * retrieval, the gap check, drafting, verification, and persistence were each
 * written and typechecked, and the verifier was well tested on its own, but the
 * chain had never run as one thing against a database. BLOCKED.md entry 4 said
 * so plainly. This is that run.
 *
 * There is still no Anthropic API key in this environment, so the model
 * boundary is substituted. What is deliberately not substituted is anything
 * else: the corpus rows, the retrieval, the spans, the verifier, the discard on
 * failure, the persistence, and the letter assembly are all the shipping code
 * running against a real PostgreSQL database.
 *
 * The stand-in quotes only text it was actually shown, by slicing it out of the
 * prompt. That constraint is the point. A stand-in that returned invented
 * quotes would fail verification, so making it behave correctly proves the
 * plumbing carries source text intact from the database, through retrieval,
 * into the prompt, and back out to the verifier. The last test then does the
 * opposite deliberately, and the whole draft has to be thrown away.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

/* ─── The documents this case is built from ───────────────────────────────── */

const DENIAL_LETTER = `Meridian Health Plan
Notice of Denial of Medicare Coverage

Claim NRMC-2026-0417. We have completed our review of the skilled nursing
facility admission for dates of service March 2 through March 19.

Coverage is denied. Our clinical reviewers applied the Meridian Care Guidelines
and determined that the member no longer required a skilled level of care once
therapy participation plateaued.

You have the right to appeal this determination within sixty days.`;

const CLINICAL_RECORD = `Nursing assessment, hospital day 4.

The patient requires skilled wound care and IV antibiotic administration daily.
The sacral wound is assessed by a registered nurse each shift and the dressing
is changed twice daily under sterile technique.

Physical therapy is provided five days per week. The patient ambulates twenty
feet with a rolling walker and moderate assistance of one person.

Physician order dated March 3 directs daily skilled nursing assessment and
intravenous vancomycin.`;

const DECISION_TEXT = `A Medicare Advantage organization may not apply coverage criteria more restrictive than Traditional Medicare when determining whether a skilled nursing facility stay is covered. The record shows the organization substituted a proprietary screening tool for the regulatory standard.`;

/**
 * The operative passage, not a paraphrase of it. Retrieval scores a regulation
 * span on whether it contains the terms the denial is about, so a fixture that
 * says "coverage guidelines" where the regulation says "coverage criteria"
 * scores zero and never reaches a draft at all.
 */
const REGULATION_TEXT = `Each MA organization must comply with general coverage guidelines included in original Medicare manuals and instructions. When coverage criteria are not fully established, an MA organization may create publicly accessible internal coverage criteria that are based on current evidence in widely used treatment guidelines or clinical literature.`;

/* ─── The model boundary ──────────────────────────────────────────────────── */

/** Pull the numbered spans back out of a prompt built by classify or facts. */
function spansFromPrompt(user: string): { ordinal: number; text: string }[] {
  return [...user.matchAll(/--- span (\d+)[^\n]*---\n([\s\S]*?)(?=\n\n--- span |\s*$)/g)].map(
    ([, ordinal, text]) => ({ ordinal: Number(ordinal), text: text!.trim() }),
  );
}

/** The first span containing `phrase`, with a quote sliced out of it. */
function quoteFrom(
  spans: { ordinal: number; text: string }[],
  phrase: string,
  length = 90,
): { spanOrdinal: number; verbatimQuote: string } | null {
  for (const span of spans) {
    const at = span.text.indexOf(phrase);
    if (at === -1) continue;
    const slice = span.text.slice(at, at + length);
    const cut = slice.lastIndexOf(' ');
    return { spanOrdinal: span.ordinal, verbatimQuote: cut > 24 ? slice.slice(0, cut) : slice };
  }
  return null;
}

/**
 * Sources in a draft prompt arrive as "[id] ... Text:\n<passage>", grouped under
 * headings that all begin with AVAILABLE. Splitting on those headings keeps one
 * section's entries from running into the next, which is what went wrong the
 * first time and produced quotes spanning a section boundary.
 */
function sourcesFromDraftPrompt(user: string, heading: string): { id: string; text: string }[] {
  const chunk = user.split(/\n\n(?=AVAILABLE )/).find((part) => part.startsWith(heading));
  if (!chunk) return [];

  const body = chunk.slice(chunk.indexOf('\n\n') + 2);
  return [...body.matchAll(/\[([^\]]+)\][\s\S]*?Text:\n([\s\S]*?)(?=\n\n\[|$)/g)].map(
    ([, id, text]) => ({ id: id!, text: text!.trim() }),
  );
}

/**
 * When true the drafter invents a quote instead of copying one, so the discard
 * path can be exercised through the real generateAppeal rather than by calling
 * the verifier directly.
 */
let fabricateQuotes = false;

vi.mock('@/lib/llm/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/client')>();

  return {
    ...actual,
    complete: vi.fn(async (request: { stage: string; user: string; schema: { parse: (v: unknown) => unknown } }) => {
      const usage = { inputTokens: 900, outputTokens: 300, costCents: 1, latencyMs: 8 };

      // The real boundary parses every completion against the caller's Zod
      // schema before returning it. Without this the stand-in could return a
      // shape the shipping code would never actually receive, and the test
      // would prove nothing about the shipping code. It caught a missing field
      // on the first run.
      const checked = <T>(value: T): T => request.schema.parse(value) as T;

      if (request.stage === 'denial_classify') {
        const spans = spansFromPrompt(request.user);
        const basis = quoteFrom(spans, 'Our clinical reviewers applied');
        const proprietary = quoteFrom(spans, 'Meridian Care Guidelines');
        if (!basis) throw new Error('the denial letter never reached the classifier');

        return {
          value: checked({
            denialBasis: 'proprietary_criteria',
            spanOrdinal: basis.spanOrdinal,
            verbatimQuote: basis.verbatimQuote,
            statedReason:
              'The plan applied its own care guidelines and found no skilled level of care.',
            proprietaryCriteria: {
              detected: true,
              criteriaName: 'Meridian Care Guidelines',
              spanOrdinal: proprietary?.spanOrdinal ?? null,
              verbatimQuote: proprietary?.verbatimQuote ?? null,
              reasoning: 'The letter names a proprietary product as the standard applied.',
            },
            serviceType: 'skilled_nursing',
            criteriaCited: [
              'The member no longer required a skilled level of care once therapy participation plateaued',
            ],
          }),
          ...usage,
        };
      }

      if (request.stage === 'fact_extract') {
        const spans = spansFromPrompt(request.user);
        const skilled = quoteFrom(spans, 'The patient requires skilled wound care');
        const therapy = quoteFrom(spans, 'Physical therapy is provided');
        const order = quoteFrom(spans, 'Physician order dated March 3');

        return {
          value: checked({
            facts: [
              skilled && {
                ...skilled,
                factType: 'skilled_service',
                normalizedValue: 'Daily skilled wound care and IV antibiotics',
                supportsCriterion:
                  'The beneficiary required skilled nursing or skilled rehabilitation services on a daily basis',
              },
              therapy && {
                ...therapy,
                factType: 'therapy_intensity',
                normalizedValue: 'Physical therapy five days per week',
                supportsCriterion:
                  'The services required the skills of qualified technical or professional personnel',
              },
              order && {
                ...order,
                factType: 'physician_order',
                normalizedValue: 'Physician ordered daily skilled nursing assessment',
                supportsCriterion:
                  'The services were furnished pursuant to a physician order',
              },
            ].filter(Boolean),
          }),
          ...usage,
        };
      }

      if (request.stage === 'appeal_draft') {
        const holdings = sourcesFromDraftPrompt(
          request.user,
          'AVAILABLE HOLDINGS (sourceKind: holding)',
        );
        const regulations = sourcesFromDraftPrompt(
          request.user,
          'AVAILABLE REGULATION AND MANUAL PASSAGES (sourceKind: source_span)',
        );
        const facts = sourcesFromDraftPrompt(
          request.user,
          'AVAILABLE CLINICAL FACTS (sourceKind: clinical_fact)',
        );

        const clause = (text: string, length = 80): string => {
          const slice = text.slice(0, length);
          const cut = slice.lastIndexOf(' ');
          return cut > 24 ? slice.slice(0, cut) : slice;
        };

        const assertions: unknown[] = [];

        if (regulations[0]) {
          assertions.push({
            section: 'standard',
            kind: 'legal',
            text: 'A Medicare Advantage organisation must follow Medicare coverage guidelines.',
            sourceKind: 'source_span',
            sourceId: regulations[0].id,
            verbatimQuote: clause(regulations[0].text),
          });
        }

        if (holdings[0]) {
          assertions.push({
            section: 'argument',
            kind: 'legal',
            text: 'The plan may not apply criteria more restrictive than Traditional Medicare.',
            sourceKind: 'holding',
            sourceId: holdings[0].id,
            verbatimQuote: clause(holdings[0].text, 110),
          });
        }

        for (const fact of facts) {
          assertions.push({
            section: 'application',
            kind: 'clinical',
            text: 'The record documents a daily skilled need throughout the stay.',
            sourceKind: 'clinical_fact',
            sourceId: fact.id,
            verbatimQuote: clause(fact.text, 90),
          });
        }

        if (fabricateQuotes && assertions.length > 0) {
          // One invented quote among otherwise sound assertions. The rule is
          // that this discards the whole draft, not just this sentence, so the
          // corruption goes on the first one and the rest stay valid.
          (assertions[0] as { verbatimQuote: string }).verbatimQuote =
            'The reviewing authority expressly permits proprietary criteria in every case.';
        }

        return { value: checked({ assertions }), ...usage };
      }

      throw new Error(`No stand-in for stage ${request.stage}.`);
    }),
  };
});

const { generateAppeal, GenerationError, NoAuthorityError } = await import(
  '@/lib/appeals/generate'
);
const { groupIntoSections, renderPlainText } = await import('@/lib/appeals/render');
const { db } = await import('@/lib/db');
const schema = await import('@/lib/db/schema');
const { embed, holdingEmbeddingText } = await import('@/lib/corpus/embed');

const {
  appealDraft,
  assertion,
  clinicalFact,
  denial,
  denialDocument,
  denialSpan,
  holding,
  organization,
  sourceDocument,
  sourceSpan,
  user: userTable,
} = schema;

let denialId = '';
let userId = '';
let organizationId = '';

/** Split a document the way the real parser does, into paragraphs. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

async function seedCorpus(): Promise<void> {
  const [decisionDoc] = await db
    .insert(sourceDocument)
    .values({
      sourceType: 'dab_decision',
      citation: 'DAB No. 9001',
      title: 'Springfield Regional Medical Center',
      url: 'https://example.test/dab/9001',
      retrievedAt: new Date(),
      contentHash: 'a'.repeat(64),
      rawPath: 'corpus/dab-9001.html',
      parsedAt: new Date(),
      extractedAt: new Date(),
    })
    .returning({ id: sourceDocument.id });

  const [decisionSpan] = await db
    .insert(sourceSpan)
    .values({
      sourceDocumentId: decisionDoc!.id,
      ordinal: 1,
      page: null,
      charStart: 0,
      charEnd: DECISION_TEXT.length,
      text: DECISION_TEXT,
      headingPath: ['Analysis'],
    })
    .returning({ id: sourceSpan.id });

  await db.insert(holding).values({
    sourceDocumentId: decisionDoc!.id,
    spanId: decisionSpan!.id,
    verbatimQuote: DECISION_TEXT.slice(0, 120),
    issue: 'Whether the plan applied more restrictive criteria than Traditional Medicare.',
    ruleApplied: 'A plan may not apply criteria more restrictive than Traditional Medicare.',
    outcome: 'claimant_favorable',
    serviceType: 'skilled_nursing',
    payerType: 'medicare_advantage',
    denialBasis: 'proprietary_criteria',
    verifiedAt: new Date(),
    embedding: embed(
      holdingEmbeddingText({
        issue: 'Whether the plan applied more restrictive criteria than Traditional Medicare.',
        ruleApplied: 'A plan may not apply criteria more restrictive than Traditional Medicare.',
        verbatimQuote: DECISION_TEXT.slice(0, 120),
      }),
    ),
  });

  const [regulationDoc] = await db
    .insert(sourceDocument)
    .values({
      sourceType: 'regulation',
      // Exactly the citation the real eCFR source writes, because retrieval
      // matches controlling authority on this string. "42 CFR 422.101" is never
      // retrieved and the regulation would silently never reach a draft.
      citation: '42 CFR Part 422',
      title: 'Requirements relating to basic benefits',
      url: 'https://example.test/cfr/422.101',
      retrievedAt: new Date(),
      contentHash: 'b'.repeat(64),
      rawPath: 'corpus/cfr-422-101.xml',
      parsedAt: new Date(),
      extractedAt: new Date(),
    })
    .returning({ id: sourceDocument.id });

  await db.insert(sourceSpan).values({
    sourceDocumentId: regulationDoc!.id,
    ordinal: 1,
    page: null,
    charStart: 0,
    charEnd: REGULATION_TEXT.length,
    text: REGULATION_TEXT,
    headingPath: ['§ 422.101 Requirements relating to basic benefits'],
  });
}

async function seedCase(): Promise<void> {
  const [org] = await db
    .insert(organization)
    .values({
      // better-auth owns this table and supplies string ids, so there is no
      // database default to fall back on.
      id: `org-chain-test-${Date.now()}`,
      name: 'Northgate Regional Medical Center',
      slug: `northgate-${Date.now()}`,
      contingencyRateBps: 1500,
    })
    .returning({ id: organization.id });
  organizationId = org!.id;

  const [account] = await db
    .insert(userTable)
    .values({
      id: `chain-test-${Date.now()}`,
      name: 'Appeals Specialist',
      email: `specialist-${Date.now()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: userTable.id });
  userId = account!.id;

  const [record] = await db
    .insert(denial)
    .values({
      organizationId,
      internalRef: 'NRMC-2026-0417',
      payerName: 'Meridian Health Plan',
      planType: 'medicare_advantage',
      serviceType: 'skilled_nursing',
      claimAmountCents: 1_842_000,
      serviceDateFrom: new Date('2026-03-02'),
      serviceDateTo: new Date('2026-03-19'),
      status: 'ready_for_generation',
      isSynthetic: true,
      createdBy: userId,
    })
    .returning({ id: denial.id });
  denialId = record!.id;

  for (const [kind, text] of [
    ['denial_letter', DENIAL_LETTER],
    ['clinical_record', CLINICAL_RECORD],
  ] as const) {
    const [document] = await db
      .insert(denialDocument)
      .values({
        denialId,
        kind,
        r2Key: `denials/${denialId}/${kind}.txt`,
        filename: `${kind}.txt`,
        byteSize: text.length,
        contentHash: kind,
        parsedAt: new Date(),
        uploadedBy: userId,
      })
      .returning({ id: denialDocument.id });

    let cursor = 0;
    const spans = paragraphs(text).map((paragraph, index) => {
      const charStart = text.indexOf(paragraph, cursor);
      cursor = charStart + paragraph.length;
      return {
        denialDocumentId: document!.id,
        ordinal: index + 1,
        page: 1,
        charStart,
        charEnd: cursor,
        text: paragraph,
      };
    });

    await db.insert(denialSpan).values(spans);
  }
}

beforeAll(async () => {
  await db.delete(holding);
  await db.delete(sourceSpan);
  await db.delete(sourceDocument);
  await seedCorpus();
  await seedCase();
});

beforeEach(() => {
  fabricateQuotes = false;
});

afterAll(async () => {
  await db.delete(denial).where(eq(denial.id, denialId));
  await db.delete(userTable).where(eq(userTable.id, userId));
  await db.delete(organization).where(eq(organization.id, organizationId));
  await db.delete(holding);
  await db.delete(sourceSpan);
  await db.delete(sourceDocument);
});

describe('the whole chain, once', () => {
  it('classifies, extracts, retrieves, drafts, verifies, and persists', async () => {
    const result = await generateAppeal(denialId);

    expect(result.draftId).toBeTruthy();
    expect(result.version).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.assertionCount).toBeGreaterThanOrEqual(4);
    expect(result.proprietaryCriteriaDetected).toBe(true);
  }, 60_000);

  it('wrote the classification back onto the case', async () => {
    // Proves the classifier's output reached the record rather than being used
    // only in memory for the prompt.
    const [record] = await db.select().from(denial).where(eq(denial.id, denialId));
    expect(record!.denialBasis).toBe('proprietary_criteria');
    expect(record!.denialBasisText).toContain('care guidelines');
  });

  it('stored clinical facts, each traceable to a span of the record', async () => {
    const facts = await db
      .select()
      .from(clinicalFact)
      .where(eq(clinicalFact.denialId, denialId));

    expect(facts.length).toBe(3);

    for (const fact of facts) {
      const [span] = await db
        .select()
        .from(denialSpan)
        .where(eq(denialSpan.id, fact.spanId));
      // The stored quote has to be genuinely inside the span it names.
      expect(span!.text).toContain(fact.verbatimQuote);
    }
  });

  it('produced assertions of both kinds, each citing a matching source', async () => {
    const [draft] = await db
      .select()
      .from(appealDraft)
      .where(eq(appealDraft.denialId, denialId));

    const rows = await db
      .select()
      .from(assertion)
      .where(eq(assertion.appealDraftId, draft!.id));

    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.some((a) => a.kind === 'legal')).toBe(true);
    expect(rows.some((a) => a.kind === 'clinical')).toBe(true);

    // Both kinds of legal authority have to survive retrieval and reach the
    // draft. A regulation whose citation does not match what retrieval looks
    // for is dropped in silence, which is how this fixture was wrong at first.
    expect(rows.some((a) => a.sourceKind === 'holding')).toBe(true);
    expect(rows.some((a) => a.sourceKind === 'source_span')).toBe(true);

    // A clinical claim may only rest on the chart, a legal claim only on law.
    for (const row of rows) {
      if (row.kind === 'clinical') expect(row.sourceKind).toBe('clinical_fact');
      if (row.kind === 'legal') expect(['holding', 'source_span']).toContain(row.sourceKind);
    }
  });

  it('every stored assertion quote is really in the source it cites', async () => {
    // The invariant, checked from the database rather than from the pipeline's
    // own report of itself.
    const [draft] = await db
      .select()
      .from(appealDraft)
      .where(eq(appealDraft.denialId, denialId));

    const rows = await db
      .select()
      .from(assertion)
      .where(eq(assertion.appealDraftId, draft!.id));

    for (const row of rows) {
      let sourceText: string | null = null;

      if (row.sourceKind === 'clinical_fact') {
        const [fact] = await db
          .select({ text: clinicalFact.verbatimQuote })
          .from(clinicalFact)
          .where(eq(clinicalFact.id, row.sourceId));
        sourceText = fact?.text ?? null;
      } else if (row.sourceKind === 'holding') {
        const [row2] = await db
          .select({ text: sourceSpan.text })
          .from(holding)
          .innerJoin(sourceSpan, eq(holding.spanId, sourceSpan.id))
          .where(eq(holding.id, row.sourceId));
        sourceText = row2?.text ?? null;
      } else {
        const [span] = await db
          .select({ text: sourceSpan.text })
          .from(sourceSpan)
          .where(eq(sourceSpan.id, row.sourceId));
        sourceText = span?.text ?? null;
      }

      expect(sourceText, `source missing for assertion ${row.ordinal}`).not.toBeNull();
      expect(sourceText).toContain(row.verbatimQuote);
    }
  });

  it('assembles a letter with a body rather than an empty shell', async () => {
    // The bug this catches shipped once already: a draft holding assertions,
    // above a letter that rendered blank because the sections did not match the
    // fixed vocabulary.
    const [draft] = await db
      .select()
      .from(appealDraft)
      .where(eq(appealDraft.denialId, denialId));

    const rows = await db
      .select()
      .from(assertion)
      .where(eq(assertion.appealDraftId, draft!.id))
      .orderBy(assertion.ordinal);

    const sections = groupIntoSections(
      rows.map((a) => ({
        id: a.id,
        ordinal: a.ordinal,
        section: a.section,
        kind: a.kind,
        text: a.text,
        sourceKind: a.sourceKind,
        sourceId: a.sourceId,
        verbatimQuote: a.verbatimQuote,
      })),
    );

    // Every assertion has to land in a section the letter actually renders. A
    // section name outside the fixed vocabulary is silently dropped here, which
    // is how a letter once shipped showing "6 assertions" above a blank body.
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.reduce((n, s) => n + s.assertions.length, 0)).toBe(rows.length);

    const letter = renderPlainText({
      header: {
        organizationName: 'Northgate Regional Medical Center',
        payerName: 'Meridian Health Plan',
        internalRef: 'NRMC-2026-0417',
        serviceType: 'skilled nursing',
        serviceDates: '2 March 2026 to 19 March 2026',
        claimAmount: '$18,420.00',
        appealDeadline: null,
        today: '4 August 2026',
      },
      sections,
      citations: [],
    });

    expect(letter.length).toBeGreaterThan(200);
    expect(letter).toContain('Meridian Health Plan');
    expect(letter).toContain('NRMC-2026-0417');
  });

});

describe('when the model invents a quote', () => {
  it('throws the whole draft away rather than keeping the good parts', async () => {
    fabricateQuotes = true;

    const before = await db
      .select()
      .from(appealDraft)
      .where(eq(appealDraft.denialId, denialId));

    await expect(generateAppeal(denialId)).rejects.toBeInstanceOf(GenerationError);

    // Three attempts, all discarded, and not one partial draft left behind.
    const after = await db
      .select()
      .from(appealDraft)
      .where(eq(appealDraft.denialId, denialId));
    expect(after.length).toBe(before.length);
  }, 60_000);

  it('names the assertion that failed, so a person can act on it', async () => {
    fabricateQuotes = true;
    try {
      await generateAppeal(denialId);
      expect.unreachable('a fabricated quote must not produce a draft');
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationError);
      const failures = (error as InstanceType<typeof GenerationError>).lastFailures;
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.join(' ')).toMatch(/quote|source/i);
    }
  }, 60_000);
});

describe('when the corpus has nothing to argue from', () => {
  it('refuses to write a letter with no law behind it', async () => {
    await db.delete(holding);
    await db.delete(sourceSpan);

    // The dangerous case: every clinical quote would still be real, so the
    // letter would pass verification and say nothing the payer does not know.
    await expect(generateAppeal(denialId)).rejects.toBeInstanceOf(NoAuthorityError);
  }, 60_000);

  it('says it is a corpus problem rather than a model problem', async () => {
    try {
      await generateAppeal(denialId);
      expect.unreachable('generation must refuse with an empty corpus');
    } catch (error) {
      expect((error as Error).message).toContain('Ingest the corpus');
    }
  }, 60_000);
});
