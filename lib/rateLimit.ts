import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export interface AuthLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before trying again (0 when allowed). */
  retryAfterSeconds: number;
}

const WINDOW_MS = 15 * 60 * 1000; // 15-minute sliding window
const CLEANUP_SECONDS = 24 * 60 * 60; // drop rows older than 24h

const THRESHOLDS: Record<string, { ip: number; email: number }> = {
  login: { ip: 15, email: 6 },
  register: { ip: 10, email: 2 }, // invites by an admin; 2/email guards guest abuse
  forgot: { ip: 12, email: 999 },
  reset: { ip: 12, email: 999 },
};

/** Best-effort client IP (useful on Vercel where x-forwarded-for is set). */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  return real?.trim() || "local";
}

/** Options for who should receive the auth rate-limit response. */
export function rateLimitResponse(retryAfterSeconds: number): Response {
  return new NextResponse(
    JSON.stringify({
      error: `Too many attempts. Try again in ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minute(s).`,
    }),
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    }
  );
}

/**
 * Check whether an auth action is allowed, given the recent attempts in the
 * 15-minute window. Also prunes stale rows (bounded, runs on every check).
 */
export async function authLimit(opts: {
  ip: string;
  email?: string;
  action: string;
}): Promise<AuthLimitResult> {
  const t = THRESHOLDS[opts.action] ?? { ip: 15, email: 999 };
  const cutoff = new Date(Date.now() - WINDOW_MS);

  try {
    await pool.query(`DELETE FROM auth_attempts WHERE attempted_at < now() - make_interval(secs => $1)`, [
      CLEANUP_SECONDS,
    ]);
  } catch {
    /* cleanup is best-effort */
  }

  const ipN = await pool.query(
    `SELECT count(*)::int AS n FROM auth_attempts
     WHERE ip = $1 AND action = $2 AND attempted_at >= $3`,
    [opts.ip, opts.action, cutoff]
  );
  if (ipN.rows[0].n >= t.ip) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(WINDOW_MS / 1000)) };
  }

  if (opts.email) {
    const emN = await pool.query(
      `SELECT count(*)::int AS n FROM auth_attempts
       WHERE lower(email) = lower($1) AND action = $2 AND attempted_at >= $3`,
      [opts.email, opts.action, cutoff]
    );
    if (emN.rows[0].n >= t.email) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(WINDOW_MS / 1000)) };
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Record one attempt (call after a failed login, or on every register/forgot/reset hit). */
export async function recordAuthAttempt(opts: {
  ip: string;
  email?: string;
  action: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO auth_attempts (ip, email, action) VALUES ($1, $2, $3)`,
      [opts.ip, opts.email?.toLowerCase() || null, opts.action]
    );
  } catch {
    /* rate-limit bookkeeping must never break auth itself */
  }
}

/** Clear attempts after a successful login (per email + ip). */
export async function clearAuthAttempts(opts: { ip: string; email: string }): Promise<void> {
  try {
    await pool.query(`DELETE FROM auth_attempts WHERE lower(email) = lower($1)`, [opts.email]);
    await pool.query(`DELETE FROM auth_attempts WHERE ip = $1 AND email IS NULL`, [opts.ip]);
  } catch {
    /* best-effort */
  }
}