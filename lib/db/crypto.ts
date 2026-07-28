/**
 * Encryption for clinical columns.
 *
 * Compliance requirement 1: tables holding clinical content are encrypted at
 * rest with a key separate from the session signing secret. This module
 * provides a Drizzle custom column type, `encryptedText`, so that encryption is
 * a property of the column definition rather than something each query has to
 * remember.
 *
 * AES-256-GCM. The stored value is `v1.<iv>.<tag>.<ciphertext>`, all base64url.
 * The version prefix exists so a future key rotation can decrypt old rows while
 * writing new ones under a new scheme.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { customType } from 'drizzle-orm/pg-core';
import { env } from '@/lib/env';

const VERSION = 'v1';
const IV_BYTES = 12;

function key(): Buffer {
  return Buffer.from(env.PHI_ENCRYPTION_KEY, 'base64');
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptField(stored: string): string {
  const parts = stored.split('.');
  const [version, ivB64, tagB64, dataB64] = parts;
  if (
    parts.length !== 4 ||
    version !== VERSION ||
    ivB64 === undefined ||
    tagB64 === undefined ||
    dataB64 === undefined
  ) {
    throw new Error(
      'Encrypted column value is not in the expected format. The row was written ' +
        'with a different key or scheme version.',
    );
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * A text column whose contents are encrypted on the way in and decrypted on the
 * way out. Reads and writes look like ordinary strings to calling code.
 *
 * Consequence worth knowing: an encrypted column cannot be searched with SQL
 * LIKE or indexed for text search. That is intentional. Clinical text is
 * retrieved by span identifier, never by scanning.
 */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text';
  },
  toDriver(value: string): string {
    return encryptField(value);
  },
  fromDriver(value: string): string {
    return decryptField(value);
  },
});
