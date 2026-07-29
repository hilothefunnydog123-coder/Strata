import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'You pay a percentage of what we recover, and nothing otherwise. No subscription, no seat licence, no implementation fee.',
};

export default function Pricing() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <h1 className="text-3xl">Pricing</h1>

      <p className="mt-8 border-l-2 border-recovered pl-5 text-2xl leading-snug">
        You pay a percentage of what we recover, and nothing otherwise.
      </p>

      <section className="mt-12">
        <h2 className="text-lg">What that means in practice</h2>
        <dl className="mt-4 divide-y divide-rule border-y border-rule">
          <div className="grid gap-1 py-3 sm:grid-cols-[220px_1fr]">
            <dt className="text-sm font-medium">To start</dt>
            <dd className="text-ink-2">
              Nothing. No implementation fee, no minimum, no annual commitment.
            </dd>
          </div>
          <div className="grid gap-1 py-3 sm:grid-cols-[220px_1fr]">
            <dt className="text-sm font-medium">Per seat</dt>
            <dd className="text-ink-2">
              Nothing. Add every denials specialist you have.
            </dd>
          </div>
          <div className="grid gap-1 py-3 sm:grid-cols-[220px_1fr]">
            <dt className="text-sm font-medium">Per appeal filed</dt>
            <dd className="text-ink-2">
              Nothing. An appeal that loses costs you the time you did not spend
              writing it.
            </dd>
          </div>
          <div className="grid gap-1 py-3 sm:grid-cols-[220px_1fr]">
            <dt className="text-sm font-medium">Per dollar recovered</dt>
            <dd className="text-ink-2">
              An agreed percentage, set in your contract and shown on every
              invoice. Invoices are computed from recorded outcomes with
              remittance evidence attached, so you can check the arithmetic
              against your own remittance advice.
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-12">
        <h2 className="text-lg">Why it is structured this way</h2>
        <p className="mt-3 text-ink-2">
          The reason 60 percent of denials go unappealed is that the expected
          value of appealing is negative once you count staff time. A
          subscription does not change that arithmetic, it just moves the cost
          earlier. A contingency fee changes it: appealing a small denial is
          worth doing, because it costs you nothing unless it works.
        </p>
        <p className="mt-3 text-ink-2">
          It also means we are only paid when we are right. An appeal that
          overstates the record does not get overturned, so the incentive on us
          is the same as the incentive on you.
        </p>
      </section>

      <p className="mt-12">
        <Link href="/demo" className="font-medium">
          Request a demo
        </Link>
      </p>
    </div>
  );
}
