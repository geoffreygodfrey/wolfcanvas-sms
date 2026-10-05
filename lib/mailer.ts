const RESEND_URL = "https://api.resend.com/emails";
import { pool } from "@/lib/db";

export type MailResult = { delivered: boolean; mode: "resend" | "log" };

/**
 * Send the password reset email. When RESEND_API_KEY / MAIL_FROM are unset
 * (local dev), prints the reset link to the server log instead so the flow
 * stays testable without an email provider.
 */
export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
}): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();

  if (!apiKey || !from) {
    console.log(`[mailer:log] password reset for ${opts.to}:\n  ${opts.resetUrl}`);
    return { delivered: false, mode: "log" };
  }

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: "Reset your wolfcanvas password",
      text: `You asked to reset your password. Open this link before it expires (1 hour) to choose a new one:\n\n${opts.resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Password reset email failed (${res.status}): ${body.slice(0, 200)}`);
  }

  return { delivered: true, mode: "resend" };
}

/**
 * Ops alert (pump stalled / failure spike). Emails the first admin account when
 * RESEND_API_KEY + MAIL_FROM are set; otherwise logs to the server log so the
 * message is still visible in Vercel/console output.
 */
export async function sendOpsAlert(opts: {
  subject: string;
  text: string;
}): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();

  let to: string | null = null;
  try {
    const admin = await pool.query(
      `SELECT email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`
    );
    to = admin.rows[0]?.email ?? null;
  } catch {
    /* no db access → fall through to log mode */
  }

  if (!apiKey || !from || !to) {
    console.log(`[mailer:log] ALERT "${opts.subject}" (to: ${to ?? "no admin user"}):\n${opts.text}`);
    return { delivered: false, mode: "log" };
  }

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: opts.subject,
      text: opts.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ops alert email failed (${res.status}): ${body.slice(0, 200)}`);
  }

  return { delivered: true, mode: "resend" };
}