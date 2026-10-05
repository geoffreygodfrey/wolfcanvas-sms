import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { signResetToken } from "@/lib/resetToken";
import { sendPasswordResetEmail } from "@/lib/mailer";
import { authLimit, clientIp, rateLimitResponse, recordAuthAttempt } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const ip = clientIp(req);

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const limit = await authLimit({ ip, action: "forgot" });
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterSeconds);
  }
  await recordAuthAttempt({ ip, email, action: "forgot" });

  const query = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  const user = query.rows[0];

  // Same response whether or not the account exists, so the endpoint can't be
  // used to enumerate registered emails.
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const token = await signResetToken(user.id);
  const resetUrl = `${req.nextUrl.origin}/reset-password?token=${encodeURIComponent(token)}`;

  let devUrl: string | null = null;
  try {
    const result = await sendPasswordResetEmail({ to: email, resetUrl });
    if (!result.delivered) devUrl = resetUrl;
  } catch (err) {
    console.error("[auth] failed to email reset link:", err);
  }

  return NextResponse.json({ ok: true, devUrl });
}