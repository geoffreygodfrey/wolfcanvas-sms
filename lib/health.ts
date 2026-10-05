import { pool } from "@/lib/db";
import type { Pool, PoolClient } from "pg";
import { sendOpsAlert } from "@/lib/mailer";

/* Pump health monitoring — cheap checks run on every pump tick.
 *
 * Two alerts, both email the admin (or log when email isn't configured):
 *  1. STALL — messages are queued and due, but the pump hasn't ticked for a
 *     while (cron died, scheduler crashed, DB outage). Fires on the first
 *     successful tick after the gap.
 *  2. FAILURE SPIKE — of the attempts in the last hour, at least FAILURE_MIN
 *     failed and failures are a majority of the attempts. 'skipped — …' rows
 *     (no consent / opted out) never count.
 *
 * Each alert respects its own cooldown so a long outage emails once, not every minute.
 */

const STALL_AFTER_SECONDS = 15 * 60; // 15 min without a tick while work is due
const FAILURE_WINDOW_HOURS = 1;
const FAILURE_MIN = 5;
const FAILURE_RATE = 0.5;
const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h

export async function pumpHealthTick(q?: Pool | PoolClient): Promise<void> {
  const db = q ?? pool;
  try {
    await db.query(
      `INSERT INTO pump_health (single, last_tick)
       VALUES (true, now())
       ON CONFLICT (single) DO UPDATE SET last_tick = EXCLUDED.last_tick`
    );
    await maybeAlert(db);
  } catch (err) {
    console.error("[health] tick error:", err instanceof Error ? err.message : err);
  }
}

/** Record an actual send (used by the pump loop to keep last_sent fresh). */
export async function notePumpSent(q?: PoolClient): Promise<void> {
  const db = q ?? pool;
  try {
    await db.query(
      `INSERT INTO pump_health (single, last_sent)
       VALUES (true, now())
       ON CONFLICT (single) DO UPDATE SET last_sent = EXCLUDED.last_sent`
    );
  } catch {
    /* best-effort */
  }
}

function olderThan(lastAlert: string | Date | null, cooldownMs: number, now: Date): boolean {
  if (!lastAlert) return true;
  const age = now.getTime() - new Date(lastAlert).getTime();
  return age > cooldownMs;
}

async function maybeAlert(db: Pool | PoolClient): Promise<void> {
  const now = new Date();

  const h = await db.query(
    `SELECT last_sent, last_stall_alert, last_failure_alert,
            EXTRACT(EPOCH FROM (now() - last_tick))::int AS tick_age_secs
     FROM pump_health WHERE single = true`
  );
  const hrow = h.rows[0];

  // 1) Stalled queue
  const dueRes = await db.query(
    `SELECT count(*)::int AS n FROM messages
     WHERE direction = 'outbound' AND status = 'queued' AND send_at <= now()`
  );
  const due = dueRes.rows[0].n;
  if (due > 0 && Number(hrow.tick_age_secs) >= STALL_AFTER_SECONDS && olderThan(hrow.last_stall_alert, ALERT_COOLDOWN_MS, now)) {
    await alertNow(db, "stall", hrow, {
      subject: `[wolfcanvas] SMS pump stalled — ${due} message(s) queued`,
      text: `The pump hasn't ticked for ${Math.round(Number(hrow.tick_age_secs) / 60)} minutes but ${due} message(s) are due.\n\nCheck the Vercel cron (cron-job.org) and function logs. Once the pump recovers this alert may not re-fire for 12h.`,
    });
  }

  // 2) Failure spike (excludes 'skipped — …' administrative rows)
  const fail = await db.query(
    `SELECT
       count(*) FILTER (WHERE status = 'failed' AND error_detail NOT LIKE 'skipped%')::int AS failed,
       count(*)::int AS total
     FROM messages
     WHERE direction = 'outbound'
       AND created_at >= now() - make_interval(hours => $1)
       AND status IN ('sent','delivered','failed')`,
    [FAILURE_WINDOW_HOURS]
  );
  const { failed, total } = fail.rows[0];
  if (
    failed >= FAILURE_MIN &&
    total >= FAILURE_MIN &&
    failed / total >= FAILURE_RATE &&
    olderThan(hrow.last_failure_alert, ALERT_COOLDOWN_MS, now)
  ) {
    const camps = await db.query(
      `SELECT DISTINCT cm.name FROM messages m
       JOIN campaigns cm ON cm.id = m.campaign_id
       WHERE m.direction = 'outbound' AND m.status = 'failed'
         AND NOT (m.error_detail LIKE 'skipped%')
         AND m.created_at >= now() - make_interval(hours => $1)
       LIMIT 6`,
      [FAILURE_WINDOW_HOURS]
    );
    const names = camps.rows.map((r) => r.name).join(", ") || "unknown";
    await alertNow(db, "failure", hrow, {
      subject: `[wolfcanvas] Send failures spiking (${failed}/${total} in 1h)`,
      text: `${failed} of the last ${total} outbound attempts in the past hour failed — a ${Math.round((failed / total) * 100)}% failure rate.\n\nAffected campaign(s): ${names}\n\nCheck Telnyx (number/messaging profile validity) and the message statuses in the app. Next alert in 12h.`,
    });
  }
}

async function alertNow(
  db: Pool | PoolClient,
  kind: "stall" | "failure",
  hrow: any,
  body: { subject: string; text: string }
): Promise<void> {
  try {
    const result = await sendOpsAlert(body);
    console.log(`[health] ${kind} alert sent (${result.mode})`);
  } catch (err) {
    console.error("[health] alert email failed:", err instanceof Error ? err.message : err);
  }
  const col = kind === "stall" ? "last_stall_alert" : "last_failure_alert";
  await db.query(`UPDATE pump_health SET ${col} = now() WHERE single = true`);
}