import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsView } from "@/components/settings/SettingsView";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Organization Settings"
        description="Users, roles and permissions, risk policies, alert thresholds, and platform integrations for Northstar Health System."
        breadcrumb={[{ label: "Platform" }, { label: "Settings" }]}
      />
      <SettingsView />
    </div>
  );
}
