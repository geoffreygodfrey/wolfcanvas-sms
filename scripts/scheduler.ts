import { pumpOnce } from "@/lib/pump";

/**
 * Standalone scheduled-delivery worker.
 *
 * Guarantees queued campaign messages actually go out even when the Next.js
 * server restarts or is idle — this process keeps draining the message queue
 * on its own timer. Safe to run alongside the app: a Postgres advisory lock
 * makes sure only one pump instance (web or worker) sends at a time.
 *
 * Usage:
 *   npm run scheduler
 * or via cron (every minute; the worker self-ticks on its own interval):
 *   * * * * * cd /path/to/sms-outreach-app && node --env-file=.env --import tsx scripts/scheduler.ts
 */

const TICK_MS = Number(process.env.SCHEDULER_TICK_MS ?? 5000);

let inFlight = false;
let lastLog = 0;

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await pumpOnce();
    const sent = res.sent;
    if (sent > 0 || res.pending || Date.now() - lastLog > 60_000) {
      console.log(`[scheduler] ${new Date().toISOString()} sent=${sent} pending=${res.pending}`);
      lastLog = Date.now();
    }
  } catch (err) {
    console.error("[scheduler] tick error:", err instanceof Error ? err.message : err);
    lastLog = Date.now();
  } finally {
    inFlight = false;
  }
}

console.log(`[scheduler] worker up — draining queue every ${TICK_MS}ms`);

setInterval(tick, TICK_MS);
void tick();