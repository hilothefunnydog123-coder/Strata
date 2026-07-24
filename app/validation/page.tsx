import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { ValidationCenter } from "@/components/validation/ValidationCenter";

export const metadata: Metadata = { title: "Validation Center" };

export default function ValidationPage({
  searchParams,
}: {
  searchParams: { system?: string };
}) {
  return (
    <div>
      <PageHeader
        title="Model Validation Center"
        description="Validate an AI model against a governed dataset and test suite before deployment. Every approval and block is recorded to the audit log."
        breadcrumb={[{ label: "Operate" }, { label: "Validation" }]}
      />
      <ValidationCenter initialSystem={searchParams.system} />
    </div>
  );
}
