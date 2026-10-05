import { SignJWT, jwtVerify } from "jose";

const RESET_TTL_SECONDS = 60 * 60;

function resetSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET?.trim();
  if (s) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV !== "production") {
    return new TextEncoder().encode("wolfcanvas-dev-secret-change-me");
  }
  throw new Error("AUTH_SECRET must be set in production");
}

export async function signResetToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${RESET_TTL_SECONDS}s`)
    .sign(resetSecret());
}

/**
 * Verify a password reset link. Returns the user id (the token subject),
 * or null when the token is invalid, tampered with, or expired.
 */
export async function verifyResetToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, resetSecret(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}