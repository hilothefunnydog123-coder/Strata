import Link from "next/link";
import { currentUser } from "@/lib/session";
import { getAccount, getSeats, getCoverageSummary } from "@/lib/account";
import { formatLives } from "@assent/core";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const user = (await currentUser())!;
  const [account, seats, coverage] = await Promise.all([
    getAccount(user.accountId), getSeats(user.accountId), getCoverageSummary(user.accountId),
  ]);
  const coveredPct = coverage.totalLives ? Math.round((coverage.coveredLives / coverage.totalLives) * 100) : 0;

  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="border border-chrome-200 rounded-lg p-4">
      <div className="a-mono text-[11px] uppercase tracking-wide text-chrome-500">{label}</div>
      <div className="font-serif text-[26px] text-ink mt-1 leading-none">{value}</div>
      {sub && <div className="text-[12px] text-chrome-500 mt-1">{sub}</div>}
    </div>
  );

  return (
    <div>
      <h1 className="font-serif text-[28px] text-ink">{account?.orgName}</h1>
      <p className="text-[13px] text-chrome-500 mt-1">Executive console. The analysis lives in {""}
        <Link href="/dashboard/download" className="text-citation">Assent Desktop</Link>; this is the read-only summary.</p>

      <div className="grid gap-3 sm:grid-cols-3 mt-6">
        <Stat label="Plan" value={account?.plan ?? "—"} sub={`${seats.length} of ${account?.seatLimit ?? 0} seats used`} />
        <Stat label="Asset" value={coverage.asset?.name ?? "—"} sub={coverage.asset?.targetCodes.join(" · ")} />
        <Stat label="Covered lives" value={`${coveredPct}%`} sub={`${formatLives(coverage.coveredLives)} of ${formatLives(coverage.totalLives)} modeled`} />
      </div>

      {coverage.blueprint && (
        <div className="mt-6 border-l-2 border-citation pl-4">
          <div className="a-mono text-[11px] uppercase tracking-wide text-chrome-500">Blueprint headline</div>
          <p className="font-serif text-[16px] text-ink mt-1 leading-relaxed max-w-reading">{coverage.blueprint.narrative}</p>
          <Link href="/dashboard/coverage" className="text-[13px] text-citation">See the full coverage summary →</Link>
        </div>
      )}
    </div>
  );
}
