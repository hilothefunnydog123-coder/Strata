import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegistryTable } from "@/components/registry/RegistryTable";
import { estate } from "@/lib/data";

export const metadata: Metadata = { title: "AI Registry" };

export default function RegistryPage({
  searchParams,
}: {
  searchParams: { register?: string };
}) {
  return (
    <div>
      <PageHeader
        title="AI Registry"
        description={`The complete AI estate: ${estate.total} registered systems across ${estate.hospitals} hospitals, with live performance, validation, and financial status.`}
        breadcrumb={[{ label: "Monitor" }, { label: "AI Registry" }]}
      />
      <RegistryTable initialRegisterOpen={searchParams.register === "1"} />
    </div>
  );
}
