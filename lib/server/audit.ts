import { prisma } from "./db";

export type AuditCategory =
  | "Deployment"
  | "Version"
  | "Configuration"
  | "Approval"
  | "Validation"
  | "Incident"
  | "Access"
  | "Policy";

export interface AuditInput {
  orgId: string;
  actor: string;
  actorRole: string;
  action: string;
  object: string;
  category: AuditCategory;
  systemId?: string | null;
  reason?: string | null;
}

/** Append an immutable audit-trail row. Never throws into the request path. */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        orgId: input.orgId,
        actor: input.actor,
        actorRole: input.actorRole,
        action: input.action,
        object: input.object,
        category: input.category,
        systemId: input.systemId ?? null,
        reason: input.reason ?? null,
      },
    });
  } catch (e) {
    console.error("[audit] write failed", e);
  }
}
