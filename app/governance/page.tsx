import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { GovernanceBoard } from "@/components/governance/GovernanceBoard";
import { governanceWorkflows } from "@/lib/data";

export const metadata: Metadata = { title: "Governance" };

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="text-2xs font-medium uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight tnum ${tone ?? "text-fg"}`}>
        {value}
      </div>
    </div>
  );
}

export default function GovernancePage() {
  const inReview = governanceWorkflows.filter((w) => w.status === "In review").length;
  const blocked = governanceWorkflows.filter((w) => w.status === "Blocked").length;

  return (
    <div>
      <PageHeader
        title="Governance Workflow"
        description="Every AI system moves through a staged approval lifecycle before production. See exactly what is complete, what is in progress, and what is blocking each release."
        breadcrumb={[{ label: "Operate" }, { label: "Governance" }]}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="In pipeline" value={governanceWorkflows.length} />
        <Stat label="In review" value={inReview} tone="text-warning" />
        <Stat label="Blocked" value={blocked} tone={blocked > 0 ? "text-critical" : "text-fg"} />
        <Stat label="Avg cycle time" value="21 days" />
      </div>

      <GovernanceBoard workflows={governanceWorkflows} />
    </div>
  );
}
