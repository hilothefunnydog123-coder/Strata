import "server-only";
import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { authenticator } from "otplib";
import { PRODUCT } from "@assent/core";

/**
 * Credentials + TOTP (PROMPT §3). Passwords use scrypt (same format the admin CLI
 * writes: "salt:hex"). TOTP via otplib. No password ever lives in the desktop app;
 * the desktop authenticates via the device flow (see api/device).
 */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpAuthUri(email: string, secret: string): string {
  return authenticator.keyuri(email, PRODUCT.name, secret);
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.check(token.replace(/\s+/g, ""), secret);
  } catch {
    return false;
  }
}

/** Hash a raw session/device token before it is stored (never store the raw token). */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
