import Link from "next/link";
import { SiteNav, SiteFooter } from "@/components/Chrome";
import { HeroCitation } from "@/components/HeroCitation";

const MODULES = [
  ["Corpus", "Every policy and every historical version, full-text and semantic search, offline. Filter by payer, code, date, and stance."],
  ["Criteria Rail", "The document on the left, its extracted requirements on the right. Click a requirement and the exact source paragraph lights up. This is the whole product in one gesture."],
  ["Coverage Map", "Every payer, sized by covered lives, colored by its stance on your codes: covered, conditional, investigational, not covered — or silent. Most are silent, and we show that grey honestly."],
  ["Evidence Blueprint", "Requirements clustered across payers, weighted by covered lives, ranked by the lives each unlocks. Toggle a design decision and watch the coverage percentage move."],
  ["Change Watch", "Version-to-version diffs, labeled tightened or loosened, scored by whether they touch one of your assets. The ten percent of changes that isn't noise."],
];

export default function Tour() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-6xl px-5">
        <section className="pt-14 pb-10">
          <div className="a-mono text-[12px] uppercase tracking-wider text-chrome-500 mb-3">Product tour</div>
          <h1 className="font-serif text-[34px] leading-tight text-ink max-w-3xl">
            A professional instrument, not a chatbot. It is closer to a trading terminal than to a dashboard.
          </h1>
          <p className="mt-4 text-[15px] text-chrome-700 max-w-reading leading-relaxed">
            Assent Desktop is where the work happens. It runs offline, indexes hundreds of
            thousands of source spans locally, and answers in under fifty milliseconds. The
            one interaction to understand first is the citation highlight.
          </p>
        </section>

        <section className="pb-14"><HeroCitation /></section>

        <hr className="a-rule" />

        <section className="py-14 grid gap-px bg-chrome-200 rounded-lg overflow-hidden md:grid-cols-2">
          {MODULES.map(([h, p], i) => (
            <div key={h} className="bg-paper p-6">
              <div className="a-mono text-[12px] text-citation">M{i + 1}</div>
              <h3 className="font-serif text-[20px] text-ink mt-1">{h}</h3>
              <p className="text-[14px] leading-relaxed text-chrome-700 mt-2">{p}</p>
            </div>
          ))}
        </section>

        <section className="py-10 text-center">
          <Link href="/#demo" className="rounded bg-ink text-paper px-5 py-2.5 text-[14px] hover:bg-chrome-700 no-underline">
            Request a demo
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
