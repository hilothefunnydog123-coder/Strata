import { SiteNav, SiteFooter } from "@/components/Chrome";
import { DemoForm } from "@/components/DemoForm";
import { PRODUCT } from "@assent/core";

export default function Contact() {
  return (
    <>
      <SiteNav />
      <main id="main" className="mx-auto max-w-6xl px-5">
        <section className="pt-14 pb-16 grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:items-start">
          <div>
            <h1 className="font-serif text-[32px] text-ink">Contact</h1>
            <p className="mt-3 text-[14px] leading-relaxed text-chrome-700 max-w-reading">
              The fastest way to start is to tell us your indication and codes. For anything
              else, reach us directly.
            </p>
            <dl className="mt-6 grid gap-3 text-[14px]">
              <div><dt className="a-mono text-[11px] uppercase tracking-wide text-chrome-500">Email</dt>
                <dd className="a-mono text-ink">{PRODUCT.supportEmail}</dd></div>
              <div><dt className="a-mono text-[11px] uppercase tracking-wide text-chrome-500">Access</dt>
                <dd className="text-chrome-700">Accounts are provisioned by an administrator after a contract is signed. There is no self-service signup.</dd></div>
            </dl>
          </div>
          <DemoForm />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
