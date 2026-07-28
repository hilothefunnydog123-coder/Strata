import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <p className="id text-xs uppercase tracking-widest text-ink-2">Strata</p>
      <h1 className="mt-6 text-4xl leading-tight sm:text-5xl">
        Insurers deny claims they would lose on, betting nobody will challenge
        them.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-ink-2">
        Around six in ten denied claims are never appealed, because appealing
        costs half an hour of clinical staff time and most denials are too small
        to justify it. Of the ones that are appealed, most are overturned.
      </p>
      <p className="mt-4 max-w-2xl text-lg text-ink-2">
        Strata writes the appeal. Every legal assertion cites a published
        decision or a regulation. Every clinical assertion cites a line in your
        record. You pay a share of what we recover and nothing otherwise.
      </p>
      <p className="mt-10">
        <Link href="/demo" className="font-medium underline">
          Request a demo
        </Link>
      </p>
    </main>
  );
}
