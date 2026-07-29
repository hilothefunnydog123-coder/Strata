/**
 * Column encryption and the two pieces of environment resolution it depends on.
 *
 * The risk being tested is not "does AES work". It is that a change to how the
 * key is obtained silently produces a different key, which does not fail: it
 * writes rows nothing can read back, and the damage is only visible later when
 * someone opens a record. So the tests pin the derivation itself, not only the
 * round trip.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resolveOrigin } from '@/lib/env';
import { decryptField, derivePhiKey, encryptField } from '@/lib/db/crypto';

describe('encryptField', () => {
  it('round trips text unchanged', () => {
    const plaintext = 'Patient required skilled nursing on a daily basis.';
    expect(decryptField(encryptField(plaintext))).toBe(plaintext);
  });

  it('round trips unicode and newlines, which clinical notes contain', () => {
    const plaintext = 'Line one\nLine two’s note, 40°C, 5 mg.';
    expect(decryptField(encryptField(plaintext))).toBe(plaintext);
  });

  it('produces a different ciphertext each time, so equal values are not linkable', () => {
    const a = encryptField('same input');
    const b = encryptField('same input');
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe(decryptField(b));
  });

  it('stores nothing resembling the plaintext', () => {
    const stored = encryptField('Medicare beneficiary identifier on file');
    expect(stored).not.toContain('Medicare');
    expect(stored.startsWith('v1.')).toBe(true);
  });

  it('refuses a value whose ciphertext was altered', () => {
    const stored = encryptField('daily skilled need documented');
    const parts = stored.split('.');
    // Flip the last character of the ciphertext.
    const last = parts[3]!;
    parts[3] = last.slice(0, -1) + (last.endsWith('A') ? 'B' : 'A');
    expect(() => decryptField(parts.join('.'))).toThrow();
  });
});

describe('derivePhiKey', () => {
  it('uses a 32 byte base64 key verbatim, so existing rows stay readable', () => {
    const raw = randomBytes(32);
    expect(derivePhiKey(raw.toString('base64')).equals(raw)).toBe(true);
  });

  it('derives 32 bytes from a secret of any other shape', () => {
    // A platform generated secret is not base64 of exactly 32 bytes. It still
    // has to yield a usable AES-256 key.
    const secret = randomBytes(32).toString('hex');
    const key = derivePhiKey(secret);
    expect(key.byteLength).toBe(32);
  });

  it('is deterministic, because a key that changes per boot loses the data', () => {
    const secret = 'a-secret-that-is-at-least-32-characters-long';
    expect(derivePhiKey(secret).equals(derivePhiKey(secret))).toBe(true);
  });

  it('gives different keys to different secrets', () => {
    const a = derivePhiKey('a-secret-that-is-at-least-32-characters-long');
    const b = derivePhiKey('b-secret-that-is-at-least-32-characters-long');
    expect(a.equals(b)).toBe(false);
  });

  it('does not return the secret itself as key material', () => {
    const secret = 'a-secret-that-is-at-least-32-characters-long';
    expect(derivePhiKey(secret).toString('utf8')).not.toBe(secret);
  });
});

describe('resolveOrigin', () => {
  it('prefers an explicit value over the platform one', () => {
    expect(
      resolveOrigin('https://medeal.example.com', 'https://medeal.onrender.com', 'APP_URL'),
    ).toBe('https://medeal.example.com');
  });

  it('falls back to the platform value on a first deploy', () => {
    expect(resolveOrigin(undefined, 'https://medeal.onrender.com', 'APP_URL')).toBe(
      'https://medeal.onrender.com',
    );
  });

  it('strips a trailing slash, so joined paths do not double up', () => {
    expect(resolveOrigin('https://medeal.example.com/', undefined, 'APP_URL')).toBe(
      'https://medeal.example.com',
    );
  });

  it('refuses rather than guessing when neither is set', () => {
    expect(() => resolveOrigin(undefined, undefined, 'BETTER_AUTH_URL')).toThrow(
      /BETTER_AUTH_URL is not set/,
    );
  });

  it('refuses a value with no scheme, which would issue unusable cookies', () => {
    expect(() => resolveOrigin('medeal.onrender.com', undefined, 'APP_URL')).toThrow(
      /absolute URL/,
    );
  });
});
