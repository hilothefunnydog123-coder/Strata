import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { SimulationConsole } from "@/components/simulation/SimulationConsole";

export const metadata: Metadata = { title: "Simulation" };

export default function SimulationPage() {
  return (
    <div>
      <PageHeader
        title="Simulation Mode"
        description="Demonstrate how Ward detects and responds to real-world AI failures: schema changes, subgroup regressions, and agent anomalies, propagating through drift, performance, fairness, and alerting in real time."
        breadcrumb={[{ label: "Platform" }, { label: "Simulation" }]}
      />
      <SimulationConsole />
    </div>
  );
}
