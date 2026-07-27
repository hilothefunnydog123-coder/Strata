import { currentUser } from "@/lib/session";
import { getAccount } from "@/lib/account";

export const dynamic = "force-dynamic";

const PLAN_ANNUAL: Record<string, number> = { pilot: 60000, standard: 180000, enterprise: 420000 };

export default async function Invoices() {
  const user = (await currentUser())!;
  const account = await getAccount(user.accountId);
  const annual = PLAN_ANNUAL[account?.plan ?? "pilot"] ?? 60000;
  const quarter = Math.round(annual / 4);
  const year = new Date().getFullYear();
  // Illustrative invoice history derived from the plan (no billing integration in v0).
  const invoices = [0, 1, 2, 3].map((q) => ({
    id: `INV-${year}-Q${4 - q}`,
    date: `${year}-${String(12 - q * 3).padStart(2, "0")}-01`,
    amount: quarter,
    status: q === 0 ? "due" : "paid",
  }));

  return (
    <div>
      <h1 className="font-serif text-[28px] text-ink">Invoices</h1>
      <p className="text-[13px] text-chrome-500 mt-1">{account?.plan} plan · billed quarterly. (No billing integration in v0 — figures are illustrative.)</p>
      <table className="mt-5 w-full max-w-2xl text-[13px] border-collapse">
        <thead><tr className="text-left text-chrome-500 border-b border-chrome-200">
          <th className="py-2 font-medium">Invoice</th><th className="py-2 font-medium">Date</th>
          <th className="py-2 font-medium text-right">Amount</th><th className="py-2 font-medium">Status</th><th /></tr></thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-b border-chrome-100">
              <td className="py-2.5 a-mono text-ink">{inv.id}</td>
              <td className="py-2.5 a-mono text-chrome-700">{inv.date}</td>
              <td className="py-2.5 text-right a-mono text-chrome-700">${inv.amount.toLocaleString()}</td>
              <td className="py-2.5">
                <span className="a-mono text-[11px] uppercase tracking-wide" style={{ color: inv.status === "paid" ? "var(--a-stance-covered)" : "var(--a-stance-conditional)" }}>{inv.status}</span>
              </td>
              <td className="py-2.5 text-right"><a href={`/invoices/${inv.id}.pdf`} className="text-citation no-underline">PDF</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
