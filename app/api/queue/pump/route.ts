import { NextRequest, NextResponse } from "next/server";
import { pumpOnce } from "@/lib/pump";
import { pumpHealthTick } from "@/lib/health";

// Keep the function alive for the full (bounded) run — Vercel Hobby allows up
// to 60s of wall time for a web function.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Pump endpoint for the free external cron (cron-job.org) option.
 *
 * Runs pumpOnce as a bounded mini-worker: it sends what it can while staying
 * inside the invocation budget and waiting out the per-campaign pace floor
 * between sends, then reports back. A 1-minute cron keeps calling it, so the
 * send pace stays the human-looking 1–3/min the campaign UI sets — never a
 * burst.
 *
 * Guarded by CRON_SECRET (sent as `Authorization: Bearer <secret>` or
 * `?secret=<secret>`). If CRON_SECRET is not set, the pump runs unguarded —
 * useful for local smoke tests, but production should always set it.
 */
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest): Promise<NextResponse> {
  // Heartbeat + stall/failure alerts run unconditionally so a misconfigured
  // CRON_SECRET (401) can't silently mask a dead pump.
  await pumpHealthTick();

  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    const query = req.nextUrl.searchParams.get("secret")?.trim() ?? "";
    if (!bearer && !query) {
      return NextResponse.json(
        { error: "Missing CRON_SECRET (send Authorization: Bearer <secret>)" },
        { status: 401 }
      );
    }
    if ((bearer && bearer !== secret) || (query && query !== secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const cap = clampInt(req.nextUrl.searchParams.get("cap"), 1, 500, 100);
  const runForMs = clampInt(req.nextUrl.searchParams.get("runForMs"), 1000, 55_000, 55_000);

  try {
    const result = await pumpOnce({ cap, runForMs });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pump-endpoint] error:", message);
    return NextResponse.json({ error: message, sent: 0, pending: false }, { status: 500 });
  }
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}