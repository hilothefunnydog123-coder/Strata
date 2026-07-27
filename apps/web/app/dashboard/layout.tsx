import Link from "next/link";
import { redirect } from "next/navigation";
import { PRODUCT } from "@assent/core";
import { currentUser } from "@/lib/session";
import { getAccount } from "@/lib/account";

export const dynamic = "force-dynamic";

const NAV: ReadonlyArray<readonly [string, string]> = [
  ["/dashboard", "Overview"],
  ["/dashboard/coverage", "Coverage summary"],
  ["/dashboard/download", "Desktop app"],
  ["/dashboard/license", "License & seats"],
  ["/dashboard/invoices", "Invoices"],
  ["/dashboard/device", "Device approvals"],
];

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const account = await getAccount(user.accountId);

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[240px_1fr]">
      <aside className="border-b md:border-b-0 md:border-r border-chrome-200 bg-chrome-50 md:min-h-screen flex flex-col">
        <div className="px-5 h-14 flex items-center border-b border-chrome-200">
          <span className="font-serif text-[17px] font-semibold text-ink">{PRODUCT.name}</span>
          <span className="a-mono text-[10px] uppercase tracking-wider text-chrome-500 ml-2">Console</span>
        </div>
        <nav className="p-3 flex flex-col gap-0.5 text-[13px]">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="px-3 py-2 rounded text-chrome-700 hover:bg-white hover:text-ink no-underline">
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto p-3 border-t border-chrome-200 text-[12px]">
          <div className="px-2 py-1 text-chrome-500 truncate" title={user.email}>{user.email}</div>
          <div className="px-2 a-mono text-[11px] text-chrome-300">{account?.orgName ?? "—"} · {account?.plan ?? ""}</div>
          <form action="/api/auth/logout" method="post" className="mt-2">
            <button className="w-full text-left px-3 py-2 rounded text-chrome-700 hover:bg-white hover:text-ink a-focusable">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="p-6 md:p-10 max-w-5xl">{children}</main>
    </div>
  );
}
