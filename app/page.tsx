import Link from 'next/link';
import type { Metadata, Viewport } from 'next';
import type { CSSProperties } from 'react';
import { Cinescape, Scene } from './cinescape';
import './landing.css';

export const metadata: Metadata = {
  // Absolute, so the root layout's "%s | Medeal" template does not append the
  // name to a title that already carries it.
  title: { absolute: 'Medeal: every denial, answered' },
  description:
    'Medeal reads the denial, names its defects, drafts the appeal from Medicare rules and published decisions, and verifies every quoted word against its source. Your specialist signs.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#050505',
};

/**
 * The landing page is a film: one shaft of light, denial letters adrift,
 * three words and one button. Scrolling plays the process in four acts, in
 * the same frame. No feature grid, no stat tiles, no grey text.
 *
 * It lives outside the (public) route group on purpose: the public shell's
 * paper header and footer would break the frame, and this page carries its
 * own chrome, a wordmark, a sign-in, and links at the end of the reel.
 */

function delay(seconds: number): CSSProperties {
  return { '--d': `${seconds}s` } as CSSProperties;
}

const FINDINGS = [
  {
    title: 'VIOLATION 01 · IMPROVEMENT STANDARD',
    body: (
      <>
        Medicare coverage <strong>does not require improvement</strong>. A denial resting on a
        plateau applies a standard CMS disavowed in the Jimmo v. Sebelius settlement.
      </>
    ),
    law: 'Medicare Benefit Policy Manual ch. 8, sec. 30.2.3.1',
  },
  {
    title: 'VIOLATION 02 · PROPRIETARY CRITERIA',
    body: (
      <>
        A Medicare Advantage plan <strong>must apply Medicare&apos;s coverage criteria</strong>,
        not its own internal guidelines, where Medicare&apos;s rules exist.
      </>
    ),
    law: '42 CFR 422.101(b)(2), (b)(6)',
  },
  {
    title: 'VIOLATION 03 · INVENTED THRESHOLD',
    body: (
      <>
        Medicare&apos;s skilled nursing criteria require daily skilled services and{' '}
        <strong>set no minimum therapy minutes</strong>. The floor was added by the plan.
      </>
    ),
    law: '42 CFR 409.31',
  },
];

export default function Home() {
  return (
    <div className="cine-root">
      {/* Without JavaScript the observers never fire and the papers never
          spawn, so the choreography is unhidden and the page reads as plain
          print on a black stage. */}
      <noscript>
        <style>{`.cine-fx { opacity: 1 !important; transform: none !important; transition: none !important; }`}</style>
      </noscript>

      <Cinescape />

      <header className="cine-chrome">
        <Link href="/" className="cine-wordmark">
          MEDEAL
        </Link>
        <Link href="/sign-in" className="cine-signin">
          SIGN IN
        </Link>
      </header>

      <div className="cine-content">
        {/* The three words. */}
        <Scene>
          <div className="cine-hero">
            <h1 className="cine-h1 cine-fx">
              Every denial,
              <br />
              <span className="cine-it">answered.</span>
            </h1>
            <p className="cine-fx" style={delay(0.35)}>
              <Link href="/demo" className="cine-cta">
                REQUEST A DEMO
              </Link>
            </p>
          </div>
        </Scene>

        {/* Act one: the scan. */}
        <Scene>
          <div className="cine-act">
            <p className="cine-kicker cine-fx">01 · THE SCAN</p>
            <h2 className="cine-h2 cine-fx" style={delay(0.1)}>
              First, we find
              <br />
              <span className="cine-it">what&apos;s wrong with it.</span>
            </h2>
            <p className="cine-copy cine-fx" style={delay(0.2)}>
              Software reads the denial letter before anyone else does, and checks it,
              deterministically, for the defects payers repeat at volume: coverage conditioned on
              improvement, internal guidelines applied where Medicare&apos;s rules govern,
              thresholds no regulation contains. <strong>The denial confesses in writing.</strong>
            </p>

            <div className="cine-doc cine-fx" style={delay(0.3)}>
              <span className="cine-doc-tag">SYNTHETIC DEMONSTRATION</span>
              <p className="cine-doc-head">MERIDIAN HEALTH PLAN</p>
              <p className="cine-doc-meta">Notice of Denial of Medicare Coverage · Claim NRMC-2026-0417</p>
              <p>
                Coverage is denied. Our clinical reviewers applied the{' '}
                <span className="cine-hl">plan&apos;s internal care guidelines</span> and determined
                that the member no longer requires a skilled level of care because{' '}
                <span className="cine-hl">therapy participation has plateaued</span>.
              </p>
              <p>
                The member received{' '}
                <span className="cine-hl">fewer than 720 minutes of therapy per week</span>, which
                does not meet the threshold for continued skilled coverage under our guidelines.
              </p>
              <span className="cine-doc-stamp" aria-hidden="true">
                DENIED
              </span>
            </div>

            <div className="cine-findings">
              {FINDINGS.map((finding, i) => (
                <div key={finding.law} className="cine-finding cine-fx" style={delay(0.4 + i * 0.15)}>
                  <p className="cine-finding-title">{finding.title}</p>
                  <p>{finding.body}</p>
                  <p className="cine-finding-law">{finding.law}</p>
                </div>
              ))}
            </div>
          </div>
        </Scene>

        {/* Act two: the draft. */}
        <Scene>
          <div className="cine-act">
            <p className="cine-kicker cine-fx">02 · THE DRAFT</p>
            <h2 className="cine-h2 cine-fx" style={delay(0.1)}>
              Then the law
              <br />
              <span className="cine-it">writes back.</span>
            </h2>
            <p className="cine-copy cine-fx" style={delay(0.2)}>
              The appeal is drafted from Medicare&apos;s own rules, the clinical record, and
              published decisions where the same denial already lost.{' '}
              <strong>Every sentence carries its source</strong>: a sentence with nothing behind it
              cannot exist, because the sentence and its citation are the same object.
            </p>

            <div className="cine-doc cine-fx" style={delay(0.3)}>
              <span className="cine-doc-tag">SYNTHETIC DEMONSTRATION</span>
              <p className="cine-doc-head">APPEAL OF DENIED CLAIM NRMC-2026-0417</p>
              <p className="cine-doc-meta">Draft 1 · Every assertion sourced</p>
              <p>
                The beneficiary must require skilled nursing or skilled rehabilitation services{' '}
                <span className="cine-hl-quote">on a daily basis</span>.
                <br />
                <span className="cine-doc-cite">42 CFR 409.31(b)(1)</span>
              </p>
              <p>
                The patient required{' '}
                <span className="cine-hl-quote">
                  skilled wound assessment and IV antibiotic administration daily
                </span>
                , furnished by licensed nursing staff.
                <br />
                <span className="cine-doc-cite">Clinical record, progress notes, p. 1</span>
              </p>
              <p>
                A plan may not apply criteria{' '}
                <span className="cine-hl-quote">more restrictive than Traditional Medicare</span>.
                The internal guidelines this denial rests on are exactly that.
                <br />
                <span className="cine-doc-cite">42 CFR 422.101(b)(2)</span>
              </p>
            </div>
          </div>
        </Scene>

        {/* Act three: the check. */}
        <Scene>
          <div className="cine-act">
            <p className="cine-kicker cine-fx">03 · THE CHECK</p>
            <h2 className="cine-h2 cine-fx" style={delay(0.1)}>
              Every word,
              <br />
              <span className="cine-it">checked.</span>
            </h2>
            <p className="cine-copy cine-fx" style={delay(0.2)}>
              Before a person ever reads the draft, software verifies every quoted passage against
              the regulation, the decision, or the record it cites,{' '}
              <strong>character by character</strong>. A draft with one quote that fails the check
              is thrown away whole and rewritten. Never patched, never papered over.
            </p>

            <div className="cine-doc cine-fx" style={delay(0.3)}>
              <span className="cine-doc-tag">SYNTHETIC DEMONSTRATION</span>
              <p className="cine-doc-head">VERIFICATION</p>
              <p className="cine-doc-meta">Run before review · Any failure discards the draft</p>
              <p>
                <span className="cine-hl-quote">on a daily basis</span>
                <br />
                <span className="cine-verify">quote matches source · 42 CFR 409.31(b)(1)</span>
              </p>
              <p>
                <span className="cine-hl-quote">
                  skilled wound assessment and IV antibiotic administration daily
                </span>
                <br />
                <span className="cine-verify">quote matches source · clinical record, p. 1</span>
              </p>
              <p>
                <span className="cine-hl-quote">more restrictive than Traditional Medicare</span>
                <br />
                <span className="cine-verify">quote matches source · 42 CFR 422.101(b)(2)</span>
              </p>
            </div>
          </div>
        </Scene>

        {/* Act four: the signature. */}
        <Scene>
          <div className="cine-act">
            <p className="cine-kicker cine-fx">04 · THE SIGNATURE</p>
            <h2 className="cine-h2 cine-fx" style={delay(0.1)}>
              Your specialist
              <br />
              <span className="cine-it">stays the author.</span>
            </h2>
            <p className="cine-copy cine-fx" style={delay(0.2)}>
              The draft lands in front of your appeals specialist with every citation one click
              from its source. They read it, edit it, sign it, and file it.{' '}
              <strong>Nothing is ever submitted by software.</strong> Medeal drafts; your team
              decides.
            </p>
            <p className="cine-copy cine-fx" style={delay(0.3)}>
              <strong>
                Federal reviewers report that most appealed Medicare Advantage denials are
                overturned, and that fewer than one in ten denials is ever appealed at all.
              </strong>{' '}
              The plans are counting on nobody having time. Now you have time.
            </p>
            <p className="cine-attr cine-fx" style={delay(0.4)}>
              HHS OFFICE OF INSPECTOR GENERAL · KFF · ANALYSES OF CMS DATA
            </p>
          </div>
        </Scene>

        {/* The close. */}
        <Scene>
          <div className="cine-final">
            <h2 className="cine-h1 cine-fx">
              Every denial,
              <br />
              <span className="cine-it">answered.</span>
            </h2>
            <p className="cine-fx" style={delay(0.25)}>
              <Link href="/demo" className="cine-cta">
                REQUEST A DEMO
              </Link>
            </p>
            <nav aria-label="Site" className="cine-endlinks cine-fx" style={delay(0.45)}>
              <Link href="/how-it-works" className="cine-endlink">
                HOW IT WORKS
              </Link>
              <Link href="/pricing" className="cine-endlink">
                PRICING
              </Link>
              <Link href="/security" className="cine-endlink">
                SECURITY
              </Link>
              <Link href="/contact" className="cine-endlink">
                CONTACT
              </Link>
              <Link href="/privacy" className="cine-endlink">
                PRIVACY
              </Link>
              <Link href="/terms" className="cine-endlink">
                TERMS
              </Link>
            </nav>
          </div>
        </Scene>
      </div>
    </div>
  );
}
