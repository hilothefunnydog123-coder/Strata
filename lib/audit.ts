/**
 * The audit log.
 *
 * Compliance requirement 3: every read or write of a PHI record leaves a row
 * saying who, which record, what action, when, and from what IP.
 *
 * Append only. This module exports a write and two reads. There is no update
 * and no delete, here or anywhere else in the codebase, and the application
 * database role has no need of those grants on this table.
 *
 * The rows deliberately carry identifiers and never content. An audit trail
 * that quoted the record it was protecting would be a second copy of the PHI
 * with weaker handling, which is the opposite of the point.
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { auditLog, isPhiTable } from '@/lib/db/schema';
import { log } from '@/lib/log';

export type AuditAction =
  | 'read'
  | 'list'
  | 'create'
  | 'update'
  | 'delete'
  | 'export'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'two_factor_enrolled'
  | 'transition'
  | 'generate'
  | 'review'
  | 'provision'
  | 'deprovision'
  | 'erase';

export interface AuditEntry {
  userId: string | null;
  organizationId: string | null;
  action: AuditAction;
  /** The table name, so PHI classification is derived rather than asserted. */
  entityType: string;
  entityId: string | null;
}

/**
 * Read the caller's network identity from the request.
 *
 * Vercel and Cloudflare both put the real client address in x-forwarded-for;
 * the first entry is the client and the rest are proxies.
 */
export async function requestIdentity(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    const ip =
      forwarded?.split(',')[0]?.trim() ||
      h.get('x-real-ip') ||
      h.get('cf-connecting-ip') ||
      null;
    return { ip, userAgent: h.get('user-agent') };
  } catch {
    // Outside a request context, for instance a cron drain or a CLI script.
    return { ip: null, userAgent: null };
  }
}

/**
 * Write one audit row.
 *
 * Failures are logged and swallowed. That is a considered trade: an audit write
 * failing should not take down a clinician's screen mid-appeal, and the failure
 * itself is visible in the operator console's job and error surface. If the
 * requirement ever hardens to "no read without a durable audit row", this is the
 * one place that changes.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  const { ip, userAgent } = await requestIdentity();
  try {
    await db.insert(auditLog).values({
      userId: entry.userId,
      organizationId: entry.organizationId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      phi: isPhiTable(entry.entityType),
      ip,
      userAgent,
    });
  } catch (error) {
    log.error('audit write failed', {
      error,
      action: entry.action,
      entityType: entry.entityType,
    });
  }
}

/** Audit rows for one record, newest first. Shown on the denial timeline. */
export async function auditForEntity(entityType: string, entityId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.createdAt));
}

/** Recent audit rows across the platform. Operator console only. */
export async function recentAudit(since: Date, limit = 200) {
  return db
    .select()
    .from(auditLog)
    .where(gte(auditLog.createdAt, since))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
