import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  // Absolute, so the root layout's "%s | Medeal" template does not append the
  // name to a title that already ends in it.
  title: { absolute: 'Medeal: appeal the denials you are writing off' },
  description:
    'Around six in ten denied claims are never appealed. Most that are appealed get overturned. Medeal drafts the appeal, cites every assertion, and takes a share of what it recovers.',
};

/**
 * The home page leads with the asymmetry, because the asymmetry is the entire
 * argument and everything else is detail. No centred hero, no gradient, no
 * photograph of a clinician looking thoughtfully at a tablet.
 */
export default function Home() {
  return (
    <>
      <section className="mx-auto max-w-5xl px-5 pb-16 pt-16 sm:pt-24">
        <h1 className="max-w-3xl text-4xl leading-[1.1] sm:text-5xl">
          Insurers deny claims they would lose on, betting nobody will challenge
          them.
        </h1>

        <div className="mt-10 grid max-w-3xl gap-px border border-rule bg-rule sm:grid-cols-2">
          <div className="bg-paper-2 p-5">
            <p className="tnum text-5xl font-semibold text-denied">60%</p>
            <p className="mt-2 text-sm text-ink-2">
              of denied claims are never appealed at all. Appealing costs 30 to 60
              minutes of clinical staff time, and most single denials are too
              small to be worth it.
            </p>
          </div>
          <div className="bg-paper-2 p-5">
            <p className="tnum text-5xl font-semibold text-recovered">Most</p>
            <p className="mt-2 text-sm text-ink-2">
              of the appeals that do get filed are overturned. The economics of
              not appealing are what the denial is betting on, not the merits.
            </p>
          </div>
        </div>

        <p className="mt-10 max-w-2xl text-lg">
          US hospitals write off roughly twenty billion dollars a year this way.
          Medeal closes the gap: you upload the denial letter and the record, and
          you get back a complete appeal in which every legal claim cites a
          published decision and every clinical claim cites a line in your own
          chart.
        </p>

        <p className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/demo"
            className="on-action rounded-[3px] border border-action bg-action px-4 py-2 font-medium text-white no-underline hover:bg-[#163d76]"
          >
            Request a demo
          </Link>
          <Link href="/how-it-works" className="font-medium">
            See how it works
          </Link>
        </p>
      </section>

      <section className="rule-t bg-paper-2">
        <div className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="text-2xl">The arguments that win are public record</h2>
          <p className="mt-4 max-w-2xl text-ink-2">
            When a Medicare appeal reaches the HHS Departmental Appeals Board, the
            decision gets published: which argument was made, which clinical facts
            mattered, how the adjudicator read the coverage rule, who won. That
            corpus sits there, searchable by nobody. Medeal reads it, indexes
            every holding against the passage it came from, and retrieves the ones
            that decided a case like yours.
          </p>

          <div className="mt-8 border border-rule bg-paper p-5">
            <p className="id text-xs uppercase tracking-wider text-ink-2">
              42 CFR 422.101(b)
            </p>
            <p className="document mt-3 max-w-2xl">
              A Medicare Advantage plan may not apply coverage criteria more
              restrictive than those used in Traditional Medicare. Plans routinely
              apply proprietary internal criteria that are exactly that. Where it
              is challenged, they lose.
            </p>
            <p className="mt-3 max-w-2xl text-sm text-ink-2">
              Medeal recognises when a denial rests on non-Medicare proprietary
              criteria and builds that argument, with the decisions where it
              prevailed attached.
            </p>
          </div>
        </div>
      </section>

      <section className="rule-t">
        <div className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="text-2xl">Every sentence traces to its source</h2>
          <p className="mt-4 max-w-2xl text-ink-2">
            A letter that misstates a patient chart is your exposure. A letter
            citing a decision that does not say what it claims is ours. So no
            assertion exists in a Medeal appeal without a verbatim quote from a
            source that has been checked, programmatically, to contain it.
          </p>
          <ul className="mt-6 max-w-2xl space-y-3 text-ink-2">
            <li className="rule-t pt-3">
              <span className="font-medium text-ink">Click any sentence</span> in
              the letter and the exact paragraph of the published decision, or the
              exact line of your record, opens beside it, highlighted.
            </li>
            <li className="rule-t pt-3">
              <span className="font-medium text-ink">
                Failed checks are discarded, never repaired.
              </span>{' '}
              A draft containing an unverified claim is thrown out and regenerated
              rather than patched. Nobody reviews a letter that did not pass.
            </li>
            <li className="rule-t pt-3">
              <span className="font-medium text-ink">Gaps are stated plainly.</span>{' '}
              Where a coverage criterion has no support in your record, you get
              told which one, before drafting, instead of getting language that
              papers over it.
            </li>
          </ul>
        </div>
      </section>

      <section className="rule-t bg-paper-2">
        <div className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="text-2xl">You pay out of what we recover</h2>
          <p className="mt-4 max-w-2xl text-ink-2">
            No subscription, no seat licence, no implementation fee. A percentage
            of dollars actually recovered, and nothing at all otherwise. If an
            appeal does not land, it costs you the time you did not spend on it.
          </p>
          <p className="mt-6">
            <Link href="/pricing" className="font-medium">
              Read the pricing
            </Link>
          </p>
        </div>
      </section>

      <section className="rule-t">
        <div className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="text-2xl">Start with one denial</h2>
          <p className="mt-4 max-w-2xl text-ink-2">
            Bring a denial letter and the matching record to a 30 minute call. We
            run it, and you see the drafted appeal with every citation resolvable.
            Until a business associate agreement is in place we work from a
            redacted copy.
          </p>
          <p className="mt-8">
            <Link
              href="/demo"
              className="on-action rounded-[3px] border border-action bg-action px-4 py-2 font-medium text-white no-underline hover:bg-[#163d76]"
            >
              Request a demo
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
