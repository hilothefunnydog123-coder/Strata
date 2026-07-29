/**
 * Taking in a denial and its documents.
 *
 * Compliance requirement 4 lands here: while PHI_MODE is synthetic, every
 * upload must be explicitly tagged synthetic, and anything untagged is
 * rejected. The check is in `assertUploadPermitted` and there is no parameter
 * that skips it.
 *
 * Note which way the tag runs. In synthetic mode the uploader must affirm the
 * documents are fabricated, and the affirmation is stored on the denial. In
 * live mode the affirmation is not required, because real patient documents are
 * the expected content and demanding a tag would train people to click through
 * it.
 */
import { z } from 'zod';
import { env } from '@/lib/env';

export class UntaggedUploadError extends Error {
  constructor() {
    super(
      'This environment is not approved for patient information, so every upload must be ' +
        'confirmed as synthetic. Nothing was stored. If you are trying to work with a real ' +
        'patient record, stop: a business associate agreement has to be in place first.',
    );
    this.name = 'UntaggedUploadError';
  }
}

/**
 * The gate.
 *
 * `declaredSynthetic` is what the person uploading affirmed. In synthetic mode
 * a false or missing affirmation throws before a single byte is written to
 * storage or a row to the database.
 */
export function assertUploadPermitted(declaredSynthetic: boolean): void {
  if (!env.phiLive && !declaredSynthetic) {
    throw new UntaggedUploadError();
  }
}

/** Whether the interface should require the synthetic tick. */
export function syntheticTagRequired(): boolean {
  return !env.phiLive;
}

/* ─── Accepted documents ──────────────────────────────────────────────────── */

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * What the parser can actually read.
 *
 * Plain text and PDF only. A DOCX or a scanned image would be accepted by a
 * more permissive check and then produce zero spans, which surfaces to the user
 * as a case that silently never becomes ready. Refusing at the door with a
 * reason is better than accepting and failing later.
 */
export const ACCEPTED_TYPES: Record<string, string> = {
  'text/plain': '.txt',
  'application/pdf': '.pdf',
};

export function acceptedTypeList(): string {
  return Object.values(ACCEPTED_TYPES).join(', ');
}

export class UnsupportedDocumentError extends Error {
  constructor(contentType: string) {
    super(
      `Medeal cannot read ${contentType || 'that file type'} yet. Upload a PDF or a plain ` +
        `text file (${acceptedTypeList()}). A scanned image needs to go through OCR first, ` +
        'because a citation has to point at text we can quote.',
    );
    this.name = 'UnsupportedDocumentError';
  }
}

export function assertReadable(contentType: string, byteSize: number): void {
  if (!ACCEPTED_TYPES[contentType]) throw new UnsupportedDocumentError(contentType);
  if (byteSize > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `That file is ${(byteSize / 1024 / 1024).toFixed(1)} MB, over the 25 MB limit. ` +
        'Split it or remove pages that are not part of the record for this stay.',
    );
  }
  if (byteSize === 0) {
    throw new Error('That file is empty. Check it opens on your machine and try again.');
  }
}

/* ─── Case metadata ───────────────────────────────────────────────────────── */

/** Money arrives as typed dollars and is stored as integer cents. */
const dollarsToCents = z
  .string()
  .trim()
  .min(1, 'Enter the amount the payer denied.')
  .transform((value, ctx) => {
    const cleaned = value.replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter an amount like 18420.00, with no currency symbol.',
      });
      return z.NEVER;
    }
    const [whole, fraction = ''] = cleaned.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  });

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? new Date(value) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), 'That is not a date.');

export const denialIntakeSchema = z
  .object({
    internalRef: z
      .string()
      .trim()
      .min(1, 'Enter your own reference for this case, so you can find it again.')
      .max(64),
    payerName: z.string().trim().min(2, 'Enter the payer name.').max(160),
    planType: z.enum([
      'medicare_advantage',
      'traditional_medicare',
      'medicaid_managed_care',
      'commercial',
      'other',
    ]),
    serviceType: z.enum([
      'skilled_nursing',
      'inpatient_rehab',
      'home_health',
      'long_term_care_hospital',
      'inpatient_acute',
      'outpatient',
      'dme',
      'other',
    ]),
    denialReasonCode: z.string().trim().max(32).optional(),
    claimAmountCents: dollarsToCents,
    serviceDateFrom: optionalDate,
    serviceDateTo: optionalDate,
    appealDeadline: optionalDate,
    isSynthetic: z
      .union([z.literal('on'), z.literal('true'), z.boolean()])
      .optional()
      .transform((v) => v === 'on' || v === 'true' || v === true),
  })
  .refine(
    (data) =>
      !data.serviceDateFrom ||
      !data.serviceDateTo ||
      data.serviceDateFrom <= data.serviceDateTo,
    {
      message: 'The first day of service is after the last one. Check the dates.',
      path: ['serviceDateTo'],
    },
  );

export type DenialIntake = z.infer<typeof denialIntakeSchema>;

export const PLAN_TYPE_LABELS: Record<string, string> = {
  medicare_advantage: 'Medicare Advantage',
  traditional_medicare: 'Traditional Medicare',
  medicaid_managed_care: 'Medicaid managed care',
  commercial: 'Commercial',
  other: 'Other',
};

export const SERVICE_TYPE_LABELS: Record<string, string> = {
  skilled_nursing: 'Skilled nursing facility',
  inpatient_rehab: 'Inpatient rehabilitation',
  home_health: 'Home health',
  long_term_care_hospital: 'Long term care hospital',
  inpatient_acute: 'Inpatient acute',
  outpatient: 'Outpatient',
  dme: 'Durable medical equipment',
  other: 'Other',
};

export const DENIAL_BASIS_LABELS: Record<string, string> = {
  medical_necessity: 'Medical necessity',
  level_of_care: 'Level of care',
  not_covered_benefit: 'Not a covered benefit',
  insufficient_documentation: 'Insufficient documentation',
  proprietary_criteria: 'Proprietary criteria applied',
  administrative: 'Administrative',
  other: 'Other',
};
