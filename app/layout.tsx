import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { themeInitScript } from "@/components/shell/ThemeToggle";
import { SimulationProvider } from "@/lib/simulation";

export const metadata: Metadata = {
  title: {
    default: "Strata — Healthcare AI Control Plane",
    template: "%s · Strata",
  },
  description:
    "The visibility, monitoring, governance, validation, and control layer for healthcare AI. Northstar Health System.",
};

export const viewport: Viewport = {
  themeColor: "#090C11",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-fg antialiased">
        <SimulationProvider>
          <AppShell>{children}</AppShell>
        </SimulationProvider>
      </body>
    </html>
  );
}
