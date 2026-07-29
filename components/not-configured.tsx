import { envStatus } from '@/lib/env';

/**
 * The banner an unconfigured deployment wears.
 *
 * A deployment with no environment set renders its public pages so that the
 * design and the copy can be looked at, which is the whole point of a first
 * deploy. What it must not do is let anyone mistake that for a working
 * application, so it says what is missing, on every page, without ceremony.
 *
 * Rendered by the root layout, so no page can forget it. Returns nothing at all
 * once the deployment is configured, which is the ordinary case.
 */
export function NotConfiguredBanner() {
  const status = envStatus();
  if (status.configured) return null;

  return (
    <div className="border-b-2 border-denied bg-denied-wash px-5 py-2.5">
      <p className="mx-auto max-w-5xl text-sm">
        <span className="font-semibold text-denied">Not configured.</span>{' '}
        <span className="text-ink">
          This deployment has no database and no secrets, so nothing beyond these
          public pages works: sign in, uploads and appeals are all unavailable.
          Set{' '}
        </span>
        <span className="id text-xs">{status.missing.join(', ')}</span>
        <span className="text-ink"> and deploy again.</span>
      </p>
    </div>
  );
}

/**
 * The body of a page that cannot render without configuration. Says the same
 * thing as the banner at more length, in the place the working surface would
 * have been, so a dead link leads to an explanation rather than a stack trace.
 */
export function NotConfiguredPage({ surface }: { surface: string }) {
  const status = envStatus();

  return (
    <div className="mx-auto max-w-2xl px-5 py-16">
      <p className="id text-xs uppercase tracking-widest text-ink-2">Medeal</p>
      <h1 className="mt-4 text-2xl">{surface} is not available yet</h1>
      <p className="mt-4 text-ink-2">
        This deployment has not been configured. There is no database behind it,
        so there are no accounts to sign in to and nothing to show. The public
        pages are here to be looked at; everything else waits on configuration.
      </p>
      <p className="mt-4 text-ink-2">These variables are not set:</p>
      <ul className="mt-2 space-y-1">
        {status.missing.map((name) => (
          <li key={name} className="id text-sm">
            {name}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-ink-2">
        Set them in the hosting platform and deploy again. The first operator
        account is created on that deploy, and its one time password is printed
        in the deploy log.
      </p>
    </div>
  );
}
