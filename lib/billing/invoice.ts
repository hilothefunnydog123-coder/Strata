/**
 * The contingency fee.
 *
 * This is the billing system, not a report. It computes what a customer owes
 * from outcomes they recorded, so every number here ends up on an invoice and
 * has to be defensible against the customer's own remittance advice.
 *
 * Three rules hold throughout:
 *
 *   1. Integer cents everywhere. No floats touch money at any point, including
 *      intermediate values. The rate is basis points for exactly this reason:
 *      a rate stored as 0.15 would reintroduce float arithmetic at the moment
 *      it matters most.
 *
 *   2. Rounding is toward the customer. A half cent goes to them, not to us.
 *      The amounts are small and the goodwill is not.
 *
 *   3. Only recovered dollars are billable. A loss, a withdrawal, and a partial
 *      recovery of nothing all produce a zero fee, and an outcome already
 *      invoiced is never billed twice.
 */

/** Basis points. 1500 is 15 percent. */
export type BasisPoints = number;

export const BPS_DENOMINATOR = 10_000;

export class InvalidRateError extends Error {
  constructor(rate: number) {
    super(
      `A contingency rate of ${rate} basis points is not usable. It must be a whole ` +
        'number between 0 and 10000, where 10000 would be the entire recovery.',
    );
    this.name = 'InvalidRateError';
  }
}

export function assertValidRate(rateBps: BasisPoints): void {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > BPS_DENOMINATOR) {
    throw new InvalidRateError(rateBps);
  }
}

/**
 * The fee on one recovery.
 *
 * Floor rather than round: at a half cent the customer keeps it. Over a year of
 * invoices this costs us a few cents and removes any argument about which way
 * the arithmetic went.
 */
export function feeForRecovery(
  recoveredCents: number,
  rateBps: BasisPoints,
): number {
  assertValidRate(rateBps);

  if (!Number.isInteger(recoveredCents)) {
    throw new Error(
      `Recovered amount must be an integer number of cents, got ${recoveredCents}. ` +
        'Money is never a float in this system.',
    );
  }
  // A negative recovery is a takeback, not something we bill a fee on.
  if (recoveredCents <= 0) return 0;

  return Math.floor((recoveredCents * rateBps) / BPS_DENOMINATOR);
}

export type OutcomeResult = 'won' | 'lost' | 'partial' | 'withdrawn';

export interface BillableOutcome {
  outcomeId: string;
  denialId: string;
  result: OutcomeResult;
  amountRecoveredCents: number;
  decidedAt: Date;
  /** Set once this outcome has been rolled into an issued invoice. */
  invoiceId: string | null;
}

export interface InvoiceCalculation {
  totalRecoveredCents: number;
  contingencyRateBps: BasisPoints;
  feeCents: number;
  /** The outcomes this invoice bills, in the order they were decided. */
  lines: {
    outcomeId: string;
    denialId: string;
    recoveredCents: number;
    feeCents: number;
  }[];
  /** Outcomes considered and excluded, with the reason. */
  excluded: { outcomeId: string; reason: string }[];
}

/**
 * Build an invoice for one organisation and one period.
 *
 * The fee is the sum of per-outcome fees, not the rate applied to the summed
 * total. Those differ by a cent or two because of flooring, and summing the
 * lines is the one that matches what the invoice shows: an invoice whose total
 * does not equal the sum of its lines is an invoice that generates a phone call.
 */
export function calculateInvoice(
  outcomes: readonly BillableOutcome[],
  rateBps: BasisPoints,
  period: { start: Date; end: Date },
): InvoiceCalculation {
  assertValidRate(rateBps);

  const lines: InvoiceCalculation['lines'] = [];
  const excluded: InvoiceCalculation['excluded'] = [];

  const sorted = [...outcomes].sort(
    (a, b) => a.decidedAt.getTime() - b.decidedAt.getTime(),
  );

  for (const outcome of sorted) {
    if (outcome.invoiceId !== null) {
      excluded.push({
        outcomeId: outcome.outcomeId,
        reason: 'already billed on an earlier invoice',
      });
      continue;
    }

    if (outcome.decidedAt < period.start || outcome.decidedAt > period.end) {
      excluded.push({
        outcomeId: outcome.outcomeId,
        reason: 'decided outside this period',
      });
      continue;
    }

    if (outcome.result === 'lost' || outcome.result === 'withdrawn') {
      excluded.push({
        outcomeId: outcome.outcomeId,
        reason: `${outcome.result}, so nothing was recovered and nothing is owed`,
      });
      continue;
    }

    if (outcome.amountRecoveredCents <= 0) {
      excluded.push({
        outcomeId: outcome.outcomeId,
        reason: 'no dollars recovered',
      });
      continue;
    }

    lines.push({
      outcomeId: outcome.outcomeId,
      denialId: outcome.denialId,
      recoveredCents: outcome.amountRecoveredCents,
      feeCents: feeForRecovery(outcome.amountRecoveredCents, rateBps),
    });
  }

  return {
    totalRecoveredCents: lines.reduce((sum, l) => sum + l.recoveredCents, 0),
    contingencyRateBps: rateBps,
    feeCents: lines.reduce((sum, l) => sum + l.feeCents, 0),
    lines,
    excluded,
  };
}

/** "15%" or "12.5%", from basis points, without float formatting artefacts. */
export function formatRate(rateBps: BasisPoints): string {
  const whole = Math.floor(rateBps / 100);
  const fraction = rateBps % 100;
  if (fraction === 0) return `${whole}%`;
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}%`;
}

/** Invoice numbers are sequential per organisation, and readable aloud. */
export function invoiceNumber(orgSlug: string, periodStart: Date, sequence: number): string {
  const year = periodStart.getUTCFullYear();
  const month = String(periodStart.getUTCMonth() + 1).padStart(2, '0');
  return `${orgSlug.toUpperCase().slice(0, 8)}-${year}${month}-${String(sequence).padStart(3, '0')}`;
}
