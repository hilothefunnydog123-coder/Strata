"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CircleCheck, ShieldCheck } from "lucide-react";
import { Modal, Field, Select, TextArea, TextInput } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { CATEGORY_ORDER } from "@/lib/constants";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import type {
  AICategory,
  DataClassification,
  Environment,
  ModelClass,
  RegulatoryClass,
  RiskLevel,
} from "@/lib/types";

const MODELS: ModelClass[] = [
  "Gradient-Boosted Trees",
  "Deep CNN",
  "Vision Transformer",
  "Fine-tuned LLM",
  "Agentic LLM System",
  "Transformer (NLP)",
  "Recurrent Neural Net",
  "Ensemble",
  "Logistic Regression",
];

const REGULATORY: RegulatoryClass[] = [
  "Clinical Decision Support (Non-Device)",
  "FDA Cleared (510k)",
  "FDA Cleared (De Novo)",
  "Enterprise-Validated",
  "Laboratory-Developed Test",
  "Research Use Only",
];

const RISK_NOTE: Record<RiskLevel, string> = {
  Low: "180-day validation cadence · 1 approval · clinical review optional.",
  Moderate: "120-day validation cadence · 2 approvals · clinical review required.",
  High: "90-day validation cadence · 2 approvals · mandatory clinical review.",
  Critical: "60-day validation cadence · 3 approvals · IRB determination required.",
};

export function RegisterSystemModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { addSystem } = useStore();
  const { session } = useAuth();

  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newId, setNewId] = useState("");

  const [name, setName] = useState("");
  const [category, setCategory] = useState<AICategory>("Clinical Prediction");
  const [modelClass, setModelClass] = useState<ModelClass>("Gradient-Boosted Trees");
  const [sourcing, setSourcing] = useState<"Internal" | "Vendor">("Internal");
  const [vendorTeam, setVendorTeam] = useState("");
  const [department, setDepartment] = useState("");
  const [environment, setEnvironment] = useState<Environment>("Development");
  const [dataClass, setDataClass] = useState<DataClassification>("PHI");
  const [risk, setRisk] = useState<RiskLevel>("High");
  const [regulatory, setRegulatory] = useState<RegulatoryClass>(
    "Clinical Decision Support (Non-Device)",
  );
  const [intendedUse, setIntendedUse] = useState("");

  const reset = () => {
    setSubmitted(false);
    setNewId("");
    setName("");
    setCategory("Clinical Prediction");
    setModelClass("Gradient-Boosted Trees");
    setSourcing("Internal");
    setVendorTeam("");
    setDepartment("");
    setEnvironment("Development");
    setDataClass("PHI");
    setRisk("High");
    setRegulatory("Clinical Decision Support (Non-Device)");
    setIntendedUse("");
  };

  const submit = async () => {
    setSaving(true);
    const by = session?.name ?? "Registrant";
    const id = await addSystem({
      name: name.trim(),
      description: intendedUse.trim(),
      purpose: intendedUse.trim(),
      category,
      modelClass,
      owner: sourcing === "Internal" ? vendorTeam.trim() || "AI Platform" : department.trim() || "AI Platform",
      ownerContact: by,
      department: department.trim() || "Clinical AI",
      vendor: sourcing === "Vendor" ? vendorTeam.trim() || "Vendor" : "Internal",
      isInternal: sourcing === "Internal",
      isAgent: category === "Autonomous Agent" || modelClass === "Agentic LLM System",
      environment,
      riskLevel: risk,
      regulatoryClass: regulatory,
      dataClassification: dataClass,
      headlineLabel: "Accuracy",
      headlineValue: 90,
      inputs: [],
      outputs: [],
      tags: ["Newly registered"],
    });
    setSaving(false);
    if (id) {
      setNewId(id);
      setSubmitted(true);
    }
  };

  const handleClose = () => {
    onClose();
    setTimeout(reset, 250);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="lg"
      title={submitted ? "AI system registered" : "Register an AI system"}
      description={
        submitted
          ? undefined
          : "Capture identity, ownership, and risk. Registration adds the system to your AI Registry and opens a governed intake before production use."
      }
      footer={
        submitted ? (
          <>
            <Button variant="ghost" onClick={reset}>
              Register another
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                handleClose();
                router.push(`/registry/${newId}`);
              }}
            >
              Open control center
              <ArrowRight className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={!name.trim() || saving}>
              <ShieldCheck className="h-4 w-4" />
              {saving ? "Registering…" : "Register system"}
            </Button>
          </>
        )
      }
    >
      {submitted ? (
        <div className="py-2">
          <div className="flex items-center gap-3 rounded-lg border border-positive/25 bg-positive/10 p-3.5">
            <CircleCheck className="h-8 w-8 shrink-0 text-positive" />
            <div>
              <div className="text-sm font-bold text-fg">
                {name || "New AI system"} is now in your AI Registry
              </div>
              <div className="mt-0.5 text-xs font-medium text-fg-muted">
                It has a full control center and is flagged as awaiting governance approval. It
                cannot reach production until every stage is complete.
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-2 text-2xs font-bold uppercase tracking-wider text-fg-dim">
              Governance path
            </div>
            <ol className="space-y-1.5">
              {["Draft & Intake", "Security Review", "Clinical Review", "Validation", "Approval", "Production"].map(
                (stage, i) => (
                  <li key={stage} className="flex items-center gap-2.5 text-sm">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-2xs font-bold ${
                        i === 0 ? "bg-accent text-accent-fg" : "bg-raised text-fg-dim"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className={i === 0 ? "font-semibold text-fg" : "font-medium text-fg-muted"}>
                      {stage}
                    </span>
                    {i === 0 && <span className="text-2xs font-bold text-accent">Current</span>}
                  </li>
                ),
              )}
            </ol>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="System name" className="sm:col-span-2">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Heart Failure Readmission Model"
              autoFocus
            />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value as AICategory)}>
              {CATEGORY_ORDER.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Model type">
            <Select value={modelClass} onChange={(e) => setModelClass(e.target.value as ModelClass)}>
              {MODELS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Sourcing">
            <Select value={sourcing} onChange={(e) => setSourcing(e.target.value as "Internal" | "Vendor")}>
              <option value="Internal">Internal (built in-house)</option>
              <option value="Vendor">Vendor</option>
            </Select>
          </Field>
          <Field label={sourcing === "Vendor" ? "Vendor name" : "Owning team"}>
            <TextInput
              value={vendorTeam}
              onChange={(e) => setVendorTeam(e.target.value)}
              placeholder={sourcing === "Vendor" ? "e.g. Lumen Radiology AI" : "e.g. Clinical AI Team"}
            />
          </Field>
          <Field label="Department">
            <TextInput value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Critical Care" />
          </Field>
          <Field label="Environment">
            <Select value={environment} onChange={(e) => setEnvironment(e.target.value as Environment)}>
              <option>Development</option>
              <option>Staging</option>
              <option>Production</option>
            </Select>
          </Field>
          <Field label="Data classification">
            <Select value={dataClass} onChange={(e) => setDataClass(e.target.value as DataClassification)}>
              <option>PHI</option>
              <option>Limited Data Set</option>
              <option>De-identified</option>
              <option>Operational</option>
            </Select>
          </Field>
          <Field label="Regulatory classification">
            <Select value={regulatory} onChange={(e) => setRegulatory(e.target.value as RegulatoryClass)}>
              {REGULATORY.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label="Risk classification" className="sm:col-span-2" hint={RISK_NOTE[risk]}>
            <Select value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel)}>
              <option>Low</option>
              <option>Moderate</option>
              <option>High</option>
              <option>Critical</option>
            </Select>
          </Field>
          <Field label="Intended use" className="sm:col-span-2">
            <TextArea
              rows={2}
              value={intendedUse}
              onChange={(e) => setIntendedUse(e.target.value)}
              placeholder="What clinical or operational decision does this system inform, and what action does its output drive?"
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
