import Link from 'next/link';
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { BurnCounter, CountUp, Scene } from './cinema';
import './landing.css';

export const metadata: Metadata = {
  // Absolute, so the root layout's "%s | Medeal" template does not append the
  // name to a title that already ends in it.
  title: { absolute: 'Medeal: appeal the denials you are writing off' },
  description:
    'Around six in ten denied claims are never appealed. Most that are appealed get overturned. Medeal drafts the appeal, cites every assertion, and takes a share of what it recovers.',
};

/**
 * The home page is staged as six acts, because the asymmetry it argues is a
 * story with a villain, a body count, and a fix. Still no centred hero
 * platitude, no gradient, no photograph of a clinician looking thoughtfully
 * at a tablet. The cinematics are the argument, played at full volume.
 */

/** $20 billion a year in write-offs is $634 every second. */
const BURN_RATE_PER_SECOND = 634;

/**
 * Act II props: ten denials, sized like real single denials. The six written
 * off sum to $12,179 and the three overturned to $21,433; both figures are
 * repeated in the captions, so change them together.
 */
const TICKETS: { id: string; kind: string; amount: string; fate: 'dead' | 'won' | 'lost' }[] = [
  { id: 'CLM 0141', kind: 'Inpatient admission', amount: '$1,240', fate: 'dead' },
  { id: 'CLM 0142', kind: 'Observation status', amount: '$3,912', fate: 'won' },
  { id: 'CLM 0143', kind: 'Imaging, prior auth', amount: '$860', fate: 'dead' },
  { id: 'CLM 0144', kind: 'Level of care', amount: '$2,204', fate: 'dead' },
  { id: 'CLM 0145', kind: 'Medical necessity', amount: '$11,470', fate: 'won' },
  { id: 'CLM 0146', kind: 'Coding downgrade', amount: '$1,995', fate: 'dead' },
  { id: 'CLM 0147', kind: 'Timely filing', amount: '$780', fate: 'lost' },
  { id: 'CLM 0148', kind: 'Prior authorization', amount: '$4,318', fate: 'dead' },
  { id: 'CLM 0149', kind: 'Two midnight rule', amount: '$6,051', fate: 'won' },
  { id: 'CLM 0150', kind: 'Site of service', amount: '$1,562', fate: 'dead' },
];

const VERDICT: Record<'dead' | 'won' | 'lost', string> = {
  dead: 'Written off',
  won: 'Overturned',
  lost: 'Upheld',
};

/** Act III props: the appeal, one assertion per source type. */
const ASSERTIONS = [
  {
    text: 'A Medicare Advantage plan may not apply coverage criteria more restrictive than Traditional Medicare. The internal guidelines this denial rests on are exactly that.',
    cites: ['42 CFR 422.101(b)'],
  },
  {
    text: 'The admitting physician expected care spanning two midnights, and the record documents that expectation on the day of admission.',
    cites: ['42 CFR 412.3(d)(1)', 'Record p. 14, line 22'],
  },
  {
    text: 'Where a plan substituted proprietary criteria for Medicare coverage rules, the Appeals Council reversed the denial.',
    cites: ['Appeals Council M-23-1104'],
  },
];

/**
 * Act IV scenery: the shape of the published corpus. Illustrative entries in
 * the citation formats the real corpus uses; the four columns are rotations
 * of one list so no column repeats its neighbour.
 */
const CITES = [
  'M-24-0117 · Proprietary criteria · Overturned',
  'M-23-1104 · Two midnight benchmark · Overturned',
  '42 CFR 422.101(b) · Coverage parity',
  'M-22-0893 · Level of care · Overturned',
  '42 CFR 412.3(d)(1) · Inpatient admission',
  'M-24-0416 · Medical necessity · Overturned',
  'M-21-1550 · Prior authorization · Overturned',
  '42 CFR 405.1202 · Expedited appeal',
  'M-23-0244 · Observation status · Overturned',
  'M-24-0731 · Documentation adequacy · Overturned',
  '42 CFR 422.566 · Organization determination',
  'M-22-1338 · Site of service · Overturned',
  'M-23-0961 · Readmission bundling · Overturned',
  '42 CFR 476.86 · QIO review standards',
  'M-24-0058 · Coding downgrade · Overturned',
  'M-21-0790 · Skilled nursing days · Overturned',
];

const HOT_CITE = CITES[0];

function rotated(offset: number): string[] {
  return [...CITES.slice(offset), ...CITES.slice(0, offset)];
}

const COLUMNS = [rotated(0), rotated(4), rotated(8), rotated(12)];

function delay(seconds: number): CSSProperties {
  return { '--d': `${seconds}s` } as CSSProperties;
}

export default function Home() {
  return (
    <>
      {/* Without JavaScript the observers never fire, so everything the scenes
          would reveal is unhidden here and the page reads as plain print. */}
      <noscript>
        <style>{`
          .ld-fx, .ld-ticket, .ld-assert, .ld-chip,
          .ld-verdict > span, .ld-stamp > span, .ld-rise > span,
          .ld-hero .ld-kicker, .ld-burn, .ld-cue {
            opacity: 1 !important;
            transform: none !important;
            animation: none !important;
            transition: none !important;
          }
          .ld-assert::after { transform: none !important; }
        `}</style>
      </noscript>

      {/* Act I: the bet. */}
      <section className="ld-dark ld-hero">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-10 pt-16 sm:pt-24">
          <p className="ld-kicker ld-loss">01 · The bet</p>
          <h1 className="ld-title mt-10">
            <span className="ld-rise">
              <span>Insurers deny claims</span>
            </span>
            <span className="ld-rise">
              <span>they would lose on,</span>
            </span>
            <span className="ld-rise">
              <span className="ld-loss">betting you fold.</span>
            </span>
          </h1>

          <div className="ld-burn mt-auto pt-16">
            <p className="ld-burn-label">
              Written off by US hospitals while this page has been open
            </p>
            <p className="ld-burn-num">
              <BurnCounter ratePerSecond={BURN_RATE_PER_SECOND} />
            </p>
            <p className="ld-burn-tail">
              Denied claims nobody appealed: <strong className="ld-loss">$634 every second</strong>,{' '}
              <strong className="ld-loss">$20 billion every year</strong>. Not because the denials
              were right. Because answering one costs 40 minutes nobody has.
            </p>
          </div>

          <p className="ld-cue" aria-hidden="true">
            <span className="ld-cue-line" />
            <span className="ld-cue-word">Scroll</span>
          </p>
        </div>
      </section>

      {/* Act II: the odds. */}
      <Scene>
        <div className="mx-auto max-w-6xl px-5 py-24 sm:py-32">
          <p className="ld-kicker text-denied">02 · The odds</p>
          <h2 className="ld-h2 mt-6">This morning, ten denials.</h2>

          <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {TICKETS.map((ticket, i) => (
              <div
                key={ticket.id}
                className={`ld-ticket ld-${ticket.fate}`}
                style={{ '--i': i } as CSSProperties}
              >
                <p className="id text-2xs font-semibold tracking-wider">{ticket.id}</p>
                <p className="mt-1 text-xs font-medium leading-snug">{ticket.kind}</p>
                <p className="ld-amt tnum mt-3 text-lg font-bold">{ticket.amount}</p>
                <span className="ld-verdict" aria-hidden="true">
                  <span>{VERDICT[ticket.fate]}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Scene>

      <Scene>
        <div className="mx-auto max-w-6xl space-y-5 px-5 pb-24 sm:pb-32">
          <p className="ld-big ld-fx ld-loss">$12,179 written off without a fight.</p>
          <p className="ld-big ld-fx ld-win" style={delay(0.2)}>
            $21,433 recovered by the four appeals that got sent.
          </p>
          <p className="ld-big ld-fx" style={delay(0.4)}>
            Same denials. Same merits. The only variable is{' '}
            <strong>whether anyone answers</strong>.
          </p>
        </div>
      </Scene>

      {/* Act III: the letter. */}
      <section className="rule-t bg-paper-2">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:py-32">
          <Scene>
            <p className="ld-kicker ld-fx">03 · The letter</p>
            <h2 className="ld-h2 ld-fx mt-6 max-w-4xl" style={delay(0.15)}>
              Medeal writes the appeal the plan bet you would never send.
            </h2>
          </Scene>

          <div className="mt-14 grid gap-10 lg:grid-cols-2">
            <Scene className="ld-scene-letter">
              <div className="ld-doc">
                <p className="id text-2xs font-semibold uppercase tracking-widest">
                  Plan medical review · Claim 2214-0087
                </p>
                <div className="document mt-6 space-y-4 pr-8">
                  <p>Coverage for the inpatient admission of March 14 is denied.</p>
                  <p>
                    Review against our clinical guidelines determined that the services could
                    have been provided at a lower level of care. Criteria for medical necessity
                    were not met.
                  </p>
                  <p>You have the right to appeal this determination within 60 days.</p>
                </div>
                <span className="ld-stamp ld-stamp-denied" aria-hidden="true">
                  <span>Denied</span>
                </span>
              </div>
            </Scene>

            <Scene>
              <div className="ld-doc">
                <p className="id text-2xs font-semibold uppercase tracking-widest">
                  Appeal · Draft 1 · Every assertion sourced
                </p>
                <div className="mt-6 space-y-7">
                  {ASSERTIONS.map((assertion, i) => (
                    <div key={assertion.cites[0]} className="ld-assert" style={delay(0.25 + i * 0.45)}>
                      <p className="document">{assertion.text}</p>
                      <p className="mt-3 flex flex-wrap gap-2">
                        {assertion.cites.map((cite) => (
                          <span key={cite} className="ld-chip" style={delay(0.25 + i * 0.45)}>
                            {cite}
                          </span>
                        ))}
                      </p>
                    </div>
                  ))}
                </div>
                <span className="ld-stamp ld-stamp-verified" aria-hidden="true">
                  <span>Verified</span>
                </span>
              </div>
            </Scene>
          </div>

          <Scene>
            <p className="ld-fx mt-14 max-w-3xl text-lg font-medium leading-relaxed">
              In the product, <strong>every sentence is click-to-source</strong>: the exact
              passage of the decision, or the exact line of your record, opens beside the letter,
              highlighted.{' '}
              <strong className="text-denied">
                A draft with one unverified claim is thrown out whole
              </strong>{' '}
              and regenerated, never patched. Nothing gets papered over.
            </p>
          </Scene>
        </div>
      </section>

      {/* Act IV: the record. */}
      <Scene className="ld-dark">
        <div className="ld-wall">
          <div className="ld-cols" aria-hidden="true">
            {COLUMNS.map((column, columnIndex) => (
              <div key={columnIndex} className="ld-colwrap">
                <div
                  className={columnIndex % 2 === 1 ? 'ld-col ld-col-rev' : 'ld-col'}
                  style={{ '--dur': `${36 + columnIndex * 7}s` } as CSSProperties}
                >
                  {[...column, ...column].map((cite, i) => (
                    <span key={i} className={cite === HOT_CITE ? 'ld-cite ld-cite-hot' : 'ld-cite'}>
                      {cite}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="ld-wall-overlay">
            <div className="ld-card ld-fx">
              <p className="ld-kicker ld-win">04 · The record</p>
              <h2 className="ld-h2 mt-5">The arguments that win are public record.</h2>
              <p className="mt-5 text-lg font-medium leading-relaxed">
                Every Medicare appeal that reaches the Departmental Appeals Board becomes a
                published decision: the argument made, the facts that mattered, who won.{' '}
                <strong className="ld-win">Thousands of decisions, read by almost nobody.</strong>{' '}
                Medeal indexes every holding against the passage it came from and retrieves the
                ones that already won your argument.
              </p>
            </div>
          </div>
        </div>
      </Scene>

      {/* Act V: the math. */}
      <section className="mx-auto max-w-6xl px-5 py-24 sm:py-32">
        <p className="ld-kicker text-denied">05 · The math</p>
        <div className="mt-12 space-y-12">
          <Scene>
            <div className="ld-fx">
              <p className="ld-stat-num text-denied">
                <CountUp to={20000000000} prefix="$" duration={2200} />
              </p>
              <p className="ld-stat-cap">
                in denied claims written off by US hospitals, <strong>every single year</strong>.
              </p>
            </div>
          </Scene>
          <Scene className="rule-t">
            <div className="ld-fx pt-12">
              <p className="ld-stat-num text-denied">
                <CountUp to={60} suffix="%" duration={1400} />
              </p>
              <p className="ld-stat-cap">
                of denials are <strong className="text-denied">never appealed at all</strong>.
                The majority of the appeals that do get filed are overturned.
              </p>
            </div>
          </Scene>
          <Scene className="rule-t">
            <div className="ld-fx pt-12">
              <p className="ld-stat-num text-recovered">$0</p>
              <p className="ld-stat-cap">
                is what Medeal costs until money actually comes back. No subscription, no seat
                licence, no implementation fee.{' '}
                <strong className="text-recovered">A share of the recovery</strong>, and otherwise
                nothing.{' '}
                <Link href="/pricing" className="font-semibold">
                  Read the pricing
                </Link>
                .
              </p>
            </div>
          </Scene>
        </div>
      </section>

      {/* Act VI: the call. */}
      <Scene className="ld-dark ld-final">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-start justify-center px-5 py-28">
          <p className="ld-kicker ld-win ld-fx">06 · The call</p>
          <h2 className="ld-title ld-fx mt-8" style={delay(0.15)}>
            Start with
            <br />
            one denial.
          </h2>
          <p className="ld-fx mt-8 max-w-2xl text-lg font-medium leading-relaxed sm:text-xl" style={delay(0.3)}>
            Bring one denial letter and the matching record to a 30 minute call. You leave with a
            drafted appeal and <strong className="ld-win">every citation resolvable</strong>.
            Until a business associate agreement is in place, we work from a redacted copy.
          </p>
          <p className="ld-fx mt-12 flex flex-wrap items-center gap-6" style={delay(0.45)}>
            <Link href="/demo" className="ld-cta on-action">
              Request a demo
            </Link>
            <Link href="/how-it-works" className="ld-final-alt">
              See how it works
            </Link>
          </p>
        </div>
      </Scene>
    </>
  );
}
