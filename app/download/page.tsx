import type { Metadata } from "next";
import Link from "next/link";
import { Apple, Check, Download, Monitor, ShieldCheck, Terminal } from "lucide-react";
import { Brand } from "@/components/shell/Brand";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Download Strata Desktop",
  description: "The Strata console as a native desktop application for macOS, Windows, and Linux.",
};

const RELEASES = "https://github.com/hilothefunnydog123-coder/Strata/releases/latest";

const PLATFORMS = [
  { icon: Apple, name: "macOS", file: "Apple silicon & Intel · .dmg", href: RELEASES },
  { icon: Monitor, name: "Windows", file: "Windows 10/11 · .exe installer", href: RELEASES },
  { icon: Terminal, name: "Linux", file: "AppImage · x86_64", href: RELEASES },
];

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-edge">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link href="/">
            <Brand subtitle={false} />
          </Link>
          <ButtonLink href="/login" variant="secondary" size="sm">
            Sign in
          </ButtonLink>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-16">
        <div className="text-center">
          <div className="text-2xs font-bold uppercase tracking-[0.16em] text-accent">Strata Desktop</div>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-fg sm:text-5xl">
            The console, on your desktop.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base font-medium leading-relaxed text-fg-muted">
            A dedicated, always-signed-in window for your team. Same console, native app, no browser
            tab to lose.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PLATFORMS.map((p) => (
            <div key={p.name} className="flex flex-col items-center rounded-xl border border-edge bg-panel p-6 text-center">
              <p.icon className="h-8 w-8 text-fg" />
              <h3 className="mt-3 text-lg font-bold text-fg">{p.name}</h3>
              <p className="mt-1 text-2xs font-semibold text-fg-dim">{p.file}</p>
              <ButtonLink href={p.href} variant="primary" size="md" className="mt-4 w-full">
                <Download className="h-4 w-4" />
                Download
              </ButtonLink>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-edge bg-panel p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-positive" />
            <div>
              <h3 className="text-base font-bold text-fg">Signed and trusted</h3>
              <p className="mt-1 text-sm font-medium leading-relaxed text-fg-muted">
                Production builds are code-signed and notarized, so macOS Gatekeeper and Windows
                SmartScreen open them without a warning. Signing uses your organization's Apple
                Developer ID and an Authenticode certificate, configured once as CI secrets. Until
                those are set, installers open with the standard first-run prompt for an unsigned
                app.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-edge bg-panel p-6">
          <h3 className="text-base font-bold text-fg">Run it from source today</h3>
          <p className="mt-1 text-sm font-medium text-fg-muted">
            No download needed to try it as a desktop app:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-edge bg-canvas p-4 font-mono text-xs text-fg-muted">
{`npm install
npm run dev            # terminal 1
cd desktop
npm install
npm run dev            # terminal 2 -> opens the Strata window`}
          </pre>
          <div className="mt-3 space-y-1.5">
            {[
              "Boots straight to sign-in, then the full console.",
              "External links open in your browser; app stays in-window.",
              "Package installers with electron-builder for distribution.",
            ].map((t) => (
              <div key={t} className="flex items-center gap-2 text-sm font-medium text-fg-muted">
                <Check className="h-4 w-4 shrink-0 text-positive" />
                {t}
              </div>
            ))}
          </div>
        </div>

        <p className="mt-8 text-center text-xs font-medium text-fg-dim">
          <Link href="/" className="text-accent hover:underline">
            Back to strata.health
          </Link>
        </p>
      </main>
    </div>
  );
}
