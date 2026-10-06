import { pool } from "@/lib/db";
import type { PoolClient } from "pg";
import { sendSms } from "@/lib/telnyx";
import { pumpHealthTick, notePumpSent } from "@/lib/health";
import { getOptOutStats, purgeOptedOut } from "@/lib/purge";
import { resolveTimezone } from "@/lib/timezone";

export interface SendWindow {
  startHour: number | null;
  endHour: number | null;
  /** IANA timezone the window hours refer to, e.g. "America/New_York". */
  timezone: string;
}

// Fixed namespace for scheduling writes. Only one pump instance (web or worker)
// may dequeue/send at a time.
const PUMP_LOCK_KEY = 8735937;

export function hasActiveWindow(w: SendWindow): boolean {
  return w.startHour != null && w.endHour != null && w.endHour > w.startHour;
}

export function windowLabel(w: SendWindow): string {
  if (!hasActiveWindow(w)) return "24/7";
  const fmt = (h: number) => {
    const ampm = h >= 12 ? "PM" : "AM";
    const hr = h % 12 === 0 ? 12 : h % 12;
    return `${hr}:00 ${ampm}`;
  };
  const tz = resolveTimezone(w.timezone);
  return `${fmt(w.startHour!)} – ${fmt(w.endHour!)} (${tz})`;
}

interface WallClock {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
}

/** The wall-clock calendar time an instant shows inside a timezone. */
function wallParts(instant: Date, tz: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  let h = get("hour");
  if (h === 24) h = 0; // some engines report midnight as "24"
  return { y: get("year"), m: get("month"), d: get("day"), h, min: get("minute"), s: get("second") };
}

/** tz offset (UTC - tz wall time) in ms at a given instant. */
function tzOffsetMs(tz: string, at: Date): number {
  const w = wallParts(at, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - at.getTime();
}

/** Convert a wall-clock moment in a timezone back to a real instant. */
function wallToInstant(w: WallClock, tz: string): Date {
  const naive = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s);
  let offset = tzOffsetMs(tz, new Date(naive));
  let inst = new Date(naive - offset);
  const off2 = tzOffsetMs(tz, inst);
  if (off2 !== offset) inst = new Date(naive - off2);
  return inst;
}

/** True when `now` falls inside the campaign's delivery window, in its timezone. */
export function isWithinWindow(now: Date, w: SendWindow): boolean {
  if (!hasActiveWindow(w)) return true;
  const wall = wallParts(now, resolveTimezone(w.timezone));
  return wall.h >= w.startHour! && wall.h < w.endHour!;
}

/** Earliest datetime >= from, >= prev+delay, inside the day window — all
 *  interpreted in the window's own timezone (DST-safe). */
export function nextSendTime(from: Date, prevAt: Date | null, delayMs: number, w: SendWindow): Date {
  let t = from.getTime();
  if (prevAt) t = Math.max(t, prevAt.getTime() + delayMs);
  if (!hasActiveWindow(w)) return new Date(t);

  const tz = resolveTimezone(w.timezone);
  const out = new Date(t);
  const wall = wallParts(out, tz);
  const todayStart = wallToInstant({ y: wall.y, m: wall.m, d: wall.d, h: w.startHour!, min: 0, s: 0 }, tz);
  if (out < todayStart) return todayStart;
  if (isWithinWindow(out, w)) return out;
  // Past today's cutoff — roll to tomorrow's window start.
  return wallToInstant({ y: wall.y, m: wall.m, d: wall.d + 1, h: w.startHour!, min: 0, s: 0 }, tz);
}

export function formatWhen(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export async function markPaced(now = new Date()): Promise<void> {
  await pool.query(`UPDATE send_pace SET last_sent_at = $1 WHERE single = true`, [now]);
}

async function readPace(): Promise<Date> {
  const res = await pool.query(
    `INSERT INTO send_pace (single, last_sent_at) VALUES (true, now())
     ON CONFLICT (single) DO NOTHING
     RETURNING last_sent_at`
  );
  if (res.rowCount) return new Date(res.rows[0].last_sent_at);
  const row = await pool.query(`SELECT last_sent_at FROM send_pace WHERE single = true`);
  return new Date(row.rows[0].last_sent_at);
}

async function completeIdleCampaigns(q: PoolClient): Promise<void> {
  await q.query(
    `UPDATE campaigns SET status = 'completed'
     WHERE status = 'sending' AND NOT EXISTS (
       SELECT 1 FROM messages m
       WHERE m.campaign_id = campaigns.id AND m.direction = 'outbound' AND m.status = 'queued'
     )`
  );
}

let pumping = false;

let lastPurgedAt = 0;
const PURGE_INTERVAL_MS = 60 * 60 * 1000; // purge opted-out contacts at most once an hour

async function runPurge(client: PoolClient): Promise<void> {
  const now = Date.now();
  if (now - lastPurgedAt < PURGE_INTERVAL_MS) return;
  lastPurgedAt = now;
  const stats = await getOptOutStats(client);
  if (stats.eligible_contacts <= 0) return;
  const res = await purgeOptedOut(client);
  console.log(
    `[pump] purged ${res.contacts} opted-out contact(s) past ${stats.purge_days} days` +
      ` (messages: ${res.messages}, conversations: ${res.conversations}, appointments: ${res.appointments})`
  );
}

/** Result of a pump invocation. */
export interface PumpResult {
  sent: number;
  /** True when eligible due messages still exist (keep the cron ticking). */
  pending: boolean;
}

export interface PumpOptions {
  /** Max messages to send in this invocation (0 = unlimited). */
  cap?: number;
  /** Bounded worker mode: keep sending until this many ms since the start have
   *  elapsed, waiting out the pace floor between sends. Fits a serverless
   *  function + 1-min cron: it behaves like your local 5s worker, but hands
   *  control back once the invocation budget is spent. 0/undefined = one-shot. */
  runForMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Push a message's send_at to the start of the next delivery window (the day
 *  after if the window already passed today). Used by the per-contact daily cap
 *  and the per-campaign daily budget so capped messages aren't lost. */
async function deferToNextWindow(client: PoolClient, messageId: string, window: SendWindow): Promise<void> {
  const tz = resolveTimezone(window.timezone);
  const wall = wallParts(new Date(), tz);
  const tomorrowMidnight = wallToInstant(
    { y: wall.y, m: wall.m, d: wall.d + 1, h: 0, min: 0, s: 0 },
    tz
  );
  const deferred = nextSendTime(tomorrowMidnight, null, 0, window);
  await client.query(`UPDATE messages SET send_at = $1 WHERE id = $2`, [deferred, messageId]);
}

/** Sends queued outbound messages whose time has come, gated globally so
 *  nothing blasts across campaigns or across processes. With runForMs it acts
 *  as a bounded mini-worker: it waits for the pace floor between sends until
 *  the invocation budget is spent, then returns. */
export async function pumpOnce(opts: PumpOptions = {}): Promise<PumpResult> {
  if (pumping) return { sent: 0, pending: false };
  pumping = true;
  let client: PoolClient | null = null;
  let sent = 0;
  const deadline = (opts.runForMs || 0) > 0 ? Date.now() + opts.runForMs! : Infinity;
  try {
    client = await pool.connect();
    // Heartbeat + stall/failure-spike checks run on every tick, even when the
    // advisory lock is held by another pump instance.
    await pumpHealthTick(client);
    const locked = await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [PUMP_LOCK_KEY]);
    if (!locked.rows[0].ok) return { sent: 0, pending: false };

    const due = await client.query(
      `SELECT m.id, m.contact_id, m.campaign_id, m.body, m.send_at, m.variant_id,
              ct.phone, ct.opted_out, ct.consent_status, cm.min_delay_seconds,
              cm.send_start_hour, cm.send_end_hour, cm.timezone,
              cm.daily_cap, cm.daily_budget, cm.telnyx_profile_id
       FROM messages m
       JOIN contacts ct ON ct.id = m.contact_id
       JOIN campaigns cm ON cm.id = m.campaign_id
       WHERE m.direction = 'outbound' AND m.status = 'queued'
         AND m.send_at IS NOT NULL AND m.send_at <= now()
       ORDER BY m.send_at ASC, m.sent_at ASC`
    );

    if (due.rowCount === 0) {
      await runPurge(client);
      await completeIdleCampaigns(client);
      return { sent: 0, pending: false };
    }

    // Real sends made today (status sent/delivered), pre-loaded so the daily
    // cap (per phone) and daily budget (per campaign) lookups are free.
    const today = await client.query(
      `SELECT ct.phone AS phone, m.campaign_id AS cid, count(*)::int AS n
       FROM messages m JOIN contacts ct ON ct.id = m.contact_id
       WHERE m.direction = 'outbound' AND m.status IN ('sent','delivered')
         AND m.sent_at >= date_trunc('day', now())
       GROUP BY ct.phone, m.campaign_id`
    );
    const phoneToday = new Map<string, number>();
    const campaignToday = new Map<string, number>();
    for (const r of today.rows) {
      phoneToday.set(r.phone, (phoneToday.get(r.phone) ?? 0) + r.n);
      campaignToday.set(r.cid, (campaignToday.get(r.cid) ?? 0) + r.n);
    }

    let lastReal = await readPace();

    for (const row of due.rows) {
      if (Date.now() >= deadline - 500) break;

      // Skip if contact has since opted out — mark as failed so campaign can complete
      if (row.opted_out) {
        await client.query(`UPDATE messages SET status='failed', error_detail='skipped — contact opted out' WHERE id=$1`, [row.id]);
        continue;
      }
      // Consent gate — only send to contacts we have opt-in consent for.
      if (row.consent_status !== "opted_in") {
        await client.query(`UPDATE messages SET status='failed', error_detail='skipped — no consent' WHERE id=$1`, [row.id]);
        continue;
      }
      // Follow-ups (variant_id IS NULL) are suppressed if contact already replied inbound for this campaign
      if (row.variant_id == null && row.campaign_id) {
        const inbound = await client.query(
          `SELECT 1 FROM messages WHERE contact_id=$1 AND campaign_id=$2 AND direction='inbound' LIMIT 1`,
          [row.contact_id, row.campaign_id]
        );
        if ((inbound.rowCount ?? 0) > 0) {
          await client.query(`UPDATE messages SET status='failed', error_detail='skipped — contact replied; follow-up suppressed' WHERE id=$1`, [row.id]);
          continue;
        }
      }

      const delayMs = Math.max(0, Number(row.min_delay_seconds) || 0) * 1000;
      const window: SendWindow = {
        startHour: row.send_start_hour ?? null,
        endHour: row.send_end_hour ?? null,
        timezone: resolveTimezone(row.timezone),
      };

      // Per-contact daily cap — defer until the next window once the cap is hit.
      const dailyCap = Math.max(0, Number(row.daily_cap) || 0);
      if (dailyCap > 0 && (phoneToday.get(row.phone) ?? 0) >= dailyCap) {
        await deferToNextWindow(client, row.id, window);
        continue;
      }

      // Per-campaign daily budget — pauses the campaign once its day's quota is spent.
      const dailyBudget = Math.max(0, Number(row.daily_budget) || 0);
      if (dailyBudget > 0 && (campaignToday.get(row.campaign_id) ?? 0) >= dailyBudget) {
        await deferToNextWindow(client, row.id, window);
        console.log(`[pump] daily budget (${dailyBudget}) reached for campaign ${row.campaign_id} — deferring message`);
        continue;
      }

      // Global pace gate — never before the last real send + the delay floor.
      const earliest = new Date(lastReal.getTime() + delayMs);
      const now = new Date();
      if (now < earliest) {
        // Bounded-worker mode: wait out the floor within the invocation budget.
        const waitMs = earliest.getTime() - now.getTime();
        if (Date.now() + waitMs >= deadline - 500) break;
        await sleep(waitMs);
      }

      // Window guard at send time: a send outside the campaign's business hours
      // (in its own timezone) is held until the next window opens.
      if (!isWithinWindow(new Date(), window)) {
        const rescheduled = nextSendTime(new Date(), new Date(), delayMs, window);
        await client.query(`UPDATE messages SET send_at = $1 WHERE id = $2`, [rescheduled, row.id]);
        continue;
      }

      try {
        const result = await sendSms(row.phone, row.body, { profileId: row.telnyx_profile_id });
        await client.query(
          `UPDATE messages SET status = 'sent', telnyx_message_id = $1, error_detail = NULL, sent_at = now() WHERE id = $2`,
          [result.id, row.id]
        );
        sent++;
        phoneToday.set(row.phone, (phoneToday.get(row.phone) ?? 0) + 1);
        campaignToday.set(row.campaign_id, (campaignToday.get(row.campaign_id) ?? 0) + 1);
        await notePumpSent(client);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await client.query(
          `UPDATE messages SET status = 'failed', error_detail = $1, sent_at = now() WHERE id = $2`,
          [detail, row.id]
        );
      }
      if (opts.cap && sent >= opts.cap) break;
      lastReal = new Date();
      await markPaced(lastReal);
    }

    // Anything still queued and eligible to go right now? (cron should keep ticking)
    const pendingRes = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM messages m
         JOIN contacts ct ON ct.id = m.contact_id
         JOIN campaigns cm ON cm.id = m.campaign_id
         WHERE m.direction = 'outbound' AND m.status = 'queued'
           AND m.send_at IS NOT NULL AND m.send_at <= now()
           AND NOT ct.opted_out AND ct.consent_status = 'opted_in'
       ) AS pending`
    );
    const pending = pendingRes.rows[0]?.pending ?? false;

    await completeIdleCampaigns(client);
    await runPurge(client);
    return { sent, pending };
  } catch (err) {
    console.error("[pump] error:", err);
    return { sent, pending: false };
  } finally {
    if (client) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [PUMP_LOCK_KEY]);
      } catch {
        /* ignore */
      }
      client.release();
    }
    pumping = false;
  }
}

let started = false;

/** Idempotent: starts the pacing pump, which ticks while this process lives. */
export function startPump(): void {
  if (started) return;
  started = true;
  void pumpOnce();
  setInterval(() => {
    void pumpOnce();
  }, 12000);
}