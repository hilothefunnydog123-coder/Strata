import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { CatalogView } from "@/components/catalog/CatalogView";

export const metadata: Metadata = { title: "AI Catalog" };

export default function CatalogPage() {
  return (
    <div>
      <PageHeader
        title="AI Catalog"
        description="The organization's source of truth for every AI system: purpose, ownership, model type, risk, regulatory classification, and review status."
        breadcrumb={[{ label: "Understand" }, { label: "AI Catalog" }]}
      />
      <CatalogView />
    </div>
  );
}
