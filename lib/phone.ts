/** Strict E.164 — the format Telnyx requires for every send: a + sign then
 *  8–15 digits starting 1–9, with no spaces, dashes or parens. CSV imports get
 *  a lenient pre-pass that strips formatting (normalizePhone in
 *  lib/contactImport.ts) but must land here too. */
export const E164_RE = /^\+[1-9]\d{7,14}$/;

export const PHONE_E164_ERROR =
  "Phone must be in E.164 format: + followed by 8–15 digits, no spaces or dashes (e.g. +14165551234).";

/** The trimmed phone when it's valid E.164, otherwise null. */
export function toE164(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const trimmed = phone.trim();
  return E164_RE.test(trimmed) ? trimmed : null;
}
