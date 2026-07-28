import type { Metadata } from 'next';
import { TwoFactorForm } from './two-factor-form';

export const metadata: Metadata = {
  title: 'Two-factor code',
  robots: { index: false, follow: false },
};

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safe = next?.startsWith('/') && !next.startsWith('//') ? next : undefined;
  return <TwoFactorForm next={safe} />;
}
