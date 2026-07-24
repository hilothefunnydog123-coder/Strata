"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CircleCheck, ShieldCheck } from "lucide-react";
import { Modal, Field, Select, TextArea, TextInput } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { CATEGORY_ORDER } from "@/lib/constants";
import type { RiskLevel } from "@/lib/types";

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
  const [submitted, setSubmitted] = useState(false);
  const [govId, setGovId] = useState("GOV-227");
  const [name, setName] = useState("");
  const [risk, setRisk] = useState<RiskLevel>("High");
  const [sourcing, setSourcing] = useState<"Internal" | "Vendor">("Internal");

  const reset = () => {
    setSubmitted(false);
    setName("");
    setRisk("High");
    setSourcing("Internal");
  };

  const submit = () => {
    setGovId(`GOV-2${28 + (name.length % 40)}`);
    setSubmitted(true);
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
      title={submitted ? "System submitted to governance" : "Register an AI system"}
      description={
        submitted
          ? undefined
          : "Capture the identity, ownership, and risk classification. Registration opens a governed intake before any production use."
      }
      footer={
        submitted ? (
          <>
            <Button variant="ghost" onClick={reset}>
              Register another
            </Button>
            <Link href="/governance">
              <Button variant="primary">
                Open governance workflow
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={!name.trim()}>
              <ShieldCheck className="h-4 w-4" />
              Submit for review
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
              <div className="text-sm font-semibold text-fg">
                {name || "New AI system"} registered as {govId}
              </div>
              <div className="mt-0.5 text-xs text-fg-muted">
                Intake created at Draft. The system cannot reach production until every
                governance stage is complete.
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-fg-dim">
              Governance path
            </div>
            <ol className="space-y-1.5">
              {["Draft & Intake", "Security Review", "Clinical Review", "Validation", "Approval", "Production"].map(
                (stage, i) => (
                  <li key={stage} className="flex items-center gap-2.5 text-sm">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-2xs font-semibold ${
                        i === 0 ? "bg-accent text-accent-fg" : "bg-raised text-fg-dim"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className={i === 0 ? "font-medium text-fg" : "text-fg-muted"}>
                      {stage}
                    </span>
                    {i === 0 && (
                      <span className="text-2xs text-accent">Current</span>
                    )}
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
            <Select defaultValue="Clinical Prediction">
              {CATEGORY_ORDER.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Model type">
            <Select defaultValue="Gradient-Boosted Trees">
              {[
                "Gradient-Boosted Trees",
                "Deep CNN",
                "Vision Transformer",
                "Fine-tuned LLM",
                "Agentic LLM System",
                "Ensemble",
                "Logistic Regression",
              ].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Sourcing">
            <Select
              value={sourcing}
              onChange={(e) => setSourcing(e.target.value as "Internal" | "Vendor")}
            >
              <option value="Internal">Internal (built in-house)</option>
              <option value="Vendor">Vendor</option>
            </Select>
          </Field>
          <Field label={sourcing === "Vendor" ? "Vendor name" : "Owning team"}>
            <TextInput placeholder={sourcing === "Vendor" ? "e.g. Lumen Radiology AI" : "e.g. Clinical AI Team"} />
          </Field>
          <Field label="Environment">
            <Select defaultValue="Development">
              <option>Development</option>
              <option>Staging</option>
              <option>Production</option>
            </Select>
          </Field>
          <Field label="Data classification">
            <Select defaultValue="PHI">
              <option>PHI</option>
              <option>Limited Data Set</option>
              <option>De-identified</option>
              <option>Operational</option>
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
              placeholder="What clinical or operational decision does this system inform, and what action does its output drive?"
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
