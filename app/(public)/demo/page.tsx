import type { Metadata } from 'next';
import { DemoRequestForm } from './form';

export const metadata: Metadata = {
  title: 'Request a demo',
  description:
    'Bring one denial. We run it through the system on a 30 minute call and show you the drafted appeal with every citation resolvable.',
};

export default function DemoPage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-12 px-5 py-14 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="text-3xl">Request a demo</h1>
        <p className="mt-4 max-w-xl font-semibold">
          Thirty minutes. Bring one real denial letter and the clinical record
          that goes with it, and we run it through the system while you watch.
        </p>
        <DemoRequestForm />
      </div>

      <aside className="lg:pt-16">
        <div className="border border-rule bg-paper-2 p-5">
          <h2 className="text-sm font-semibold">What happens on the call</h2>
          <ol className="mt-3 space-y-3 text-sm font-semibold">
            <li>
              <span className="id text-xs text-ink">01</span>
              <p className="mt-0.5">
                We classify the denial and show you which coverage authority
                controls it.
              </p>
            </li>
            <li>
              <span className="id text-xs text-ink">02</span>
              <p className="mt-0.5">
                You see which criteria your record supports, and which it does
                not. The gaps come first, before any drafting.
              </p>
            </li>
            <li>
              <span className="id text-xs text-ink">03</span>
              <p className="mt-0.5">
                We generate the appeal and you click through the citations. Every
                sentence opens the passage behind it.
              </p>
            </li>
          </ol>
        </div>

        <div className="mt-4 border border-rule bg-paper-2 p-5">
          <h2 className="text-sm font-semibold">Before a contract is signed</h2>
          <p className="mt-2 text-sm font-semibold">
            We are not yet operating under a business associate agreement, so we
            work from a redacted copy of your documents. Nothing you bring to a
            demo needs to contain patient identifiers.
          </p>
        </div>
      </aside>
    </div>
  );
}
