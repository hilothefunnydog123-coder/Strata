import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Instrument_Serif, Public_Sans, Source_Serif_4 } from 'next/font/google';
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

/**
 * The fourth face has exactly one stage: the landing page's headlines. A
 * display serif at 100 point does what Source Serif at document sizes should
 * never try, and nothing outside the landing may reach for it.
 */
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Medeal: appeal the denials you are writing off',
    template: '%s | Medeal',
  },
  description:
    'Most denied claims are never appealed. Most that are appealed succeed. Medeal drafts the appeal, cites every assertion to a published decision or a line in the record, and takes a share of what it recovers.',
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
      className={`${publicSans.variable} ${plexMono.variable} ${sourceSerif.variable} ${instrumentSerif.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
