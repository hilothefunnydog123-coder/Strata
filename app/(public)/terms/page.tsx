import type { Metadata } from 'next';
import Link from 'next/link';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The terms on which Strata is offered.',
};

export default function Terms() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <h1 className="text-3xl">Terms</h1>
      <p className="mt-3 text-sm text-ink-2">Last updated 28 July 2026.</p>

      <section className="mt-8">
        <h2 className="text-lg">These terms are not the contract</h2>
        <p className="mt-2 text-ink-2">
          Use of the application is governed by the services agreement signed
          between Strata and your organisation, together with a business
          associate agreement. Where this page and that agreement disagree, the
          agreement wins. This page covers use of the public site and sets out
          how the service works, so nobody is surprised later.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">What Strata is, and is not</h2>
        <p className="mt-2 text-ink-2">
          Strata drafts appeals and routes them through clinical and legal
          review. It is a drafting and review service. It is not a law firm, it
          does not represent you, and using it does not create a solicitor client
          or attorney client relationship. The reviewers who check your appeals
          are checking assertions against sources; they are not giving your
          organisation legal advice about its position.
        </p>
        <p className="mt-2 text-ink-2">
          The decision to file any appeal, and everything asserted in it, remains
          yours. Both review gates must pass before an appeal can be exported,
          and you sign and file it.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">Accuracy, and what we do about it</h2>
        <p className="mt-2 text-ink-2">
          Every assertion in a generated appeal carries a verbatim quote from a
          source that has been checked programmatically to contain it. A draft
          with any unverified assertion is discarded and regenerated rather than
          corrected, and is never shown to a reviewer. We do not promise a
          particular outcome on any appeal, because no honest party could.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">Fees</h2>
        <p className="mt-2 text-ink-2">
          A percentage of amounts actually recovered, at the rate in your
          agreement, and nothing otherwise. Invoices are computed from recorded
          outcomes with remittance evidence attached. See{' '}
          <Link href="/pricing">pricing</Link>.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">Accounts</h2>
        <p className="mt-2 text-ink-2">
          There is no self service signup. Accounts are created by an operator at
          your organisation&apos;s request, and your organisation&apos;s administrator
          controls who holds one. You are responsible for what is done under an
          account you hold.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">Ending it</h2>
        <p className="mt-2 text-ink-2">
          Your organisation can stop using Strata at any time and can require
          complete deletion of its data. Fees already earned on recoveries
          already made remain payable; nothing further accrues.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">Questions</h2>
        <p className="mt-2 text-ink-2">
          <span className="id">{env.DEMO_REQUEST_TO}</span>
        </p>
      </section>
    </div>
  );
}
