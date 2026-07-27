import { SiteNav, SiteFooter } from "@/components/Chrome";
import { PRODUCT } from "@assent/core";

export const metadata = { title: `Terms — ${PRODUCT.name}` };

export default function Terms() {
  return (
    <>
      <SiteNav />
      <main id="main" className="mx-auto max-w-reading px-5 py-14 font-serif text-ink">
        <h1 className="text-[30px] mb-2">Terms of use</h1>
        <p className="a-mono text-[12px] text-chrome-500 mb-8 font-sans">Last updated: {new Date().getFullYear()}</p>
        <div className="flex flex-col gap-5 text-[15px] leading-relaxed text-chrome-900">
          <p>This is a product prototype. These plain-language terms describe how the {PRODUCT.name} service would be offered by {PRODUCT.legalName}.</p>
          <h2 className="font-sans text-[15px] font-semibold uppercase tracking-wide text-chrome-500 mt-3">Access</h2>
          <p>{PRODUCT.name} is licensed to organizations under a written agreement. Accounts and seats are provisioned by an administrator. Access is per-seat and non-transferable.</p>
          <h2 className="font-sans text-[15px] font-semibold uppercase tracking-wide text-chrome-500 mt-3">Not medical, legal, or reimbursement advice</h2>
          <p>{PRODUCT.name} organizes published coverage policy and attributes every requirement to its source. It is a research instrument. Coverage and payment decisions rest with payers; you are responsible for verifying any requirement against the cited source before relying on it.</p>
          <h2 className="font-sans text-[15px] font-semibold uppercase tracking-wide text-chrome-500 mt-3">Source materials</h2>
          <p>Policy documents are the property of their publishers. {PRODUCT.name} indexes and cites them; it does not grant you rights to redistribute payer policy text.</p>
          <h2 className="font-sans text-[15px] font-semibold uppercase tracking-wide text-chrome-500 mt-3">Contact</h2>
          <p className="font-sans a-mono text-[14px]">{PRODUCT.supportEmail}</p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
