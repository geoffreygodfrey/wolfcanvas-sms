import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "session";

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  role: "admin" | "member";
}

export const sessionCookieName = COOKIE_NAME;

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET?.trim();
  if (s) {
    if (process.env.NODE_ENV === "production" && s.length < 24) {
      throw new Error("AUTH_SECRET must be at least 24 characters in production");
    }
    return new TextEncoder().encode(s);
  }
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[auth] AUTH_SECRET is not set — using the insecure dev fallback. Set a long AUTH_SECRET before going live."
    );
    return new TextEncoder().encode("wolfcanvas-dev-secret-change-me");
  }
  throw new Error("AUTH_SECRET must be set in production");
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
      role: payload.role === "member" ? "member" : "admin",
    };
  } catch {
    return null;
  }
}

/** Read and verify the session from an incoming request. Null when not authed. */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function sessionCookieConfig() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}