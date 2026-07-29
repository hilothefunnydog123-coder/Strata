import Link from 'next/link';

/**
 * The public site frame.
 *
 * No sign-up link anywhere, because there is no sign-up. Accounts are
 * provisioned by the operator, and pretending otherwise on the marketing site
 * would be the first thing a visitor found untrue.
 */
const NAV = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/security', label: 'Security' },
  { href: '/contact', label: 'Contact' },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
          <Link
            href="/"
            className="id text-sm font-semibold uppercase tracking-widest text-ink no-underline"
          >
            Medeal
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-ink no-underline hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <Link href="/sign-in" className="text-sm no-underline hover:underline">
              Sign in
            </Link>
            <Link
              href="/demo"
              className="on-action rounded-[3px] border border-action bg-action px-3 py-1.5 text-sm font-medium text-white no-underline hover:bg-[#163d76]"
            >
              Request a demo
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="rule-t mt-16">
        <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-6 px-5 py-8 text-sm">
          <div>
            <p className="id text-xs uppercase tracking-widest text-ink-2">Medeal</p>
            <p className="mt-2 max-w-xs text-ink-2">
              Appeals for denied hospital claims, argued from published decisions
              and your own record.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-1.5">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="no-underline hover:underline">
                {item.label}
              </Link>
            ))}
            <Link href="/privacy" className="no-underline hover:underline">
              Privacy
            </Link>
            <Link href="/terms" className="no-underline hover:underline">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
