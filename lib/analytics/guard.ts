/**
 * Keeping PHI out of analytics.
 *
 * Compliance requirement 1 ends with "and are never joined into analytics
 * queries". That is easy to write in a policy document and easy to breach the
 * first time somebody needs a chart broken down by payer.
 *
 * The distinction this module draws is between two kinds of question:
 *
 *   Operational  "Show me my organisation's appeals and how much came back."
 *                Scoped to one organisation, answered for the people who are
 *                already entitled to read those records, and audited. This is
 *                the client dashboard, and it reads PHI tables legitimately.
 *
 *   Analytical   "How are all our customers doing, in aggregate?"
 *                Crosses organisations, answers a question about the business
 *                rather than about a case, and has no business touching a
 *                clinical column at all.
 *
 * `analyticsQuery` builds the second kind and refuses to reference a PHI table.
 * The refusal is a thrown error at call time, not a lint rule, because the
 * tables a query touches are known at runtime and a reviewer asking "show me
 * how this is enforced" deserves a line of code rather than a convention.
 */
import { isPhiTable, PHI_TABLES } from '@/lib/db/schema';

export class PhiInAnalyticsError extends Error {
  constructor(tables: string[]) {
    super(
      `An analytics query may not read ${tables.join(', ')}. ` +
        'These tables hold content derived from a customer\'s submitted documents. ' +
        'Platform metrics are computed from the billing and platform tables, which carry ' +
        'money and counts but no clinical text. If a metric genuinely needs a figure that ' +
        'only exists on a PHI table, add a non-clinical column that carries it rather than ' +
        'reaching across.',
    );
    this.name = 'PhiInAnalyticsError';
  }
}

/**
 * Tables an analytics query may read.
 *
 * Note what is here and what is not. `invoice` is here: it holds money and an
 * organisation identifier and nothing about a patient. `outcome` is not, even
 * though it also holds money, because it hangs off a denial and is listed as
 * PHI. Cross-organisation revenue reporting therefore reads invoices, which is
 * the correct source for it anyway.
 */
export const ANALYTICS_TABLES = [
  'organization',
  'user',
  'member',
  'invoice',
  'audit_log',
  'llm_call',
  'job',
  'contact',
  'campaign',
  'email_send',
  'demo_request',
  'source_document',
  'source_span',
  'holding',
] as const;

/**
 * Assert that a set of tables is safe to aggregate across organisations.
 *
 * Called by every cross-organisation figure on the operator console.
 */
export function assertAnalyticsSafe(tables: readonly string[]): void {
  const offending = tables.filter((t) => isPhiTable(t));
  if (offending.length > 0) throw new PhiInAnalyticsError(offending);
}

/**
 * Run a cross-organisation query, having declared what it reads.
 *
 * The declaration is the point. A developer writing a platform metric has to
 * name the tables, and naming a PHI table fails immediately and loudly rather
 * than shipping.
 */
export async function analyticsQuery<T>(
  tables: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  assertAnalyticsSafe(tables);
  return run();
}

export { PHI_TABLES };
