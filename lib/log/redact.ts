/**
 * Redaction for anything on its way to a log sink.
 *
 * Compliance requirement 2: no patient content reaches console output, error
 * messages, exception traces, or third-party telemetry. This module is called
 * from inside the logger itself (lib/log/index.ts) rather than at each call
 * site, so a developer cannot forget to use it.
 *
 * The approach is deliberately conservative. Three independent filters run over
 * every value, and any one of them is enough to redact:
 *
 *   1. Key name. A field called notes, text, or verbatim_quote is clinical by
 *      construction, whatever it happens to contain today.
 *   2. Value shape. Identifiers that are patient-linked even when they appear
 *      under an innocent key: social security numbers, medical record numbers,
 *      dates of birth, phone numbers, email addresses.
 *   3. Length. Free text beyond a few sentences is presumed to be narrative
 *      clinical content. It is replaced by its length, which is what an
 *      engineer debugging a truncation bug actually needs.
 *
 * What survives: identifiers we mint (uuids), enums, counts, booleans,
 * timestamps, and short operational strings. That is enough to debug with.
 */

const MAX_STRING = 160;
const MAX_DEPTH = 6;
const MAX_ARRAY = 32;

export const REDACTED = '[redacted]';

/** Field names that hold clinical or personal content, matched case and separator insensitively. */
const PHI_KEYS = [
  'text',
  'body',
  'bodyjson',
  'content',
  'rawtext',
  'notes',
  'note',
  'quote',
  'verbatimquote',
  'denialbasistext',
  'clinicalrecord',
  'narrative',
  'diagnosis',
  'diagnoses',
  'medication',
  'medications',
  'patient',
  'patientname',
  'membername',
  'beneficiary',
  'beneficiaryname',
  'firstname',
  'lastname',
  'name',
  'dob',
  'dateofbirth',
  'address',
  'phone',
  'email',
  'ssn',
  'mrn',
  'memberid',
  'claimnumber',
  'filename',
  'prompt',
  'completion',
  'message',
  'messages',
  'input',
  'output',
  'buffer',
  'file',
  'password',
  'passwordhash',
  'secret',
  'token',
  'totpsecret',
  'apikey',
  'authorization',
  'cookie',
];

const PHI_KEY_SET = new Set(PHI_KEYS);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isPhiKey(key: string): boolean {
  return PHI_KEY_SET.has(normalizeKey(key));
}

/** Value patterns that identify a person regardless of the field they arrive in. */
const VALUE_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { label: 'mrn', re: /\bMRN[:#\s-]*[A-Z0-9-]{4,}\b/gi },
  { label: 'medicare-id', re: /\b[1-9][A-Z][0-9A-Z]\d[A-Z][0-9A-Z]\d[A-Z]{2}\d{2}\b/g },
  { label: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  { label: 'phone', re: /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g },
  { label: 'date', re: /\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}\b/g },
  { label: 'dob', re: /\bDOB[:\s]*\S+/gi },
];

/**
 * Scrub a single string. Patterns are masked in place so surrounding
 * operational context survives; anything long enough to be narrative is
 * replaced wholesale.
 */
export function redactString(value: string): string {
  let out = value;
  for (const { label, re } of VALUE_PATTERNS) {
    out = out.replace(re, `[redacted:${label}]`);
  }
  if (out.length > MAX_STRING) {
    return `[redacted:${out.length} chars]`;
  }
  return out;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return value;
  if (t === 'function') return '[function]';
  if (t === 'symbol') return '[symbol]';
  if (t === 'string') return redactString(value as string);

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactError(value);

  if (depth >= MAX_DEPTH) return '[truncated:depth]';

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[binary:${(value as ArrayBufferView).byteLength ?? 0} bytes]`;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const items = value.slice(0, MAX_ARRAY).map((v) => redactValue(v, depth + 1, seen));
    if (value.length > MAX_ARRAY) items.push(`[+${value.length - MAX_ARRAY} more]`);
    return items;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return '[circular]';
    seen.add(obj);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = isPhiKey(k) ? REDACTED : redactValue(v, depth + 1, seen);
    }
    return out;
  }

  return '[unknown]';
}

/**
 * Errors get special handling: the message is scrubbed as a string, the stack is
 * kept but scrubbed line by line, and any extra enumerable properties (which is
 * where drivers like to attach the offending row) go through the object path.
 */
export function redactError(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: error.name,
    message: redactString(error.message),
  };
  if (error.stack) {
    out.stack = error.stack
      .split('\n')
      .slice(0, 12)
      .map((line) => redactString(line))
      .join('\n');
  }
  for (const [k, v] of Object.entries(error)) {
    if (k === 'name' || k === 'message' || k === 'stack') continue;
    out[k] = isPhiKey(k) ? REDACTED : redactValue(v, 1, new WeakSet());
  }
  if (error.cause instanceof Error) {
    out.cause = redactError(error.cause);
  }
  return out;
}

/** Redact an arbitrary value for logging. Safe to call on anything. */
export function redact<T>(value: T): unknown {
  return redactValue(value, 0, new WeakSet());
}
