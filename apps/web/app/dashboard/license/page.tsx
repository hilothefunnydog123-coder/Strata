import { createHash } from "node:crypto";
import { currentUser } from "@/lib/session";
import { getAccount, getSeats } from "@/lib/account";

export const dynamic = "force-dynamic";

function licenseKey(accountId: string): string {
  const h = createHash("sha256").update(`license:${accountId}`).digest("hex").toUpperCase();
  return `ASNT-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}`;
}

export default async function License() {
  const user = (await currentUser())!;
  const [account, seats] = await Promise.all([getAccount(user.accountId), getSeats(user.accountId)]);
  const isAdmin = user.role === "admin";

  return (
    <div>
      <h1 className="font-serif text-[28px] text-ink">License &amp; seats</h1>

      <div className="mt-5 border border-chrome-200 rounded-lg p-5 max-w-2xl">
        <div className="a-mono text-[11px] uppercase tracking-wide text-chrome-500">License key</div>
        <div className="a-mono text-[15px] text-ink mt-1">{licenseKey(user.accountId)}</div>
        <div className="text-[12px] text-chrome-500 mt-1">{account?.plan} plan · {seats.length} of {account?.seatLimit} seats in use</div>
      </div>

      <h2 className="font-serif text-[19px] text-ink mt-8">Seats</h2>
      <table className="mt-3 w-full max-w-2xl text-[13px] border-collapse">
        <thead><tr className="text-left text-chrome-500 border-b border-chrome-200">
          <th className="py-2 font-medium">Member</th><th className="py-2 font-medium">Role</th></tr></thead>
        <tbody>
          {seats.map((s) => (
            <tr key={s.id} className="border-b border-chrome-100">
              <td className="py-2.5 text-ink">{s.email}</td>
              <td className="py-2.5"><span className="a-mono text-[11px] uppercase tracking-wide text-chrome-500">{s.role}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[12px] text-chrome-500 mt-3 max-w-reading">
        {isAdmin
          ? "Seats are provisioned by an administrator via the admin CLI (pnpm db:seed / provisioning). Self-service signup does not exist."
          : "Contact your account administrator to add seats. Self-service signup does not exist."}
      </p>
    </div>
  );
}
