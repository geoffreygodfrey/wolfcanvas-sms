import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { firstName } from "@/lib/personalize";
import { resolveTimezone } from "@/lib/timezone";
import { nextSendTime, windowLabel, type SendWindow, pumpOnce, startPump } from "@/lib/pump";

function renderTemplate(template: string, contactName: string): string {
  return template.replace(/\{\{\s*name\s*\}\}/g, firstName(contactName));
}

interface OutboundRow {
  contact_id: string;
  variant_id: string | null;
  phone: string;
  contact_name: string;
  message_template: string;
  variant_label: string;
}

interface PlanRow {
  contactId: string;
  contactName: string;
  phone: string;
  variantId: string | null;
  variantLabel: string;
  body: string;
  sendAt: Date;
  followUpId: string | null;
}

/** Compute every queued outbound (initial + follow-ups) without writing anything. */
function planOutbound(
  toSend: OutboundRow[],
  followUps: { id: string; delay_days: number; delay_hours: number; message_template: string }[],
  delayMs: number,
  window: SendWindow
): PlanRow[] {
  const plans: PlanRow[] = [];
  let prevAt: Date | null = null;

  for (const row of toSend) {
    const text = renderTemplate(row.message_template, row.contact_name);
    const sendAt = nextSendTime(new Date(), prevAt, delayMs, window);
    plans.push({
      contactId: row.contact_id,
      contactName: row.contact_name,
      phone: row.phone,
      variantId: row.variant_id,
      variantLabel: row.variant_label || "Initial",
      body: text,
      sendAt,
      followUpId: null,
    });
    prevAt = sendAt;

    for (const fu of followUps) {
      const offsetMs = (Number(fu.delay_days) * 24 + Number(fu.delay_hours)) * 3600 * 1000;
      if (offsetMs <= 0) continue;
      const base = new Date(sendAt.getTime() + offsetMs);
      const fuSendAt = nextSendTime(base, prevAt, delayMs, window);
      plans.push({
        contactId: row.contact_id,
        contactName: row.contact_name,
        phone: row.phone,
        variantId: null,
        variantLabel: "Follow-up",
        body: renderTemplate(fu.message_template, row.contact_name),
        sendAt: fuSendAt,
        followUpId: fu.id,
      });
      prevAt = fuSendAt;
    }
  }
  return plans;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  const campaign = await pool.query(
    `SELECT id, name, status, min_delay_seconds, send_start_hour, send_end_hour, timezone
     FROM campaigns WHERE id = $1`,
    [id]
  );
  if (campaign.rowCount === 0) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  const c = campaign.rows[0];
  const delayMs = Math.max(0, Number(c.min_delay_seconds) || 0) * 1000;
  const window: SendWindow = {
    startHour: c.send_start_hour ?? null,
    endHour: c.send_end_hour ?? null,
    timezone: resolveTimezone(c.timezone),
  };

  // Only contacts assigned to a variant are sent to; opted-out and non-consented
  // contacts are skipped.
  const toSend = await pool.query(
    `SELECT cc.contact_id, cc.variant_id, ct.phone, ct.name AS contact_name,
            v.message_template, v.label AS variant_label
     FROM campaign_contacts cc
     JOIN contacts ct ON ct.id = cc.contact_id
        AND ct.opted_out = false AND ct.consent_status = 'opted_in'
     JOIN campaign_variants v ON v.id = cc.variant_id
     WHERE cc.campaign_id = $1
     ORDER BY ct.name`,
    [id]
  );

  const counts = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE cc.variant_id IS NULL)::int AS unassigned,
       COUNT(*) FILTER (
         WHERE cc.variant_id IS NOT NULL AND ct.opted_out
       )::int AS opted_out,
       COUNT(*) FILTER (
         WHERE cc.variant_id IS NOT NULL
           AND NOT ct.opted_out AND ct.consent_status <> 'opted_in'
       )::int AS no_consent
     FROM campaign_contacts cc
     JOIN contacts ct ON ct.id = cc.contact_id
     WHERE cc.campaign_id = $1`,
    [id]
  );
  const opts = {
    skippedOptedOut: counts.rows[0].opted_out,
    skippedNoConsent: counts.rows[0].no_consent,
    unassigned: counts.rows[0].unassigned,
  };

  if (toSend.rows.length === 0) {
    return NextResponse.json({ campaign_id: id, queued: 0, ...opts });
  }

  const fuRes = await pool.query(
    `SELECT id, delay_days, delay_hours, message_template FROM campaign_follow_ups WHERE campaign_id=$1 AND enabled=true ORDER BY position ASC, created_at ASC`,
    [id]
  );
  const followUps = fuRes.rows as { id: string; delay_days: number; delay_hours: number; message_template: string }[];

  const plans = planOutbound(toSend.rows, followUps, delayMs, window);

  if (dryRun) {
    const initials = plans.filter((p) => !p.followUpId);
    const preview = initials.slice(0, 10).map((p) => ({
      contact_id: p.contactId,
      contact_name: p.contactName,
      phone: p.phone,
      variant_label: p.variantLabel,
      body: p.body,
      send_at: p.sendAt.toISOString(),
    }));
    return NextResponse.json({
      dry_run: true,
      campaign_id: id,
      total: initials.length,
      preview,
      min_delay_seconds: c.min_delay_seconds,
      window: windowLabel(window),
      ...opts,
    });
  }

  await pool.query(`UPDATE campaigns SET status = 'sending' WHERE id = $1`, [id]);

  let firstAt: Date | null = null;
  let lastAt: Date | null = null;
  let queued = 0;
  let queuedFollowUps = 0;

  for (const p of plans) {
    if (p.followUpId) {
      await pool.query(
        `INSERT INTO messages (contact_id, campaign_id, variant_id, follow_up_id, direction, body, status, send_at)
         VALUES ($1, $2, NULL, $3, 'outbound', $4, 'queued', $5)`,
        [p.contactId, id, p.followUpId, p.body, p.sendAt]
      );
      queuedFollowUps++;
    } else {
      await pool.query(
        `INSERT INTO messages (contact_id, campaign_id, variant_id, direction, body, status, send_at)
         VALUES ($1, $2, $3, 'outbound', $4, 'queued', $5)`,
        [p.contactId, id, p.variantId, p.body, p.sendAt]
      );
    }
    if (!firstAt) firstAt = p.sendAt;
    lastAt = p.sendAt;
    queued++;
  }

  // Start the background pump (it keeps running on its own interval too).
  startPump();
  void pumpOnce();

  return NextResponse.json({
    campaign_id: id,
    queued,
    queuedFollowUps,
    followUps: followUps.length,
    min_delay_seconds: c.min_delay_seconds,
    window: windowLabel(window),
    first_send_at: firstAt?.toISOString() ?? null,
    last_send_at: lastAt?.toISOString() ?? null,
    ...opts,
  });
}