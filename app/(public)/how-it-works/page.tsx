import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'Upload, classify, retrieve the controlling authority, check the record against the criteria, draft, verify every citation, two human reviews, export, track the outcome.',
};

const STEPS = [
  {
    n: '01',
    title: 'You upload the denial letter and the record',
    body: 'The denial letter and whatever clinical documentation supports the stay. Both get parsed into located passages, so every later reference points at a character range in a real page rather than at a document in general.',
  },
  {
    n: '02',
    title: 'The system classifies the denial',
    body: 'Medical necessity, level of care, not a covered benefit, insufficient documentation, or proprietary criteria applied. The classification cites the language in the letter that establishes it, so you can check the reasoning rather than take it.',
  },
  {
    n: '03',
    title: 'It retrieves the controlling authority',
    body: 'The regulation and manual section that govern, plus the published decisions where this argument prevailed on facts like yours, filtered by service type, payer type, and denial basis.',
  },
  {
    n: '04',
    title: 'It checks your record against the criteria, and tells you what is missing',
    body: 'Each coverage criterion is matched to a fact in your record. Any criterion with nothing behind it is surfaced as a documentation gap before drafting starts. We do not write around a gap with careful language. You get told which criterion is unsupported so you can decide what to do.',
  },
  {
    n: '05',
    title: 'It drafts the appeal, then verifies every assertion',
    body: 'The letter is generated as individual assertions, each with the source it came from and the exact words it relies on. Every one is then checked against that source. If any fails, the whole draft is discarded and regenerated. A letter with an unverified claim in it never reaches a person.',
  },
  {
    n: '06',
    title: 'A clinician reviews it',
    body: 'A clinical reviewer works through the assertions one at a time, each shown next to the line of the record it cites, and marks it verified or flags it. They can approve, reject with notes, or edit. An edited sentence is re-verified against its source before it counts.',
  },
  {
    n: '07',
    title: 'A lawyer reviews it',
    body: 'A legal reviewer checks that every citation resolves and that the decision cited actually supports the assertion made. This is the last gate. Export is blocked until both reviews are approved.',
  },
  {
    n: '08',
    title: 'You export it and file it',
    body: 'A DOCX for editing and a PDF for the record, both with a citation appendix listing every source relied on. You file it through your normal channel.',
  },
  {
    n: '09',
    title: 'You record what happened',
    body: 'Won, lost, partial, or withdrawn, with the amount recovered and the remittance evidence attached. That is what the invoice is computed from, so outcome tracking is the billing system rather than a report nobody reads.',
  },
];

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <h1 className="text-3xl">How it works</h1>
      <p className="mt-4 text-lg text-ink-2">
        Nine steps, two of which are people. The humans in the loop are not
        something we are working towards removing. They are why a hospital can
        put its name on the letter.
      </p>

      <ol className="mt-10 space-y-8">
        {STEPS.map((step) => (
          <li key={step.n} className="rule-t pt-5">
            <p className="id text-xs text-ink-2">{step.n}</p>
            <h2 className="mt-1 text-lg">{step.title}</h2>
            <p className="mt-2 text-ink-2">{step.body}</p>
          </li>
        ))}
      </ol>

      <section className="mt-14 border border-rule bg-paper-2 p-5">
        <h2 className="text-lg">What we will not do</h2>
        <ul className="mt-3 space-y-2 text-ink-2">
          <li>
            We do not assert anything about a patient that is not quoted from
            your record.
          </li>
          <li>
            We do not cite a decision without a verbatim quote from it that has
            been checked to exist.
          </li>
          <li>
            We do not hide a documentation gap behind language. You see it before
            we draft.
          </li>
          <li>
            We do not send a letter to review that failed verification. It is
            regenerated instead.
          </li>
        </ul>
      </section>

      <p className="mt-10">
        <Link href="/demo" className="font-medium">
          Request a demo
        </Link>
      </p>
    </div>
  );
}
