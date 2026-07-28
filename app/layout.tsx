import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Public_Sans, Source_Serif_4 } from 'next/font/google';
import './globals.css';

/**
 * Three typefaces, three jobs.
 *
 * Public Sans is the typeface of the US Web Design System, which is what
 * federal agencies publish in. For a product whose entire argument rests on
 * federal coverage rules, that is a deliberate borrowing rather than a taste
 * call. Plex Mono carries identifiers. Source Serif carries documents.
 */
const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-public-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-source-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Strata: appeal the denials you are writing off',
    template: '%s | Strata',
  },
  description:
    'Most denied claims are never appealed. Most that are appealed succeed. Strata drafts the appeal, cites every assertion to a published decision or a line in the record, and takes a share of what it recovers.',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f6f5f1',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${plexMono.variable} ${sourceSerif.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
