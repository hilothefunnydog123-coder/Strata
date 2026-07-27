import Link from "next/link";
import { SiteNav, SiteFooter } from "@/components/Chrome";
import { HeroCitation } from "@/components/HeroCitation";
import { DemoForm } from "@/components/DemoForm";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-6xl px-5">
        {/* Hero — real policy prose being marked up, not a big number and a gradient. */}
        <section className="pt-14 pb-16">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <div className="a-mono text-[12px] uppercase tracking-wider text-chrome-500 mb-4">
                For market access teams of one
              </div>
              <h1 className="font-serif text-[34px] sm:text-[42px] leading-[1.08] text-ink tracking-tight">
                You are about to bet five years on a guess about what payers will require.
              </h1>
              <p className="mt-5 text-[16px] leading-relaxed text-chrome-700 max-w-reading">
                Every payer publishes what evidence it needs before it will pay — in prose,
                across nine hundred documents nobody has ever read end to end. Assent reads
                them, pulls out each binding requirement, and ties it to the exact sentence it
                came from. Then it shows you the trial design that unlocks the most covered lives.
              </p>
              <div className="mt-7 flex items-center gap-3">
                <Link href="#demo" className="rounded bg-ink text-paper px-4 py-2.5 text-[14px] hover:bg-chrome-700 no-underline">
                  Request a demo
                </Link>
                <Link href="/tour" className="rounded border border-chrome-200 px-4 py-2.5 text-[14px] text-ink hover:bg-chrome-50 no-underline">
                  See the product
                </Link>
              </div>
            </div>
            <HeroCitation />
          </div>
        </section>

        <hr className="a-rule" />

        {/* The thesis, three ways. */}
        <section className="py-16 grid gap-10 md:grid-cols-3">
          {[
            { h: "One corpus, finally structured", p: "CMS, MolDX, and the major commercial payers — every medical policy, every historical version, parsed into the requirements they actually state. Molecular oncology first." },
            { h: "Nothing without a citation", p: "No requirement exists in Assent without a verbatim sentence that is programmatically verified to be in the source. One fabricated requirement would be a liability, so we discard rather than guess." },
            { h: "The frontier, not an answer", p: "Given your indication and codes: this design unlocks 61% of lives; a head-to-head arm takes you to 84%; the last 16% needs a prospective outcomes study. A cost/benefit decision a CEO can make." },
          ].map((c) => (
            <div key={c.h}>
              <h3 className="font-serif text-[19px] text-ink mb-2">{c.h}</h3>
              <p className="text-[14px] leading-relaxed text-chrome-700">{c.p}</p>
            </div>
          ))}
        </section>

        <hr className="a-rule" />

        {/* How it works — the pipeline, quietly. */}
        <section className="py-16">
          <h2 className="font-serif text-[26px] text-ink mb-8">From published prose to a defensible trial decision</h2>
          <ol className="grid gap-px bg-chrome-200 rounded-lg overflow-hidden md:grid-cols-4">
            {[
              ["01", "Ingest", "Every policy and every revision, fetched and preserved byte-for-byte."],
              ["02", "Extract", "Each binding requirement pulled out with its minimal supporting quote — and verified."],
              ["03", "Diff", "Version to version, what tightened and what loosened. The ten percent that isn't noise."],
              ["04", "Blueprint", "Requirements clustered across payers, weighted by covered lives, ranked by lives unlocked."],
            ].map(([n, h, p]) => (
              <li key={n} className="bg-paper p-5">
                <div className="a-mono text-[12px] text-citation">{n}</div>
                <div className="font-medium text-ink mt-1">{h}</div>
                <p className="text-[13px] leading-relaxed text-chrome-500 mt-1.5">{p}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Demo. */}
        <section id="demo" className="py-16 grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:items-start scroll-mt-16">
          <div>
            <h2 className="font-serif text-[26px] text-ink">Request a demo</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-chrome-700 max-w-reading">
              Tell us your indication and codes. We will walk you through the requirements
              your payers actually state, and where your evidence stands against them. Assent
              is sold to teams under contract — there is no self-service signup.
            </p>
          </div>
          <DemoForm />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
