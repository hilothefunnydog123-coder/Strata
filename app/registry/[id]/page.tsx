import type { Metadata } from "next";
import { SystemDetailClient } from "@/components/system/SystemDetailClient";

export const metadata: Metadata = { title: "AI System" };

export default function SystemPage({ params }: { params: { id: string } }) {
  return <SystemDetailClient id={params.id} />;
}
