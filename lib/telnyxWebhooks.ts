import { createPublicKey, verify } from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const MAX_TIMESTAMP_SKEW = 300;

/**
 * Telnyx signs every webhook with Ed25519. Headers:
 *   telnyx-signature-ed25519 — base64-encoded 64-byte signature
 *   telnyx-timestamp         — unix seconds when the request was signed
 * The signed message is `${timestamp}|${rawBody}` (raw bytes, never
 * re-serialized JSON). Public key: Mission Control → Keys & Credentials →
 * Public Key, base64 encoded.
 */
export function verifyTelnyxWebhook(opts: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
}): { valid: boolean; reason?: string } {
  const publicKeyB64 = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (!publicKeyB64) {
    // Dev mode — no key configured, so enforce nothing but say so.
    return { valid: true, reason: "TELNYX_PUBLIC_KEY not set; signature not checked" };
  }

  if (!opts.signature || !opts.timestamp) {
    return { valid: false, reason: "missing signature or timestamp header" };
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_SKEW) {
    return { valid: false, reason: "timestamp outside tolerance window" };
  }

  try {
    const rawKey = Buffer.from(publicKeyB64, "base64");
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
      format: "der",
      type: "spki",
    });
    const signature = Buffer.from(opts.signature, "base64");
    const message = Buffer.from(`${opts.timestamp}|${opts.rawBody}`, "utf8");

    const ok = verify(null, message, publicKey, signature);
    return ok ? { valid: true } : { valid: false, reason: "invalid signature" };
  } catch (err) {
    return { valid: false, reason: `verification error: ${err instanceof Error ? err.message : err}` };
  }
}