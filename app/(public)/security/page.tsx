import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'How Medeal handles protected health information: data classification, encryption, audit logging, log redaction, the model boundary, deletion, and business associate agreements.',
};

/**
 * Written for a hospital security reviewer, not for a buyer.
 *
 * The most important thing on this page is the paragraph saying we do not
 * currently hold patient data. Saying so plainly is worth more than a page of
 * assurances, and a reviewer will find out anyway.
 */
export default function Security() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <h1 className="text-3xl">Security</h1>
      <p className="mt-4 text-lg text-ink-2">
        This page is for the person doing your vendor review. It says what the
        system does, where in the code it does it, and what is not true yet.
      </p>

      <section className="mt-10 border border-denied/40 bg-denied-wash p-5">
        <h2 className="font-semibold text-denied">Where we actually stand today</h2>
        <p className="mt-2 text-ink">
          We do not currently process protected health information for anyone.
          Medeal runs in synthetic mode: every uploaded document must be tagged
          as fabricated at upload, anything untagged is rejected, and a banner
          says so on every screen inside the application.
        </p>
        <p className="mt-2 text-ink">
          Switching to live mode requires a signed business associate agreement
          with you, and separately requires that our model access sits inside a
          HIPAA-ready API organisation covered by a BAA with Anthropic. The
          application refuses to start in live mode unless both are configured.
          There is no override flag and no support path to add one.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl">Two data classes</h2>
        <p className="mt-3 text-ink-2">
          Everything in the database is one of two things.
        </p>
        <dl className="mt-4 divide-y divide-rule border-y border-rule">
          <div className="grid gap-1 py-3 sm:grid-cols-[140px_1fr]">
            <dt className="id text-sm">PUBLIC</dt>
            <dd className="text-ink-2">
              Published government records, platform bookkeeping, authentication,
              billing totals. Safe to aggregate and report on.
            </dd>
          </div>
          <div className="grid gap-1 py-3 sm:grid-cols-[140px_1fr]">
            <dt className="id text-sm">PHI</dt>
            <dd className="text-ink-2">
              Anything derived from documents you submit. Clinical text columns
              are encrypted at rest with AES-256-GCM under a key held separately
              from the session signing secret, and these tables are excluded
              from analytics queries in code rather than by convention.
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-xl">Protected information never enters a log</h2>
        <p className="mt-3 text-ink-2">
          Redaction runs inside the logger itself, so there is no call site that
          can forget it. Three filters run over every value: field names known to
          hold clinical content are dropped entirely, value patterns that
          identify a person are masked wherever they appear, and any string long
          enough to be narrative is replaced by its length. Identifiers we mint,
          enums, counts, and timestamps survive, which is enough to debug with.
        </p>
        <p className="mt-3 text-ink-2">
          Exception traces go through the same path, including the extra
          properties database drivers attach to an error, which is the usual way
          a row leaks into a log.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl">Every access is recorded</h2>
        <p className="mt-3 text-ink-2">
          Every read or write of a record in a PHI table writes an audit row: who
          did it, which record, what action, when, and from which address and
          user agent. The table is append only. The application exposes writes
          and reads and has no update or delete path for it.
        </p>
        <p className="mt-3 text-ink-2">
          Audit rows carry identifiers and never content. An audit trail that
          quoted the record it was protecting would be a second copy of your data
          with weaker handling.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl">The model boundary</h2>
        <p className="mt-3 text-ink-2">
          Exactly one file in the codebase can talk to a language model. It
          checks the PHI mode and the BAA confirmation and throws before
          transmitting anything if the combination is not permitted. A lint rule
          makes importing the SDK anywhere else a build failure, so the check
          cannot be routed around by adding a second call path.
        </p>
        <p className="mt-3 text-ink-2">
          Prompts are never stored. We record a hash of the input, the token
          counts, the latency, and the cost, which is what we need for spend
          reporting and nothing more.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl">Sessions and access</h2>
        <ul className="mt-3 space-y-2 text-ink-2">
          <li>Sessions idle out after 30 minutes and cap at 12 hours regardless.</li>
          <li>
            Two-factor authentication is mandatory for every role that can change
            a record. A read only account may enrol and is not forced to.
          </li>
          <li>
            Session cookies are httpOnly, SameSite=Lax, and Secure in production.
            Cross-origin form posts are rejected.
          </li>
          <li>
            There is no signup route. Accounts are provisioned by an operator,
            always land with a temporary password, and must change it before they
            can do anything.
          </li>
          <li>
            Deactivating an account destroys its sessions immediately rather than
            letting them expire.
          </li>
          <li>
            Reviewers are scoped to assigned organisations. Role checks run on
            the server for every route and every action; nothing depends on a
            hidden button.
          </li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl">Deletion</h2>
        <p className="mt-3 text-ink-2">
          You can ask for complete deletion of your organisation&apos;s data at any
          time. It cascades through every dependent record, and the erasure
          itself is recorded with counts by table, so the deletion is evidenced
          after the rows are gone. Audit rows about the deletion survive it by
          design.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl">What we do not claim</h2>
        <ul className="mt-3 space-y-2 text-ink-2">
          <li>We are not SOC 2 certified. We have not been audited.</li>
          <li>We do not currently hold a business associate agreement with anyone.</li>
          <li>
            We have no penetration test report to share, because no penetration
            test has been done.
          </li>
        </ul>
        <p className="mt-3 text-ink-2">
          If any of those is a hard requirement for your review, we would rather
          you knew now than three weeks into a procurement cycle.
        </p>
      </section>

      <p className="mt-12">
        <Link href="/contact" className="font-medium">
          Talk to us about a review
        </Link>
      </p>
    </div>
  );
}
