import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveTimezone } from "@/lib/timezone";
import { DEFAULT_SCENARIOS } from "@/lib/scenarios";

const SELECT = `SELECT id, name, status, scheduled_at, ai_enabled, ai_system_prompt,
  min_delay_seconds, send_start_hour, send_end_hour, timezone,
  daily_cap, daily_budget, telnyx_profile_id, created_at`;

export async function GET() {
  const result = await pool.query(`${SELECT} FROM campaigns ORDER BY created_at DESC`);
  return NextResponse.json(
    result.rows.map((r) => ({ ...r, timezone: resolveTimezone(r.timezone) }))
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    name,
    status,
    scheduled_at,
    ai_enabled,
    ai_system_prompt,
    min_delay_seconds,
    send_start_hour,
    send_end_hour,
    timezone,
    daily_cap,
    daily_budget,
    telnyx_profile_id,
    initialMessages,
    followUps,
  } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Campaign name is required." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO campaigns
       (name, status, scheduled_at, ai_enabled, ai_system_prompt,
        min_delay_seconds, send_start_hour, send_end_hour, timezone,
        daily_cap, daily_budget, telnyx_profile_id)
     VALUES ($1, COALESCE($2, 'draft'), $3, COALESCE($4, false), $5, $6, $7, $8, $9,
        COALESCE($10, 2), COALESCE($11, 0), $12)
     RETURNING id, name, status, scheduled_at, ai_enabled, ai_system_prompt,
       min_delay_seconds, send_start_hour, send_end_hour, timezone,
       daily_cap, daily_budget, telnyx_profile_id, created_at`,
      [
        name.trim(),
        status || null,
        scheduled_at || null,
        ai_enabled ?? null,
        ai_system_prompt?.trim() || null,
        min_delay_seconds != null ? Math.max(0, Number(min_delay_seconds)) : 10,
        send_start_hour == null || send_start_hour === "" ? null : Number(send_start_hour),
        send_end_hour == null || send_end_hour === "" ? null : Number(send_end_hour),
        resolveTimezone(timezone),
        daily_cap != null ? Math.max(0, Number(daily_cap)) : 2,
        daily_budget != null ? Math.max(0, Number(daily_budget)) : 0,
        telnyx_profile_id?.trim() || null,
      ]
    );

    const created = result.rows[0];

    // Seed the starter reply scenarios so every campaign opens with guardrails.
    for (const s of DEFAULT_SCENARIOS) {
      await client.query(
        `INSERT INTO campaign_scenarios (campaign_id, label, keywords, reply_template, action, priority, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [created.id, s.label, s.keywords, s.reply_template, s.action, s.priority, s.enabled]
      );
    }

    // Initial message variants (A/B) — supports full-page creation wizard
    if (Array.isArray(initialMessages)) {
      for (let i = 0; i < initialMessages.length; i++) {
        const m = initialMessages[i];
        const label = typeof m?.label === "string" ? m.label.trim() : "";
        const template = typeof m?.message_template === "string" ? m.message_template.trim() : "";
        if (!label || !template) continue;
        try {
          await client.query(
            `INSERT INTO campaign_variants (campaign_id, label, message_template) VALUES ($1,$2,$3)`,
            [created.id, label, template]
          );
        } catch (e: any) {
          if (e.code === "23505") {
            throw new Error(`Duplicate variant label "${label}"`);
          }
          throw e;
        }
      }
    }

    // Follow-ups
    if (Array.isArray(followUps)) {
      for (let i = 0; i < followUps.length; i++) {
        const f = followUps[i];
        const template = typeof f?.message_template === "string" ? f.message_template.trim() : "";
        if (!template) continue;
        const delay_days = f.delay_days != null ? Math.max(0, Number(f.delay_days)) : 1;
        const delay_hours = f.delay_hours != null ? Math.max(0, Math.min(23, Number(f.delay_hours))) : 0;
        if (delay_days === 0 && delay_hours === 0) continue;
        const position = f.position != null ? Math.max(1, Number(f.position)) : i + 1;
        const enabled = typeof f.enabled === "boolean" ? f.enabled : true;
        await client.query(
          `INSERT INTO campaign_follow_ups (campaign_id, position, delay_days, delay_hours, message_template, enabled)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [created.id, position, delay_days, delay_hours, template, enabled]
        );
      }
    }

    await client.query("COMMIT");
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: err.message || "Failed to create campaign." }, { status: 400 });
  } finally {
    client.release();
  }
}