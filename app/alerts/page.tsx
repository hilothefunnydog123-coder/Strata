import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { AlertCenter } from "@/components/alerts/AlertCenter";
import { alerts } from "@/lib/data";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <div>
      <PageHeader
        title="Alert Center"
        description="Every signal across performance, drift, fairness, agent behavior, security, and compliance. Acknowledge, assign, escalate, mute, or resolve."
        breadcrumb={[{ label: "Monitor" }, { label: "Alerts" }]}
      />
      <AlertCenter base={alerts} />
    </div>
  );
}
