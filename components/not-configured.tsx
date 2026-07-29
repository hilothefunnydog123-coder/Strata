import { envStatus } from '@/lib/env';

/**
 * The body of a page that cannot render without configuration.
 *
 * Shown in the place the working surface would have been, so a dead link leads
 * to an explanation rather than a stack trace. There is deliberately no banner
 * on the public pages: those are static marketing that reads correctly whether
 * or not a database exists, and a warning across them tells a visitor something
 * true but useless about a page that is working perfectly.
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
