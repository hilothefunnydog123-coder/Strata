/**
 * Compliance requirement 2. The logger must not be able to emit patient
 * content, so these tests attack the redactor from every direction a real leak
 * would come from: an obviously named field, an innocently named field holding
 * clinical narrative, a driver error carrying the offending row, and a nested
 * structure deep enough that a naive implementation would stop looking.
 */
import { describe, expect, it } from 'vitest';
import { isPhiKey, redact, redactError, redactString, REDACTED } from '@/lib/log/redact';

const NARRATIVE =
  'Patient is a 78 year old male admitted following left femoral neck fracture. ' +
  'He requires maximum assistance for bed mobility and is non weight bearing on the left. ' +
  'Skilled nursing observation is required for wound care and anticoagulation management.';

describe('isPhiKey', () => {
  it('matches clinical field names regardless of case or separator', () => {
    for (const key of [
      'notes',
      'Notes',
      'verbatim_quote',
      'verbatimQuote',
      'VERBATIM-QUOTE',
      'denial_basis_text',
      'clinicalRecord',
      'totp_secret',
    ]) {
      expect(isPhiKey(key), key).toBe(true);
    }
  });

  it('leaves operational field names alone', () => {
    for (const key of ['id', 'denialId', 'status', 'count', 'orgId', 'latencyMs', 'ordinal']) {
      expect(isPhiKey(key), key).toBe(false);
    }
  });
});

describe('redactString', () => {
  it('masks identifiers that name a person', () => {
    const out = redactString('member 123-45-6789 called from (415) 555-0123');
    expect(out).not.toContain('123-45-6789');
    expect(out).not.toContain('555-0123');
    expect(out).toContain('[redacted:ssn]');
    expect(out).toContain('[redacted:phone]');
  });

  it('masks dates of birth and service dates', () => {
    expect(redactString('DOB 04/12/1947')).not.toContain('1947');
    expect(redactString('service from 3/2/2026')).not.toContain('3/2/2026');
  });

  it('masks email addresses', () => {
    expect(redactString('contact jane.doe@hospital.org')).toBe(
      'contact [redacted:email]',
    );
  });

  it('replaces narrative length text with its length only', () => {
    const out = redactString(NARRATIVE);
    expect(out).toMatch(/^\[redacted:\d+ chars\]$/);
    expect(out).not.toContain('femoral');
  });

  it('leaves short operational strings intact', () => {
    expect(redactString('ready_for_generation')).toBe('ready_for_generation');
    expect(redactString('DAB No. 3145')).toBe('DAB No. 3145');
  });
});

describe('redact', () => {
  it('strips values under clinical key names even when short', () => {
    const out = redact({ notes: 'ok', denialId: 'abc', text: 'fine' }) as Record<
      string,
      unknown
    >;
    expect(out.notes).toBe(REDACTED);
    expect(out.text).toBe(REDACTED);
    expect(out.denialId).toBe('abc');
  });

  it('catches clinical narrative hiding under an innocent key', () => {
    const out = redact({ payload: NARRATIVE }) as Record<string, unknown>;
    expect(out.payload).toMatch(/^\[redacted:\d+ chars\]$/);
  });

  it('recurses into nested structures', () => {
    const out = redact({
      denial: { id: 'd1', spans: [{ ordinal: 1, text: 'skilled care required' }] },
    }) as { denial: { id: string; spans: { ordinal: number; text: string }[] } };
    expect(out.denial.id).toBe('d1');
    expect(out.denial.spans[0]!.text).toBe(REDACTED);
  });

  it('does not recurse forever on circular structures', () => {
    const a: Record<string, unknown> = { id: 'a' };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect((redact(a) as Record<string, unknown>).self).toBe('[circular]');
  });

  it('caps long arrays', () => {
    const out = redact(Array.from({ length: 100 }, (_, i) => i)) as unknown[];
    expect(out.length).toBeLessThanOrEqual(33);
    expect(out[out.length - 1]).toContain('more');
  });

  it('summarises binary payloads rather than serialising them', () => {
    const out = redact({ upload: Buffer.from(NARRATIVE) }) as Record<string, unknown>;
    expect(String(out.upload)).toMatch(/^\[binary:\d+ bytes\]$/);
  });
});

describe('redactError', () => {
  it('scrubs the message and any attached row', () => {
    const error = Object.assign(
      new Error(`insert failed for row with text: ${NARRATIVE}`),
      { detail: NARRATIVE, table: 'denial_span' },
    );
    const out = redactError(error);
    expect(JSON.stringify(out)).not.toContain('femoral');
    expect(out.table).toBe('denial_span');
  });

  it('scrubs a nested cause', () => {
    const inner = new Error(`clinical text ${NARRATIVE}`);
    const outer = new Error('wrapper', { cause: inner });
    expect(JSON.stringify(redactError(outer))).not.toContain('anticoagulation');
  });

  it('keeps a bounded stack so traces stay useful', () => {
    const out = redactError(new Error('boom'));
    expect(String(out.stack).split('\n').length).toBeLessThanOrEqual(12);
    expect(out.message).toBe('boom');
  });
});
