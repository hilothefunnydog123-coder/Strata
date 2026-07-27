import Link from "next/link";
import { PRODUCT } from "@assent/core";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-baseline gap-1.5 no-underline ${className}`}>
      <span className="font-serif text-[19px] font-semibold text-ink tracking-tight">{PRODUCT.name}</span>
      <span className="a-stance-dot" style={{ background: "var(--a-citation)", width: 6, height: 6 }} aria-hidden />
    </Link>
  );
}

export function SiteNav() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-paper/85 border-b border-chrome-200">
      <nav className="mx-auto max-w-6xl px-5 h-14 flex items-center justify-between">
        <Wordmark />
        <div className="flex items-center gap-1 sm:gap-2 text-[13px]">
          <Link href="/tour" className="px-3 py-1.5 rounded text-chrome-700 hover:text-ink no-underline">Product tour</Link>
          <Link href="/contact" className="px-3 py-1.5 rounded text-chrome-700 hover:text-ink no-underline">Contact</Link>
          <Link href="/login" className="px-3 py-1.5 rounded text-chrome-700 hover:text-ink no-underline">Sign in</Link>
          <Link href="/#demo" className="px-3.5 py-1.5 rounded bg-ink text-paper hover:bg-chrome-700 no-underline">Request a demo</Link>
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-chrome-200 mt-24">
      <div className="mx-auto max-w-6xl px-5 py-10 flex flex-col sm:flex-row justify-between gap-6 text-[13px] text-chrome-500">
        <div className="max-w-sm">
          <Wordmark />
          <p className="mt-2 leading-relaxed">The queryable specification of US coverage policy. Accounts are provisioned after a contract is signed — there is no self-service signup, by design.</p>
        </div>
        <div className="flex gap-10">
          <div className="flex flex-col gap-1.5">
            <span className="a-mono text-[11px] uppercase tracking-wide text-chrome-300">Product</span>
            <Link href="/tour" className="text-chrome-700 hover:text-ink no-underline">Tour</Link>
            <Link href="/#demo" className="text-chrome-700 hover:text-ink no-underline">Request a demo</Link>
            <Link href="/login" className="text-chrome-700 hover:text-ink no-underline">Sign in</Link>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="a-mono text-[11px] uppercase tracking-wide text-chrome-300">Legal</span>
            <Link href="/legal/privacy" className="text-chrome-700 hover:text-ink no-underline">Privacy</Link>
            <Link href="/legal/terms" className="text-chrome-700 hover:text-ink no-underline">Terms</Link>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-5 pb-8 a-mono text-[11px] text-chrome-300">
        © {new Date().getFullYear()} {PRODUCT.legalName} · Not affiliated with any payer. Policy text belongs to its publishers.
      </div>
    </footer>
  );
}
