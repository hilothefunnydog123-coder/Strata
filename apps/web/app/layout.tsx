import type { Metadata } from "next";
import { PRODUCT } from "@assent/core";
import "./globals.css";

export const metadata: Metadata = {
  title: `${PRODUCT.name} — ${PRODUCT.tagline}`,
  description:
    "Assent turns the public but unreadable corpus of US health-insurance coverage policy into a queryable specification — every requirement traced to the exact source sentence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
