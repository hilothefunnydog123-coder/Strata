import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { StrataMark } from "@/components/shell/Brand";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <StrataMark className="h-10 w-10" />
      <div className="mt-5 text-2xs font-semibold uppercase tracking-[0.16em] text-fg-dim">
        404 · Not found
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
        This resource does not exist
      </h1>
      <p className="mt-2 max-w-md text-sm text-fg-muted">
        The AI system, incident, or page you are looking for may have been retired or moved.
        Return to the command center to continue.
      </p>
      <div className="mt-6 flex items-center gap-2">
        <ButtonLink href="/overview" variant="primary">
          Back to Overview
        </ButtonLink>
        <ButtonLink href="/registry" variant="secondary">
          Open AI Registry
        </ButtonLink>
      </div>
    </div>
  );
}
