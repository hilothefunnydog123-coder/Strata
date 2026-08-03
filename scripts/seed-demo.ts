/**
 * Fill a fresh deployment with a working demonstration.
 *
 * The point of this script is to make the product usable and showable without
 * waiting on a populated corpus or a model key. Everything it writes is
 * synthetic, and it says so: the hospital, the patients, the payer and the two
 * appeal decisions are all invented, and every denial is tagged synthetic, so
 * the same upload rules that protect real records apply to this data too.
 *
 * What is not faked is the verification. Every assertion this script writes is
 * checked with the real `verifyQuote` before it reaches the database, against
 * the real source text, and the script refuses to continue if any quote fails.
 * That means the letter view's click-to-source, the highlight offsets and the
 * reviewer checklist are all exercising production code paths on this data. A
 * demo that faked the verification would prove nothing, since the verification
 * is the product.
 *
 * The two regulation passages are genuine federal text. The two appeal
 * decisions are written for this demonstration and their citations are marked
 * as such, so nobody mistakes them for real precedent.
 *
 *   pnpm seed:demo            create the demonstration data
 *   pnpm seed:demo --reset    delete it first, then create it again
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  appealDraft,
  assertion,
  assertionReview,
  clinicalFact,
  denial,
  denialDocument,
  denialSpan,
  holding,
  invoice,
  member,
  organization,
  outcome,
  reviewAction,
  sourceDocument,
  sourceSpan,
} from '../lib/db/schema';
import { provisionUser } from '../lib/auth/provision';
import { verifyQuote } from '../lib/appeals/verify';
import { calculateInvoice, invoiceNumber } from '../lib/billing/invoice';
import { storage, sha256 } from '../lib/storage';

const ORG_ID = 'demo-northgate';
const ORG_SLUG = 'northgate';
const RATE_BPS = 1500;

const STAMP = Date.now();
const id = () => randomBytes(16).toString('hex');
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

/** Collected and printed at the end, so the operator can actually sign in. */
const credentials: { role: string; email: string; password: string }[] = [];

/**
 * Take a quote out of the passage it is supposed to come from.
 *
 * Slicing rather than retyping is the whole trick: a quote produced this way
 * cannot drift from its source through a typo, which is exactly the failure the
 * verification exists to catch. The verification still runs on the result.
 */
function quoteFrom(passage: string, from: string, to: string): string {
  const start = passage.indexOf(from);
  if (start === -1) throw new Error(`Quote start not found in passage: ${from}`);
  const endAt = passage.indexOf(to, start);
  if (endAt === -1) throw new Error(`Quote end not found in passage: ${to}`);
  return passage.slice(start, endAt + to.length);
}

function assertVerifies(quote: string, source: string, label: string): string {
  const result = verifyQuote(quote, source);
  if (!result.ok) {
    throw new Error(
      `Refusing to seed: the quote for ${label} does not verify against its ` +
        `source (${result.reason}). This is the invariant working; fix the data.`,
    );
  }
  return quote;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Sources
   ────────────────────────────────────────────────────────────────────────── */

const CFR_422 =
  'Except as provided in paragraph (b)(2) of this section, an MA organization ' +
  'must comply with general coverage and benefit conditions included in ' +
  'Traditional Medicare laws. An MA organization may not apply coverage ' +
  'criteria that are more restrictive than the coverage criteria applied in ' +
  'Traditional Medicare, and may not deny coverage of a service that would be ' +
  'covered under Traditional Medicare on the basis of internal, proprietary, ' +
  'or external clinical criteria not found in Traditional Medicare coverage ' +
  'policies.';

const CFR_409 =
  'The skilled nursing or skilled rehabilitation services must be needed and ' +
  'provided on a daily basis. Skilled nursing services are considered to be ' +
  'needed on a daily basis when they are needed and provided seven days a ' +
  'week. As a practical matter, considering economy and efficiency, the daily ' +
  'skilled services can be provided only on an inpatient basis in a skilled ' +
  'nursing facility.';

const DECISION_ONE =
  'The plan denied continued coverage on the ground that the beneficiary had ' +
  'reached a plateau and was no longer demonstrating measurable improvement. ' +
  'That standard does not appear in the Medicare coverage rules governing ' +
  'skilled nursing facility care. Coverage turns on whether skilled care is ' +
  'needed, not on whether the beneficiary is improving, and a plan may not ' +
  'substitute an improvement standard of its own devising for the criteria ' +
  'Traditional Medicare applies. The denial is reversed.';

const DECISION_TWO =
  'The record documents daily skilled observation and assessment of an ' +
  'unstable wound, together with intravenous antibiotic administration ' +
  'requiring professional judgment. Where the record establishes a daily need ' +
  'for services that as a practical matter can be furnished only in an ' +
  'inpatient setting, the practical matter requirement is satisfied. The ' +
  'plan’s reliance on a proprietary length of stay projection, without ' +
  'reference to the beneficiary’s documented clinical status, cannot ' +
  'support the denial.';

/* ─────────────────────────────────────────────────────────────────────────────
   Case documents
   ────────────────────────────────────────────────────────────────────────── */

const DENIAL_LETTER = `NOTICE OF DENIAL OF MEDICAL COVERAGE
Meridian Health Plan (Medicare Advantage)
SYNTHETIC DOCUMENT, GENERATED FOR DEMONSTRATION

Member: SYNTHETIC PATIENT A
Claim: NRMC-2026-0417
Dates of service: 12 March 2026 to 31 March 2026
Facility: Northgate Regional Medical Center, skilled nursing unit

We have determined that continued skilled nursing facility care from 22 March
2026 is not medically necessary. Our clinical review applied Meridian Care
Guidelines, which indicate that a member at this functional level no longer
requires a skilled level of care once therapy participation has plateaued and
no measurable functional improvement has been recorded over three consecutive
sessions. The member's recorded gait distance did not increase between 19 March
and 21 March 2026.

Continued stay is therefore denied from 22 March 2026 onward. You have the
right to appeal this determination.`;

const CLINICAL_RECORD = `SKILLED NURSING FACILITY PROGRESS NOTES
Northgate Regional Medical Center
SYNTHETIC DOCUMENT, GENERATED FOR DEMONSTRATION

Patient: SYNTHETIC PATIENT A
Admission: 12 March 2026, following inpatient stay for surgical site infection

22 March 2026, nursing, 0640
Surgical wound at right lower extremity remains open with moderate serosanguinous
drainage. Wound bed assessed daily; measurements taken and packing changed under
sterile technique by licensed nursing staff. Patient requires skilled wound
assessment and IV antibiotic administration daily, and is not a candidate for
management at a lower level of care while the line remains in place.

22 March 2026, physician, 0910
Continued intravenous vancomycin via PICC line, day nine of a fourteen day
course. Daily assessment for line site infection and for drug levels is
required. I certify that the patient continues to require daily skilled nursing
services which as a practical matter can only be provided on an inpatient basis.

23 March 2026, therapy, 1420
Patient ambulated 40 feet with a rolling walker and contact guard assist,
tolerating the session poorly with reported pain at the surgical site. Therapy
goals remain appropriate; progress is limited by the active infection rather
than by absence of rehabilitation potential.`;

/* ─────────────────────────────────────────────────────────────────────────────
   Seeding
   ────────────────────────────────────────────────────────────────────────── */

async function reset(): Promise<void> {
  // Everything hangs off the organisation by foreign key, so one delete is
  // enough for the case data. The corpus is shared and cleared separately.
  await db.delete(organization).where(eq(organization.id, ORG_ID));
  for (const citation of ['42 CFR 422.101(b)', '42 CFR 409.31', 'DEMO-DAB-0001', 'DEMO-DAB-0002']) {
    await db.delete(sourceDocument).where(eq(sourceDocument.citation, citation));
  }
  process.stdout.write('Existing demonstration data removed.\n');
}

async function seedCorpus() {
  const docs = [
    {
      key: 'cfr422',
      sourceType: 'regulation' as const,
      citation: '42 CFR 422.101(b)',
      title: 'Requirements relating to basic benefits',
      url: 'https://www.ecfr.gov/current/title-42/part-422/section-422.101',
      text: CFR_422,
      real: true,
    },
    {
      key: 'cfr409',
      sourceType: 'regulation' as const,
      citation: '42 CFR 409.31',
      title: 'Level of care requirement',
      url: 'https://www.ecfr.gov/current/title-42/part-409/section-409.31',
      text: CFR_409,
      real: true,
    },
    {
      key: 'dab1',
      sourceType: 'dab_decision' as const,
      citation: 'DEMO-DAB-0001',
      title: 'Illustrative decision: improvement standard not found in Medicare rules',
      url: 'https://example.invalid/demo/decision-0001',
      text: DECISION_ONE,
      real: false,
    },
    {
      key: 'dab2',
      sourceType: 'dab_decision' as const,
      citation: 'DEMO-DAB-0002',
      title: 'Illustrative decision: daily skilled need and the practical matter test',
      url: 'https://example.invalid/demo/decision-0002',
      text: DECISION_TWO,
      real: false,
    },
  ];

  const spans: Record<string, { spanId: string; docId: string; text: string }> = {};

  for (const d of docs) {
    const [row] = await db
      .insert(sourceDocument)
      .values({
        sourceType: d.sourceType,
        citation: d.citation,
        title: d.title,
        url: d.url,
        retrievedAt: new Date(),
        contentHash: sha256(Buffer.from(d.text, 'utf8')),
        rawPath: `demo/corpus/${d.key}.txt`,
        parsedAt: new Date(),
        extractedAt: new Date(),
        decidedAt: d.real ? null : days(-420),
      })
      .returning({ id: sourceDocument.id });

    const [span] = await db
      .insert(sourceSpan)
      .values({
        sourceDocumentId: row!.id,
        ordinal: 1,
        page: 1,
        charStart: 0,
        charEnd: d.text.length,
        text: d.text,
        headingPath: d.real ? ['Text of the section'] : ['Analysis'],
      })
      .returning({ id: sourceSpan.id });

    spans[d.key] = { spanId: span!.id, docId: row!.id, text: d.text };
  }

  // Holdings, each anchored to the passage that supports it.
  const holdings: Record<string, string> = {};

  const h1Quote = assertVerifies(
    quoteFrom(DECISION_ONE, 'Coverage turns on', 'Traditional Medicare applies.'),
    DECISION_ONE,
    'holding 1',
  );
  const [h1] = await db
    .insert(holding)
    .values({
      sourceDocumentId: spans.dab1!.docId,
      spanId: spans.dab1!.spanId,
      verbatimQuote: h1Quote,
      issue: 'Whether a plan may require measurable improvement for continued SNF coverage',
      ruleApplied: 'Coverage depends on the need for skilled care, not on improvement',
      outcome: 'claimant_favorable',
      serviceType: 'skilled_nursing',
      payerType: 'medicare_advantage',
      denialBasis: 'proprietary_criteria',
      verifiedAt: new Date(),
    })
    .returning({ id: holding.id });
  holdings.improvement = h1!.id;

  const h2Quote = assertVerifies(
    quoteFrom(DECISION_TWO, 'Where the record establishes', 'requirement is satisfied.'),
    DECISION_TWO,
    'holding 2',
  );
  const [h2] = await db
    .insert(holding)
    .values({
      sourceDocumentId: spans.dab2!.docId,
      spanId: spans.dab2!.spanId,
      verbatimQuote: h2Quote,
      issue: 'Whether the practical matter requirement is met on a documented daily skilled need',
      ruleApplied: 'A documented daily skilled need satisfies the practical matter test',
      outcome: 'claimant_favorable',
      serviceType: 'skilled_nursing',
      payerType: 'medicare_advantage',
      denialBasis: 'level_of_care',
      verifiedAt: new Date(),
    })
    .returning({ id: holding.id });
  holdings.practical = h2!.id;

  process.stdout.write('Corpus seeded: 4 sources, 2 holdings, all quotes verified.\n');
  return { spans, holdings };
}

async function seedUsers() {
  const mk = async (
    role: string,
    email: string,
    name: string,
    extra: Parameters<typeof provisionUser>[0],
  ) => {
    const result = await provisionUser(extra);
    credentials.push({ role, email, password: result.temporaryPassword });
    return result.userId;
  };

  const adminEmail = `admin-${STAMP}@northgate.demo`;
  const specialistEmail = `specialist-${STAMP}@northgate.demo`;
  const clinicalEmail = `clinical-${STAMP}@medeal.demo`;
  const legalEmail = `legal-${STAMP}@medeal.demo`;

  const adminId = await mk('Hospital admin', adminEmail, 'Demo Admin', {
    email: adminEmail,
    name: 'Demo Admin',
    membership: { organizationId: ORG_ID, role: 'org_admin' },
  });
  const specialistId = await mk('Appeal specialist', specialistEmail, 'Demo Specialist', {
    email: specialistEmail,
    name: 'Demo Specialist',
    membership: { organizationId: ORG_ID, role: 'appeal_specialist' },
  });
  const clinicalId = await mk('Clinical reviewer', clinicalEmail, 'Demo Clinical Reviewer', {
    email: clinicalEmail,
    name: 'Demo Clinical Reviewer',
    platformRole: 'clinical_reviewer',
    reviewerOrgIds: [ORG_ID],
  });
  const legalId = await mk('Legal reviewer', legalEmail, 'Demo Legal Reviewer', {
    email: legalEmail,
    name: 'Demo Legal Reviewer',
    platformRole: 'legal_reviewer',
    reviewerOrgIds: [ORG_ID],
  });

  process.stdout.write('Accounts provisioned: 4.\n');
  return { adminId, specialistId, clinicalId, legalId };
}

async function seedDocuments(denialId: string, uploadedBy: string) {
  const store = storage();
  const written: Record<string, { docId: string; text: string }> = {};

  const files = [
    { kind: 'denial_letter' as const, filename: 'denial-letter.txt', text: DENIAL_LETTER },
    { kind: 'clinical_record' as const, filename: 'progress-notes.txt', text: CLINICAL_RECORD },
  ];

  for (const f of files) {
    const body = Buffer.from(f.text, 'utf8');
    const key = `org/${ORG_ID}/denial/${denialId}/${f.kind}/${id()}-${f.filename}`;
    await store.put(key, body, 'text/plain');

    const [row] = await db
      .insert(denialDocument)
      .values({
        denialId,
        kind: f.kind,
        r2Key: key,
        filename: f.filename,
        byteSize: body.byteLength,
        contentHash: sha256(body),
        parsedAt: new Date(),
        uploadedBy,
      })
      .returning({ id: denialDocument.id });

    written[f.kind] = { docId: row!.id, text: f.text };
  }

  return written;
}

async function main(): Promise<void> {
  if (process.argv.includes('--reset')) await reset();

  await db
    .insert(organization)
    .values({
      id: ORG_ID,
      name: 'Northgate Regional Medical Center',
      slug: ORG_SLUG,
      contingencyRateBps: RATE_BPS,
      status: 'active',
    })
    .onConflictDoNothing();

  const { spans, holdings } = await seedCorpus();
  const users = await seedUsers();

  // Memberships are created by provisionUser; reviewers are assigned there too.
  await db
    .insert(member)
    .values({ id: id(), organizationId: ORG_ID, userId: users.adminId, role: 'org_admin' })
    .onConflictDoNothing();

  /* ── The case under review ──────────────────────────────────────────── */

  const [mainDenial] = await db
    .insert(denial)
    .values({
      organizationId: ORG_ID,
      internalRef: 'NRMC-2026-0417',
      payerName: 'Meridian Health Plan',
      planType: 'medicare_advantage',
      denialReasonCode: 'MN-204',
      denialBasisText:
        'Continued skilled nursing facility care is not medically necessary. Meridian Care Guidelines indicate no skilled level of care once therapy participation has plateaued.',
      denialBasis: 'proprietary_criteria',
      serviceType: 'skilled_nursing',
      claimAmountCents: 1_842_000,
      serviceDateFrom: days(-140),
      serviceDateTo: days(-121),
      appealDeadline: days(11),
      status: 'clinical_review',
      isSynthetic: true,
      createdBy: users.specialistId,
    })
    .returning({ id: denial.id });

  const denialId = mainDenial!.id;
  const docs = await seedDocuments(denialId, users.specialistId);

  // Spans of the clinical record, with real offsets into the real text.
  const record = docs.clinical_record!;
  const passages = [
    'Surgical wound at right lower extremity remains open with moderate serosanguinous\ndrainage. Wound bed assessed daily; measurements taken and packing changed under\nsterile technique by licensed nursing staff. Patient requires skilled wound\nassessment and IV antibiotic administration daily, and is not a candidate for\nmanagement at a lower level of care while the line remains in place.',
    'Continued intravenous vancomycin via PICC line, day nine of a fourteen day\ncourse. Daily assessment for line site infection and for drug levels is\nrequired. I certify that the patient continues to require daily skilled nursing\nservices which as a practical matter can only be provided on an inpatient basis.',
    'Patient ambulated 40 feet with a rolling walker and contact guard assist,\ntolerating the session poorly with reported pain at the surgical site. Therapy\ngoals remain appropriate; progress is limited by the active infection rather\nthan by absence of rehabilitation potential.',
  ];

  const recordSpans: { spanId: string; text: string }[] = [];
  for (const [i, passage] of passages.entries()) {
    const charStart = record.text.indexOf(passage);
    if (charStart === -1) throw new Error(`Passage ${i + 1} is not in the record text.`);
    const [row] = await db
      .insert(denialSpan)
      .values({
        denialDocumentId: record.docId,
        ordinal: i + 1,
        page: 1,
        charStart,
        charEnd: charStart + passage.length,
        text: passage,
      })
      .returning({ id: denialSpan.id });
    recordSpans.push({ spanId: row!.id, text: passage });
  }

  // Clinical facts, each quoting its span exactly.
  const factSpecs = [
    {
      span: 0,
      from: 'Patient requires skilled wound',
      to: 'administration daily',
      factType: 'skilled_service' as const,
      normalized: 'Daily skilled nursing: wound assessment and IV antibiotics',
    },
    {
      span: 1,
      from: 'I certify that the patient',
      to: 'on an inpatient basis.',
      factType: 'physician_order' as const,
      normalized: 'Physician certification of daily skilled need, practical matter',
    },
    {
      span: 2,
      from: 'progress is limited by the active infection',
      to: 'rehabilitation potential.',
      factType: 'functional_status' as const,
      normalized: 'Limited progress attributed to infection, not to lack of potential',
    },
  ];

  const facts: { id: string; quote: string }[] = [];
  for (const [i, spec] of factSpecs.entries()) {
    const source = recordSpans[spec.span]!;
    const quote = assertVerifies(
      quoteFrom(source.text, spec.from, spec.to),
      source.text,
      `clinical fact ${i + 1}`,
    );
    const [row] = await db
      .insert(clinicalFact)
      .values({
        denialId,
        spanId: source.spanId,
        verbatimQuote: quote,
        factType: spec.factType,
        normalizedValue: spec.normalized,
      })
      .returning({ id: clinicalFact.id });
    facts.push({ id: row!.id, quote });
  }

  /* ── The draft, and the assertions that carry the invariant ─────────── */

  const assertionSpecs = [
    {
      section: 'The standard applied is not the Medicare standard',
      kind: 'legal' as const,
      text: 'A Medicare Advantage plan may not apply coverage criteria more restrictive than those used in Traditional Medicare, nor deny a service on the basis of internal or proprietary clinical criteria.',
      sourceKind: 'source_span' as const,
      sourceId: spans.cfr422!.spanId,
      sourceText: CFR_422,
      from: 'An MA organization may not apply coverage',
      to: 'Traditional Medicare coverage\npolicies.'.replace('\n', ' '),
    },
    {
      section: 'The standard applied is not the Medicare standard',
      kind: 'legal' as const,
      text: 'Coverage of skilled nursing facility care turns on whether skilled care is needed, not on whether the beneficiary demonstrates measurable improvement.',
      sourceKind: 'holding' as const,
      sourceId: holdings.improvement!,
      sourceText: DECISION_ONE,
      from: 'Coverage turns on',
      to: 'Traditional Medicare applies.',
    },
    {
      section: 'The record documents a daily skilled need',
      kind: 'clinical' as const,
      text: 'The beneficiary required daily skilled nursing services throughout the denied period.',
      sourceKind: 'clinical_fact' as const,
      sourceId: facts[0]!.id,
      sourceText: recordSpans[0]!.text,
      from: 'Patient requires skilled wound',
      to: 'administration daily',
    },
    {
      section: 'The record documents a daily skilled need',
      kind: 'clinical' as const,
      text: 'The attending physician certified a continuing daily skilled need that could only be met on an inpatient basis.',
      sourceKind: 'clinical_fact' as const,
      sourceId: facts[1]!.id,
      sourceText: recordSpans[1]!.text,
      from: 'I certify that the patient',
      to: 'on an inpatient basis.',
    },
    {
      section: 'The practical matter requirement is satisfied',
      kind: 'legal' as const,
      text: 'Where the record establishes a daily need for services that can practically be furnished only in an inpatient setting, the practical matter requirement is met.',
      sourceKind: 'holding' as const,
      sourceId: holdings.practical!,
      sourceText: DECISION_TWO,
      from: 'Where the record establishes',
      to: 'requirement is satisfied.',
    },
    {
      section: 'The plateau finding does not survive the record',
      kind: 'clinical' as const,
      text: 'Limited therapy progress in the denied period is documented as a consequence of active infection, not of exhausted rehabilitation potential.',
      sourceKind: 'clinical_fact' as const,
      sourceId: facts[2]!.id,
      sourceText: recordSpans[2]!.text,
      from: 'progress is limited by the active infection',
      to: 'rehabilitation potential.',
    },
  ];

  const prepared = assertionSpecs.map((spec, i) => ({
    ...spec,
    quote: assertVerifies(
      quoteFrom(spec.sourceText, spec.from, spec.to),
      spec.sourceText,
      `assertion ${i + 1}`,
    ),
  }));

  const sections = [...new Set(prepared.map((p) => p.section))].map((title) => ({
    title,
    assertionOrdinals: prepared
      .map((p, i) => (p.section === title ? i + 1 : null))
      .filter((n): n is number => n !== null),
  }));

  const [draftRow] = await db
    .insert(appealDraft)
    .values({
      denialId,
      version: 1,
      bodyJson: JSON.stringify({ sections }),
      status: 'ready',
      documentationGaps: [
        {
          criterion: 'Daily skilled need on and after 29 March 2026',
          why: 'The submitted record ends on 23 March. Notes covering the remaining denied days were not part of the upload.',
        },
      ],
      proprietaryCriteriaFlag: true,
      verificationFailures: 0,
      generatedByModel: 'seeded-demonstration-data',
    })
    .returning({ id: appealDraft.id });

  const draftId = draftRow!.id;

  const assertionRows = await db
    .insert(assertion)
    .values(
      prepared.map((p, i) => ({
        appealDraftId: draftId,
        ordinal: i + 1,
        section: p.section,
        kind: p.kind,
        text: p.text,
        sourceKind: p.sourceKind,
        sourceId: p.sourceId,
        verbatimQuote: p.quote,
        verifiedAt: new Date(),
      })),
    )
    .returning({ id: assertion.id, ordinal: assertion.ordinal });

  // A clinical reviewer part way through the checklist, so the review queue has
  // something in progress rather than everything untouched.
  for (const row of assertionRows.slice(0, 3)) {
    await db.insert(assertionReview).values({
      assertionId: row.id,
      reviewerId: users.clinicalId,
      reviewType: 'clinical',
      verified: true,
    });
  }

  /* ── Other cases, so the dashboard is not a single row ──────────────── */

  const others = [
    {
      internalRef: 'NRMC-2026-0388',
      payerName: 'Meridian Health Plan',
      serviceType: 'inpatient_rehab' as const,
      claimAmountCents: 2_410_000,
      status: 'legal_review' as const,
      deadline: days(4),
      basis: 'level_of_care' as const,
    },
    {
      internalRef: 'NRMC-2026-0402',
      payerName: 'Cardinal Senior Care',
      serviceType: 'skilled_nursing' as const,
      claimAmountCents: 967_500,
      status: 'ready_for_generation' as const,
      deadline: days(23),
      basis: 'medical_necessity' as const,
    },
    {
      internalRef: 'NRMC-2026-0311',
      payerName: 'Meridian Health Plan',
      serviceType: 'skilled_nursing' as const,
      claimAmountCents: 1_356_000,
      status: 'decided' as const,
      deadline: days(-30),
      basis: 'proprietary_criteria' as const,
    },
  ];

  const created: Record<string, string> = {};
  for (const o of others) {
    const [row] = await db
      .insert(denial)
      .values({
        organizationId: ORG_ID,
        internalRef: o.internalRef,
        payerName: o.payerName,
        planType: 'medicare_advantage',
        denialBasis: o.basis,
        serviceType: o.serviceType,
        claimAmountCents: o.claimAmountCents,
        serviceDateFrom: days(-170),
        serviceDateTo: days(-150),
        appealDeadline: o.deadline,
        status: o.status,
        isSynthetic: true,
        createdBy: users.specialistId,
      })
      .returning({ id: denial.id });
    created[o.internalRef] = row!.id;
  }

  /* ── A won case, an outcome, and the invoice that follows ───────────── */

  const wonId = created['NRMC-2026-0311']!;
  const decidedAt = days(-14);
  const recovered = 1_356_000;

  const [outcomeRow] = await db
    .insert(outcome)
    .values({
      denialId: wonId,
      result: 'won',
      decidedAt,
      amountRecoveredCents: recovered,
      recordedBy: users.adminId,
    })
    .returning({ id: outcome.id });

  const period = { start: days(-45), end: days(-1) };
  const calc = calculateInvoice(
    [
      {
        outcomeId: outcomeRow!.id,
        denialId: wonId,
        result: 'won',
        amountRecoveredCents: recovered,
        decidedAt,
        invoiceId: null,
      },
    ],
    RATE_BPS,
    period,
  );

  const [invoiceRow] = await db
    .insert(invoice)
    .values({
      organizationId: ORG_ID,
      number: invoiceNumber(ORG_SLUG, period.start, 1),
      periodStart: period.start,
      periodEnd: period.end,
      totalRecoveredCents: calc.totalRecoveredCents,
      contingencyRateBps: RATE_BPS,
      feeCents: calc.feeCents,
      status: 'issued',
      issuedAt: days(-1),
    })
    .returning({ id: invoice.id });

  await db
    .update(outcome)
    .set({ invoiceId: invoiceRow!.id })
    .where(eq(outcome.id, outcomeRow!.id));

  await db.insert(reviewAction).values({
    appealDraftId: draftId,
    reviewerId: users.clinicalId,
    reviewType: 'clinical',
    action: 'approved',
    notes: 'Assertions 1 to 3 checked against the notes. Gap on the later days is real and stated.',
  });

  /* ── Report ─────────────────────────────────────────────────────────── */

  const line = '─'.repeat(72);
  process.stdout.write(
    `\n${line}\n` +
      'Demonstration data created.\n\n' +
      `  Organisation      Northgate Regional Medical Center (${RATE_BPS / 100}% contingency)\n` +
      `  Denials           4, one in clinical review with a verified draft\n` +
      `  Assertions        ${prepared.length}, every quote verified against its source\n` +
      `  Invoice           ${invoiceNumber(ORG_SLUG, period.start, 1)}, ` +
      `$${(calc.feeCents / 100).toFixed(2)} on $${(calc.totalRecoveredCents / 100).toFixed(2)} recovered\n\n` +
      'Sign in with any of these. Each will force a password change, and every\n' +
      'role except read only will then require two-factor enrolment.\n\n',
  );
  for (const c of credentials) {
    process.stdout.write(`  ${c.role.padEnd(20)} ${c.email}\n${' '.repeat(22)}${c.password}\n\n`);
  }
  process.stdout.write(
    'All of it is synthetic and tagged as such. The verification is not: every\n' +
      'quote above was checked with the same code that runs in production.\n' +
      `${line}\n\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\nSeeding failed: ${message}\n\n`);
    process.exit(1);
  });
