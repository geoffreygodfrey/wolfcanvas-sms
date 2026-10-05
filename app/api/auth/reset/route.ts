import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { verifyResetToken } from "@/lib/resetToken";
import { authLimit, clientIp, rateLimitResponse, recordAuthAttempt } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const ip = clientIp(req);

  if (!token) {
    return NextResponse.json({ error: "Reset link is missing." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const limit = await authLimit({ ip, action: "reset" });
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterSeconds);
  }
  await recordAuthAttempt({ ip, action: "reset" });

  const userId = await verifyResetToken(token);
  if (!userId) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Request a new one." },
      { status: 400 }
    );
  }

  const exists = await pool.query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (exists.rowCount === 0) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Request a new one." },
      { status: 400 }
    );
  }

  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
    hashPassword(password),
    userId,
  ]);

  return NextResponse.json({ ok: true });
}