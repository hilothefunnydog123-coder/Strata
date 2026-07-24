"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

const controlClass =
  "h-10 w-full rounded-md border border-edge bg-panel px-3 text-sm font-medium text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none";

export function DemoForm() {
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-positive/30 bg-positive/10 px-6 py-12 text-center">
        <CheckCircle2 className="h-10 w-10 text-positive" />
        <h3 className="mt-4 text-xl font-bold text-fg">Request received</h3>
        <p className="mt-2 max-w-md text-sm font-medium text-fg-muted">
          Thanks{name ? `, ${name.split(" ")[0]}` : ""}. A member of our team will reach out to
          {org ? ` ${org}` : " your organization"} within one business day to schedule your
          Ward walkthrough.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
      }}
      className="rounded-xl border border-edge bg-panel p-6 shadow-raised"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-fg-muted">Full name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} className={controlClass} placeholder="Dr. Jane Smith" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-fg-muted">Work email</span>
          <input required type="email" className={controlClass} placeholder="jane@healthsystem.org" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-fg-muted">Organization</span>
          <input required value={org} onChange={(e) => setOrg(e.target.value)} className={controlClass} placeholder="Health system name" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-fg-muted">Role</span>
          <select className={controlClass} defaultValue="">
            <option value="" disabled>
              Select a role
            </option>
            <option>Chief Information Officer</option>
            <option>Chief Medical Information Officer</option>
            <option>AI Governance Lead</option>
            <option>Compliance Officer</option>
            <option>Data Science Leader</option>
            <option>Other</option>
          </select>
        </label>
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-semibold text-fg-muted">
          How many AI systems are you running today?
        </span>
        <textarea
          rows={2}
          className="w-full resize-none rounded-md border border-edge bg-panel px-3 py-2 text-sm font-medium text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
          placeholder="Tell us about your AI estate and what you want to get in control of."
        />
      </label>
      <Button type="submit" variant="primary" className="mt-4 h-11 w-full text-sm">
        Request a demo
        <ArrowRight className="h-4 w-4" />
      </Button>
      <p className="mt-3 text-center text-2xs font-medium text-fg-dim">
        By requesting a demo you agree to be contacted about Ward. We never sell your data.
      </p>
    </form>
  );
}
