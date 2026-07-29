import Link from 'next/link';
import { PhiBanner } from '@/components/phi-banner';
import { SignOutButton } from '@/components/sign-out-button';
import type { Principal } from '@/lib/auth/guards';

export interface NavItem {
  href: string;
  label: string;
}

/**
 * The frame every authenticated surface sits in.
 *
 * A single rule separates chrome from content, and the chrome is deliberately
 * plain: a wordmark, the surface name, the navigation, who you are signed in
 * as. Anything with visual weight in this product is a number or a document,
 * and the frame should not compete with either.
 */
export function Shell({
  surface,
  nav,
  principal,
  context,
  children,
}: {
  surface: string;
  nav: NavItem[];
  principal: Principal;
  context?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <PhiBanner />

      <header className="border-b border-rule bg-paper-2">
        <div className="flex h-12 items-center gap-4 px-4">
          <Link
            href="/"
            className="id text-xs font-semibold uppercase tracking-widest text-ink no-underline"
          >
            Medeal
          </Link>
          <span className="text-xs uppercase tracking-wider text-ink-2">{surface}</span>

          <nav aria-label={`${surface} sections`} className="ml-4 flex items-center gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-[3px] px-2 py-1 text-sm text-ink no-underline hover:bg-paper-sunk"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {context}
            <span className="hidden text-xs text-ink-2 sm:inline">{principal.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
