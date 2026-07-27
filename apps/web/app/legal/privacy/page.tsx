import { SiteNav, SiteFooter } from "@/components/Chrome";
import { PRODUCT } from "@assent/core";

export const metadata = { title: `Privacy — ${PRODUCT.name}` };

export default function Privacy() {
  return (
    <>
      <SiteNav />
      <main id="main" className="mx-auto max-w-reading px-5 py-14 font-serif text-ink">
        <h1 className="text-[30px] mb-2">Privacy</h1>
        <p className="a-mono text-[12px] text-chrome-500 mb-8 font-sans">Last updated: {new Date().getFullYear()}</p>
        <div className="flex flex-col gap-5 text-[15px] leading-relaxed text-chrome-900">
          <p>This is a product prototype. This page describes how {PRODUCT.legalName} would handle information for the {PRODUCT.name} service, written plainly.</p>
          <h2 className="font-sans text-[15px] font-semibold uppercase tracking-wide text-chrome-500 mt-3">What we collect</h2>
          <p>Demo requests you submit (name, work email, company, role, and your message). Account holders additionally have an email, a password hash, and a TOTP secret used only for sign-in.</p>
          <h2 className="font-sans text-[15px] font-semibold uppercase tracking-wide text-chrome-500 mt-3">Source policy text</h2>
          <p>The coverage policies indexed by {PRODUCT.name} are published by payers and by CMS. We preserve them for analysis and attribute every extracted requirement to its source document. We do not claim ownership of payer policy text.</p>
          <h2 className="font-sans text-[15px] font-semibold uppercase tracking-wide text-chrome-500 mt-3">What we do not do</h2>
          <p>We do not sell personal information. We do not use your submitted materials to train third-party models. There is no self-service signup, so we do not collect data from anonymous visitors beyond standard, minimal server logs.</p>
          <h2 className="font-sans text-[15px] font-semibold uppercase tracking-wide text-chrome-500 mt-3">Contact</h2>
          <p className="font-sans a-mono text-[14px]">{PRODUCT.supportEmail}</p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
