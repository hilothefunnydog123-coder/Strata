import { Activity, Bell, Boxes, GaugeCircle, ShieldCheck } from "lucide-react";

/** A self-contained, stylized preview of the Ward console for the hero. */
export function HeroPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-edge-strong bg-panel shadow-raised">
      {/* window bar */}
      <div className="flex items-center gap-2 border-b border-edge bg-raised px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-critical/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-positive/70" />
        <span className="ml-3 text-2xs font-semibold text-fg-dim">
          console.ward.health / command-center
        </span>
      </div>
      <div className="grid grid-cols-[44px_1fr]">
        {/* mini sidebar */}
        <div className="flex flex-col items-center gap-4 border-r border-edge py-4 text-fg-dim">
          <GaugeCircle className="h-4 w-4 text-accent" />
          <Boxes className="h-4 w-4" />
          <Bell className="h-4 w-4" />
          <Activity className="h-4 w-4" />
          <ShieldCheck className="h-4 w-4" />
        </div>
        {/* content */}
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-bold text-fg">AI Estate Health</div>
            <div className="rounded bg-critical/15 px-1.5 py-0.5 text-2xs font-bold text-critical">
              3 CRITICAL
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { k: "AI SYSTEMS", v: "42", t: "text-fg" },
              { k: "ATTENTION", v: "8", t: "text-warning" },
              { k: "ANNUAL IMPACT", v: "$26M", t: "text-positive" },
            ].map((s) => (
              <div key={s.k} className="rounded-lg border border-edge bg-raised p-2.5">
                <div className="text-[0.6rem] font-bold uppercase tracking-wider text-fg-dim">
                  {s.k}
                </div>
                <div className={`mt-1 text-xl font-bold tnum ${s.t}`}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* chart */}
          <div className="mt-3 rounded-lg border border-edge bg-raised p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-bold text-fg">Sepsis Risk Predictor</span>
              <span className="text-2xs font-bold text-critical tnum">−3.2% · 30d</span>
            </div>
            <svg viewBox="0 0 320 80" className="w-full" preserveAspectRatio="none">
              <line x1="0" y1="30" x2="320" y2="30" stroke="rgb(var(--critical))" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
              <path
                d="M0,26 L40,24 L80,27 L120,23 L160,25 L200,24 L240,28 L270,34 L300,52 L320,60"
                fill="none"
                stroke="rgb(var(--accent))"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <line x1="240" y1="8" x2="240" y2="76" stroke="rgb(var(--fg-dim))" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              <circle cx="240" cy="8" r="2.5" fill="rgb(var(--fg-dim))" />
            </svg>
            <div className="mt-1 text-2xs font-semibold text-warning">
              Mar 14 · EHR schema change detected
            </div>
          </div>

          {/* alert row */}
          <div className="mt-3 flex items-center gap-2 rounded-lg border-l-2 border-critical bg-critical/[0.06] px-3 py-2">
            <span className="rounded border border-critical/40 px-1 py-px text-[0.55rem] font-bold uppercase text-critical">
              Critical
            </span>
            <span className="text-2xs font-semibold text-fg">
              False negative rate for patients over 65 rose 7.2% → 11.4%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
