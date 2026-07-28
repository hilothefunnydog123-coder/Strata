import { requirePrincipal, assertPlatform } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { count, eq } from 'drizzle-orm';
import { denial, demoRequest, organization, sourceDocument, user } from '@/lib/db/schema';
import Link from 'next/link';

export const metadata = { title: 'Operator overview' };

export default async function AdminOverview() {
  const principal = await requirePrincipal();
  assertPlatform(principal, 'admin:organizations');

  const [orgs, users, denials, docs, newRequests] = await Promise.all([
    db.select({ n: count() }).from(organization).where(eq(organization.status, 'active')),
    db.select({ n: count() }).from(user).where(eq(user.status, 'active')),
    db.select({ n: count() }).from(denial),
    db.select({ n: count() }).from(sourceDocument),
    db.select({ n: count() }).from(demoRequest).where(eq(demoRequest.status, 'new')),
  ]);

  const tiles = [
    { label: 'Active organisations', value: orgs[0]?.n ?? 0, href: '/admin/organizations' },
    { label: 'Active users', value: users[0]?.n ?? 0, href: '/admin/users' },
    { label: 'Denials on the platform', value: denials[0]?.n ?? 0, href: '/admin/appeals' },
    { label: 'Corpus documents', value: docs[0]?.n ?? 0, href: '/admin/corpus' },
    { label: 'Demo requests unread', value: newRequests[0]?.n ?? 0, href: '/admin/demo-requests' },
  ];

  return (
    <div className="p-4">
      <h1 className="text-lg">Platform</h1>
      <div className="mt-3 grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="bg-paper-2 p-3 no-underline hover:bg-paper">
            <p className="text-2xs uppercase tracking-wider text-ink-2">{t.label}</p>
            <p className="tnum mt-1 text-2xl font-semibold text-ink">{t.value.toLocaleString('en-US')}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
