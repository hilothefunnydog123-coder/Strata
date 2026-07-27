import { createHash } from "node:crypto";

/** Stable content hash over raw bytes (used for version identity / idempotency). */
export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}
