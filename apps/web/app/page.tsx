import Link from "next/link";
import { SiteNav, SiteFooter } from "@/components/Chrome";
import { HeroCitation } from "@/components/HeroCitation";
import { DemoForm } from "@/components/DemoForm";

/**
 * The landing page carries as little prose as it can.
 *
 * The hero widget already demonstrates the product — a real policy with its
 * requirements being marked up — so the copy's only job is to name what you get.
 * Every line here is a claim the visitor can check against the thing moving next
 * to it, which is why none of them need a paragraph.
 */

/** What you get. One line each — the widget supplies the proof. */
const VALUE: Array<[string, string]> = [
  ["Every payer, one place", "CMS, MolDX and the major commercial plans, parsed into the requirements they state."],
  ["Every requirement, cited", "Traced to a verbatim sentence in the source. Nothing paraphrased, nothing inferred."],
  ["The design that pays", "Which trial unlocks 61% of covered lives, and what the next arm buys you."],
];

const PIPELINE: Array<[string, string]> = [
  ["01", "Ingest every policy and revision"],
  ["02", "Extract each binding requirement"],
  ["03", "Flag what tightened or loosened"],
  ["04", "Rank by covered lives unlocked"],
];

export default function Home() {
  return (
    <>
      <SiteNav />
      <main id="main" className="mx-auto max-w-6xl px-5">
        {/* Hero — the product doing its one trick, with copy that just names it. */}
        <section className="grid items-center gap-10 pt-16 pb-20 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <div className="a-mono text-[12px] uppercase tracking-wider text-chrome-500">
              Molecular oncology diagnostics
            </div>
            <h1 className="mt-4 font-serif text-[38px] sm:text-[46px] leading-[1.05] tracking-tight text-ink">
              Know what payers require before you design the trial.
            </h1>
            <p className="mt-5 max-w-reading text-[17px] leading-relaxed text-chrome-700">
              Every requirement, from every payer, traced to the sentence it came from.
            </p>
            <div className="mt-8 flex items-center gap-3">
              <Link href="#demo" className="rounded bg-ink px-5 py-2.5 text-[14px] text-paper no-underline hover:bg-chrome-700">
                Request a demo
              </Link>
              <Link href="/tour" className="rounded border border-chrome-200 px-5 py-2.5 text-[14px] text-ink no-underline hover:bg-chrome-50">
                See the product
              </Link>
            </div>
          </div>
          <HeroCitation />
        </section>

        <hr className="a-rule" />

        {/* What you get. */}
        <section className="grid gap-10 py-16 md:grid-cols-3">
          {VALUE.map(([h, p]) => (
            <div key={h}>
              <h2 className="font-serif text-[20px] text-ink">{h}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-chrome-700">{p}</p>
            </div>
          ))}
        </section>

        <hr className="a-rule" />

        {/* How, in four words each. */}
        <section className="py-16">
          <ol className="grid gap-px overflow-hidden rounded-lg bg-chrome-200 md:grid-cols-4">
            {PIPELINE.map(([n, label]) => (
              <li key={n} className="bg-paper p-5">
                <div className="a-mono text-[12px] text-chrome-500">{n}</div>
                <div className="mt-1 text-[14px] leading-snug text-ink">{label}</div>
              </li>
            ))}
          </ol>
        </section>

        <hr className="a-rule" />

        {/* Demo. */}
        <section id="demo" className="grid scroll-mt-16 gap-8 py-16 md:grid-cols-[0.8fr_1.2fr] md:items-start">
          <div>
            <h2 className="font-serif text-[26px] text-ink">Request a demo</h2>
            <p className="mt-3 max-w-reading text-[14px] leading-relaxed text-chrome-700">
              Send your indication and codes. We will show you what your payers require today.
            </p>
          </div>
          <DemoForm />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
