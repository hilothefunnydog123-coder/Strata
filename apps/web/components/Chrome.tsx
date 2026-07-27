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

const NAV_LINK =
  "a-focusable rounded px-2.5 py-1.5 text-chrome-700 no-underline hover:bg-chrome-50 hover:text-ink sm:px-3";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-chrome-200 bg-paper">
      <a href="#main" className="a-skip no-underline">
        Skip to content
      </a>
      <nav aria-label="Primary" className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-5">
        <Wordmark />
        <div className="flex items-center gap-0.5 text-[13px] sm:gap-1">
          <Link href="/tour" className={NAV_LINK}>
            <span className="sm:hidden">Tour</span>
            <span className="hidden sm:inline">Product tour</span>
          </Link>
          {/* Narrow screens keep the two decisive links; Contact stays in the footer. */}
          <Link href="/contact" className={`${NAV_LINK} hidden sm:inline-block`}>
            Contact
          </Link>
          <Link href="/login" className={NAV_LINK}>
            Sign in
          </Link>
          <Link
            href="/#demo"
            className="a-focusable ml-1 rounded bg-ink px-3 py-1.5 text-paper no-underline hover:bg-chrome-700 sm:px-3.5"
          >
            <span className="sm:hidden">Demo</span>
            <span className="hidden sm:inline">Request a demo</span>
          </Link>
        </div>
      </nav>
    </header>
  );
}

const FOOT_LINK = "a-focusable rounded text-chrome-700 no-underline hover:text-ink";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-chrome-200">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-12 text-[13px] text-chrome-500 sm:flex-row sm:justify-between">
        <div className="max-w-sm">
          <Wordmark />
          <p className="mt-3 leading-relaxed">
            {PRODUCT.tagline} Accounts are provisioned after a contract is signed — there is no
            self-service signup, by design.
          </p>
        </div>
        <div className="flex gap-10 sm:gap-14">
          <nav aria-label="Product" className="flex flex-col gap-2">
            <span className="a-eyebrow">Product</span>
            <Link href="/tour" className={FOOT_LINK}>
              Tour
            </Link>
            <Link href="/#demo" className={FOOT_LINK}>
              Request a demo
            </Link>
            <Link href="/login" className={FOOT_LINK}>
              Sign in
            </Link>
          </nav>
          <nav aria-label="Company" className="flex flex-col gap-2">
            <span className="a-eyebrow">Company</span>
            <Link href="/contact" className={FOOT_LINK}>
              Contact
            </Link>
            <Link href="/legal/privacy" className={FOOT_LINK}>
              Privacy
            </Link>
            <Link href="/legal/terms" className={FOOT_LINK}>
              Terms
            </Link>
          </nav>
        </div>
      </div>
      <div className="border-t border-chrome-200">
        <div className="mx-auto max-w-6xl px-5 py-5">
          <p className="a-mono text-[11px] leading-relaxed text-chrome-500">
            © {new Date().getFullYear()} {PRODUCT.legalName} · Not affiliated with any payer ·
            Policy text belongs to its publishers.
          </p>
        </div>
      </div>
    </footer>
  );
}
