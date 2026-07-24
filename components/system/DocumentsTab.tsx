"use client";

import { useState } from "react";
import { FileText, Plus, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextInput } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { fmtDate } from "@/lib/format";
import { useStore, type DocType } from "@/lib/store";

const DOC_TYPES: DocType[] = [
  "Model Card",
  "Validation Report",
  "Data Flow Diagram",
  "Approval Memo",
  "Regulatory Filing",
  "Intended-Use Statement",
  "Other",
];

export function DocumentsTab({ systemId }: { systemId: string }) {
  const { documentsFor, addDocument, removeDocument } = useStore();
  const docs = documentsFor(systemId);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<DocType>("Model Card");
  const [note, setNote] = useState("");

  const save = async () => {
    if (!name.trim()) return;
    await addDocument(systemId, {
      name: name.trim(),
      type,
      note: note.trim() || undefined,
    });
    setName("");
    setNote("");
    setType("Model Card");
    setAdding(false);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Panel>
          <PanelHeader
            icon={<FileText className="h-4 w-4" />}
            title="Documentation"
            description="Model cards, validation reports, approvals, and regulatory records for this system."
            actions={
              <Button variant="primary" size="sm" onClick={() => setAdding((a) => !a)}>
                <Plus className="h-3.5 w-3.5" />
                Add document
              </Button>
            }
          />

          {adding && (
            <div className="border-b border-edge bg-raised/40 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Document name">
                  <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q2 Validation Report" autoFocus />
                </Field>
                <Field label="Type">
                  <Select value={type} onChange={(e) => setType(e.target.value as DocType)}>
                    {DOC_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Note (optional)" className="mt-3">
                <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Short description or link reference" />
              </Field>
              <div className="mt-3 flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={save} disabled={!name.trim()}>
                  <Upload className="h-3.5 w-3.5" />
                  Save document
                </Button>
              </div>
            </div>
          )}

          <div className="divide-y divide-edge">
            {docs.map((d) => (
              <div key={d.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-raised text-fg-dim">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-fg">{d.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs font-medium text-fg-dim">
                      <span>{d.type}</span>
                      <span>·</span>
                      <span>{d.addedBy}</span>
                      <span>·</span>
                      <span className="tnum">{fmtDate(new Date(d.addedAt).toISOString())}</span>
                    </div>
                    {d.note && <div className="mt-1 text-xs font-medium text-fg-muted">{d.note}</div>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={d.status === "Current" ? "good" : d.status === "In review" ? "warning" : "neutral"}>
                    {d.status}
                  </Badge>
                  {!d.system && (
                    <button
                      onClick={() => removeDocument(d.id)}
                      className="text-fg-dim hover:text-critical"
                      aria-label="Remove document"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {docs.length === 0 && (
              <div className="px-4 py-12 text-center text-sm font-medium text-fg-dim">
                No documents yet. Add a model card, validation report, or approval memo.
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div>
        <Panel>
          <PanelHeader title="Why documentation matters" />
          <PanelBody className="text-xs font-medium leading-relaxed text-fg-muted">
            Governance and regulatory reviews require a current model card, a validation report
            for the deployed version, and a data-flow record describing PHI handling. Ward keeps
            these attached to the system and surfaces them in the approval workflow.
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
