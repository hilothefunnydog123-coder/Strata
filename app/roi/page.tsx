import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { RoiDashboard } from "@/components/roi/RoiDashboard";

export const metadata: Metadata = { title: "ROI & Impact" };

export default function RoiPage() {
  return (
    <div>
      <PageHeader
        title="ROI & Impact"
        description="Is the AI portfolio worth the investment? Track hours saved, cost reduced, revenue generated, and clinical outcomes against implementation and operating cost."
        breadcrumb={[{ label: "Understand" }, { label: "ROI & Impact" }]}
      />
      <RoiDashboard />
    </div>
  );
}
