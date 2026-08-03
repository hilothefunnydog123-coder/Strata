import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { assertPlatformOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { organization } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { Notice } from '@/components/ui/primitives';
import { DemoControls } from './client';

export const metadata: Metadata = { title: 'Demonstration data' };

/**
 * Creating the demonstration from the browser.
 *
 * This page exists because most deployments now run on hosts with no shell, and
 * an operator who cannot reach a terminal would otherwise have an empty system
 * and no way to put anything in it.
 */
export default async function DemoPage() {
  const principal = await requirePrincipal();
  assertPlatformOrForbid(principal, 'admin:organizations');

  const [existing] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, 'demo-northgate'));

  return (
    <div className="p-5">
      <h1 className="text-xl">Demonstration data</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">
        Creates a hospital with four denials across the workflow, one of them
        carrying a drafted appeal part way through clinical review, plus a
        decided case with its outcome and the invoice computed from it.
      </p>

      <div className="mt-4 max-w-2xl">
        <Notice tone="neutral">
          Everything written is synthetic and tagged as such. The verification is
          not: every quote is checked against its real source text by the same
          code that runs in production, and nothing is written if any quote
          fails. The two regulation passages are genuine federal text; the two
          appeal decisions are written for this demonstration and cited
          DEMO-DAB-0001 and DEMO-DAB-0002 so they cannot be mistaken for
          precedent.
        </Notice>
      </div>

      <div className="mt-6">
        {env.phiLive ? (
          <Notice tone="denied">
            This deployment runs in live PHI mode. Demonstration data cannot be
            created here, and there is no override: invented patients do not
            belong in a system approved for real records.
          </Notice>
        ) : (
          <DemoControls alreadySeeded={Boolean(existing)} />
        )}
      </div>
    </div>
  );
}

// Everything behind a session is dynamic by definition: it renders from the
// signed in principal, which only exists per request.
export const dynamic = 'force-dynamic';
