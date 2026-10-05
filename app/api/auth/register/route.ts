import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { getSessionUser, sessionCookieConfig, sessionCookieName, signSession } from "@/lib/session";
import { authLimit, clientIp, rateLimitResponse, recordAuthAttempt } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const ip = clientIp(req);

  if (!name || !email || password.length < 8) {
    return NextResponse.json(
      { error: "Name, a valid email, and a password of 8+ characters are required." },
      { status: 400 }
    );
  }

  const limit = await authLimit({ ip, action: "register" });
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterSeconds);
  }

  const userCount = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if ((existing.rowCount ?? 0) > 0) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  let role: "admin" | "member";
  if (userCount.rows[0].n === 0) {
    // First ever user creates the admin account.
    role = "admin";
  } else {
    // Everyone after that must be invited by an admin.
    const admin = await getSessionUser(req);
    if (!admin) {
      return NextResponse.json({ error: "Log in as an admin to invite team members." }, { status: 403 });
    }
    if (admin.role !== "admin") {
      return NextResponse.json({ error: "Only an admin can add team members." }, { status: 403 });
    }
    role = "member";
  }

  const inserted = await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, hashPassword(password), name, role]
  );

  const token = await signSession({
    userId: inserted.rows[0].id,
    email,
    name,
    role,
  });
  const res = NextResponse.json({ user: { email, name, role } }, { status: 201 });
  res.cookies.set(sessionCookieName, token, sessionCookieConfig());
  await recordAuthAttempt({ ip, email, action: "register" });
  return res;
}