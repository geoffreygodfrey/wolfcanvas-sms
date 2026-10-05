import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { sessionCookieConfig, sessionCookieName, signSession } from "@/lib/session";
import { authLimit, clientIp, clearAuthAttempts, rateLimitResponse, recordAuthAttempt } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const ip = clientIp(req);

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const limit = await authLimit({ ip, email, action: "login" });
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterSeconds);
  }

  const result = await pool.query(
    `SELECT id, email, name, password_hash, role FROM users WHERE email = $1`,
    [email]
  );
  const user = result.rows[0];

  if (!user || !verifyPassword(password, user.password_hash)) {
    await recordAuthAttempt({ ip, email, action: "login" });
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  await clearAuthAttempts({ ip, email });

  const session = { userId: user.id, email: user.email, name: user.name, role: user.role as "admin" | "member" };
  const token = await signSession(session);

  const res = NextResponse.json({ user: { email: user.email, name: user.name, role: user.role } });
  res.cookies.set(sessionCookieName, token, sessionCookieConfig());
  return res;
}