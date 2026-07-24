import type { Metadata } from "next";
import { SystemDetailClient } from "@/components/system/SystemDetailClient";
import { getSystem, systems } from "@/lib/data";

export function generateStaticParams() {
  return systems.map((s) => ({ id: s.id }));
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const system = getSystem(params.id);
  return { title: system ? system.name : "AI System" };
}

export default function SystemPage({ params }: { params: { id: string } }) {
  return <SystemDetailClient id={params.id} />;
}
