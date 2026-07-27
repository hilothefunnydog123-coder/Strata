import Link from "next/link";
import { SiteNav, SiteFooter } from "@/components/Chrome";
import { HeroCitation } from "@/components/HeroCitation";
import { DemoForm } from "@/components/DemoForm";

/** Payers whose policies are in the committed corpus (fixtures/manifest.json). */
const CORPUS = "CMS · MolDX · Aetna · Cigna · UnitedHealthcare · Humana · Elevance · BCBS Michigan";

/** The stakes, as a table of facts rather than as decorated numbers. */
const STAKES: Array<[string, string]> = [
  [
    "~900",
    "payers, each publishing its own evidence bar in its own prose, on its own revision cycle. None of them is obliged to agree with any other, and most say nothing at all about your test.",
  ],
  [
    "3–7 yr",
    "from approval to broad commercial coverage, when it arrives. The study that would have shortened it finished years earlier, designed against a guess.",
  ],
  [
    "1",
    "the number of source sentences that makes a requirement real. Everything else — the summary, the consultant deck, the model's recollection — is someone's paraphrase.",
  ],
];

const COMMITMENTS: Array<{ h: string; p: string }> = [
  {
    h: "One corpus, finally structured",
    p: "CMS, MolDX, and the major commercial payers — every medical policy, every historical version, parsed into the requirements they actually state. Molecular oncology first.",
  },
  {
    h: "Nothing without a citation",
    p: "No requirement exists in Assent without a verbatim sentence that is programmatically verified to be in the source. One fabricated requirement would be a liability, so we discard rather than guess.",
  },
  {
    h: "The frontier, not an answer",
    p: "Given your indication and codes: this design unlocks 61% of lives; a head-to-head arm takes you to 84%; the last 16% needs a prospective outcomes study. A cost/benefit decision a CEO can make.",
  },
];

const PIPELINE: Array<[string, string, string]> = [
  ["01", "Ingest", "Every policy and every revision, fetched and preserved byte-for-byte."],
  ["02", "Extract", "Each binding requirement pulled out with its minimal supporting quote — and verified."],
  ["03", "Diff", "Version to version, what tightened and what loosened. The ten percent that isn't noise."],
  ["04", "Blueprint", "Requirements clustered across payers, weighted by covered lives, ranked by lives unlocked."],
];

const NEXT_STEPS: Array<[string, string]> = [
  ["01", "A thirty-minute walkthrough on your indication and your codes — not a canned demo."],
  ["02", "The requirements your payers state today, each one traced back to the sentence that binds it."],
  ["03", "Where your evidence stands against them, and what the next study would actually unlock."],
];

export default function Home() {
  return (
    <>
      <SiteNav />
      <main id="main">
        {/* ── Hero. Real policy prose being marked up, not a big number and a gradient. */}
        <section className="border-b border-chrome-200">
          <div className="mx-auto max-w-6xl px-5 pb-14 pt-12 sm:pt-16 lg:pb-20 lg:pt-20">
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span aria-hidden className="h-px w-8 bg-chrome-300" />
                  <span className="a-eyebrow">For market access teams of one</span>
                </div>

                <h1 className="mt-5 text-balance font-serif text-[clamp(2.05rem,5.2vw,3.15rem)] leading-[1.07] tracking-[-0.015em] text-ink">
                  You are about to bet five years on <em className="italic">a guess</em> about what
                  payers will require.
                </h1>

                <p className="mt-6 max-w-reading text-pretty text-[16.5px] leading-[1.62] text-chrome-700">
                  Every payer publishes what evidence it needs before it will pay — in prose, across
                  nine hundred documents nobody has ever read end to end. Assent reads them, pulls
                  out each binding requirement, and ties it to the exact sentence it came from. Then
                  it shows you the trial design that unlocks the most covered lives.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link
                    href="#demo"
                    className="a-focusable rounded bg-ink px-5 py-2.5 text-[14px] text-paper no-underline hover:bg-chrome-700"
                  >
                    Request a demo
                  </Link>
                  <Link
                    href="/tour"
                    className="a-focusable rounded border border-chrome-200 px-5 py-2.5 text-[14px] text-ink no-underline hover:bg-chrome-50"
                  >
                    See the product
                  </Link>
                </div>

                <div className="mt-10 border-t border-chrome-200 pt-4">
                  <div className="a-eyebrow">Corpus in scope</div>
                  <p className="a-mono mt-1.5 text-[12px] leading-relaxed text-chrome-500">{CORPUS}</p>
                </div>
              </div>

              <HeroCitation />
            </div>
          </div>
        </section>

        {/* ── The stakes. Dense editorial, not stat cards. */}
        <section className="border-b border-chrome-200" aria-labelledby="stakes-h">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-16 lg:py-20">
            <div className="min-w-0">
              <div className="a-eyebrow">The gap</div>
              <h2
                id="stakes-h"
                className="mt-3 text-balance font-serif text-[clamp(1.6rem,3.2vw,2.05rem)] leading-[1.15] tracking-[-0.01em] text-ink"
              >
                FDA approval is not permission to get paid.
              </h2>
            </div>

            <div className="min-w-0">
              <p className="max-w-reading text-pretty text-[15.5px] leading-[1.65] text-chrome-700">
                Clearance says the test may be sold. Coverage decides whether it is reimbursed, and
                it is settled separately, later, and by someone who was never in the room when the
                trial was designed.
              </p>

              <dl className="mt-8">
                {STAKES.map(([figure, body]) => (
                  <div
                    key={figure}
                    className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-5 border-t border-chrome-200 py-4 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-x-8"
                  >
                    <dt className="a-mono pt-0.5 text-[14px] leading-snug text-ink sm:text-[15px]">{figure}</dt>
                    <dd className="text-[14px] leading-[1.6] text-chrome-700">{body}</dd>
                  </div>
                ))}
              </dl>

              <p className="mt-8 max-w-reading text-pretty border-t border-chrome-200 pt-6 font-serif text-[17px] leading-[1.55] text-ink">
                The evidence you needed was specified in public, in advance, in writing. It has
                simply never been readable.
              </p>
            </div>
          </div>
        </section>

        {/* ── The three commitments the product follows from. */}
        <section className="border-b border-chrome-200" aria-labelledby="commitments-h">
          <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
            <div className="a-eyebrow">Principles</div>
            <h2
              id="commitments-h"
              className="mt-3 max-w-3xl text-balance font-serif text-[clamp(1.5rem,3vw,1.9rem)] leading-[1.18] tracking-[-0.01em] text-ink"
            >
              Three commitments. Everything else in the product follows from them.
            </h2>

            <div className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-3">
              {COMMITMENTS.map((c, i) => (
                <div key={c.h} className="min-w-0 border-t border-chrome-200 pt-4">
                  <div className="a-mono text-[11px] text-chrome-500">{String(i + 1).padStart(2, "0")}</div>
                  <h3 className="mt-2 font-serif text-[20px] leading-snug text-ink">{c.h}</h3>
                  <p className="mt-2 text-[14px] leading-[1.62] text-chrome-700">{c.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── The pipeline, quietly. One rule across the page with four entries hung off it. */}
        <section className="border-b border-chrome-200" aria-labelledby="pipeline-h">
          <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
            <div className="a-eyebrow">Pipeline</div>
            <h2
              id="pipeline-h"
              className="mt-3 max-w-3xl text-balance font-serif text-[clamp(1.5rem,3vw,1.9rem)] leading-[1.18] tracking-[-0.01em] text-ink"
            >
              From published prose to a defensible trial decision.
            </h2>

            <ol className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4">
              {PIPELINE.map(([n, h, p]) => (
                <li key={n} className="min-w-0 border-t border-chrome-200 pb-6 pr-8 pt-4">
                  <div className="flex items-baseline gap-2.5">
                    <span className="a-mono text-[11px] text-chrome-500">{n}</span>
                    <h3 className="text-[14px] font-semibold text-ink">{h}</h3>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-[1.6] text-chrome-500">{p}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Demo. Its own band so the page lands somewhere. */}
        <section id="demo" className="scroll-mt-16 bg-chrome-50" aria-labelledby="demo-h">
          <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
            <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
              <div className="min-w-0">
                <div className="a-eyebrow">Request a demo</div>
                <h2
                  id="demo-h"
                  className="mt-3 text-balance font-serif text-[clamp(1.5rem,3vw,1.9rem)] leading-[1.18] tracking-[-0.01em] text-ink"
                >
                  Bring your indication and your codes.
                </h2>
                <p className="mt-4 max-w-reading text-pretty text-[15px] leading-[1.65] text-chrome-700">
                  We will walk you through the requirements your payers actually state, and where
                  your evidence stands against them. Assent is sold to teams under contract — there
                  is no self-service signup.
                </p>

                <dl className="mt-8">
                  {NEXT_STEPS.map(([n, body]) => (
                    <div
                      key={n}
                      className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-t border-chrome-200 py-3.5"
                    >
                      <dt className="a-mono pt-0.5 text-[11px] text-chrome-500">{n}</dt>
                      <dd className="text-[13.5px] leading-[1.6] text-chrome-700">{body}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <DemoForm />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
