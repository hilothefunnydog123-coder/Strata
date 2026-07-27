import { currentUser } from "@/lib/session";
import { getCoverageSummary } from "@/lib/account";
import { StanceBadge, StanceLegend, LivesBar } from "@assent/ui";
import { formatLives, LIVES_DENOMINATOR_LABEL } from "@assent/core";

export const dynamic = "force-dynamic";

export default async function Coverage() {
  const user = (await currentUser())!;
  const cov = await getCoverageSummary(user.accountId);
  const denom = LIVES_DENOMINATOR_LABEL.modeled_corpus;

  return (
    <div>
      <h1 className="font-serif text-[28px] text-ink">Coverage summary</h1>
      <p className="text-[13px] text-chrome-500 mt-1 max-w-reading">
        Stance on {cov.asset?.name ?? "your asset"} ({cov.asset?.targetCodes.join(", ")}) by payer, weighted by covered lives.
        Most payers are silent for any given code — that grey is the point.
      </p>

      <div className="mt-5"><StanceLegend /></div>

      <table className="mt-5 w-full text-[13px] border-collapse">
        <thead>
          <tr className="text-left text-chrome-500 border-b border-chrome-200">
            <th className="py-2 font-medium">Payer</th>
            <th className="py-2 font-medium">Stance</th>
            <th className="py-2 font-medium text-right a-mono">Covered lives</th>
            <th className="py-2 font-medium">Cited basis</th>
          </tr>
        </thead>
        <tbody>
          {cov.rows.map((r) => (
            <tr key={r.payerId} className="border-b border-chrome-100 align-top">
              <td className="py-2.5 pr-3 text-ink">{r.payerName}</td>
              <td className="py-2.5 pr-3"><StanceBadge stance={r.stance} /></td>
              <td className="py-2.5 pr-3 text-right a-mono text-chrome-700">{formatLives(r.lives)}</td>
              <td className="py-2.5 text-chrome-500 max-w-md">
                {r.quote ? <span className="font-serif italic">“{r.quote.length > 90 ? r.quote.slice(0, 90) + "…" : r.quote}”</span>
                  : <span className="a-mono text-[11px] text-chrome-300">no explicit stance on this code</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="a-mono text-[11px] text-chrome-500 mt-3">Denominator: {denom} — {formatLives(cov.totalLives)} total.</p>

      {cov.blueprint && (
        <section className="mt-10">
          <h2 className="font-serif text-[20px] text-ink">Evidence frontier</h2>
          <p className="font-serif text-[15px] text-ink mt-2 leading-relaxed max-w-reading">{cov.blueprint.narrative}</p>
          <div className="mt-5 grid gap-3 max-w-2xl">
            {cov.blueprint.frontier.map((step, i) => (
              <LivesBar key={i} label={step.label} lives={step.cumulativeLives} total={cov.blueprint!.totalCorpusLives}
                denominatorLabel={denom} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
