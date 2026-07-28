import Link from 'next/link';

export default function Forbidden() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <p className="id text-xs uppercase tracking-widest text-denied">403</p>
      <h1 className="mt-3 text-2xl">You do not have access to this</h1>
      <p className="mt-2 text-sm text-ink-2">
        Your account is signed in, but your role does not reach this surface. If
        you think it should, ask your administrator to change it. Nothing you did
        here was recorded against the record you were trying to reach.
      </p>
      <p className="mt-6">
        <Link href="/" className="text-sm font-medium">
          Back to the start
        </Link>
      </p>
    </main>
  );
}
