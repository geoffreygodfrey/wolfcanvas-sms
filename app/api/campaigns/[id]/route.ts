import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveTimezone } from "@/lib/timezone";

const SELECT = `SELECT id, name, status, scheduled_at, ai_enabled, ai_system_prompt,
  min_delay_seconds, send_start_hour, send_end_hour, timezone,
  daily_cap, daily_budget, telnyx_profile_id, created_at`;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await pool.query(`${SELECT} FROM campaigns WHERE id = $1`, [id]);
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  return NextResponse.json({ ...result.rows[0], timezone: resolveTimezone(result.rows[0].timezone) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const cur = await pool.query(
    `SELECT name, status, scheduled_at, ai_enabled, ai_system_prompt,
       min_delay_seconds, send_start_hour, send_end_hour, timezone,
       daily_cap, daily_budget, telnyx_profile_id
     FROM campaigns WHERE id = $1`,
    [id]
  );
  if (cur.rowCount === 0) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  const old = cur.rows[0];

  const merged = {
    name: typeof body.name === "string" ? body.name : old.name,
    status: typeof body.status === "string" ? body.status : old.status,
    scheduled_at: "scheduled_at" in body ? (body.scheduled_at || null) : old.scheduled_at,
    ai_enabled: typeof body.ai_enabled === "boolean" ? body.ai_enabled : old.ai_enabled,
    ai_system_prompt:
      "ai_system_prompt" in body ? (body.ai_system_prompt?.trim() || null) : old.ai_system_prompt,
    min_delay_seconds:
      "min_delay_seconds" in body
        ? Math.max(0, Number(body.min_delay_seconds) || 0)
        : old.min_delay_seconds,
    send_start_hour:
      "send_start_hour" in body
        ? body.send_start_hour == null || body.send_start_hour === ""
          ? null
          : Number(body.send_start_hour)
        : old.send_start_hour,
    send_end_hour:
      "send_end_hour" in body
        ? body.send_end_hour == null || body.send_end_hour === ""
          ? null
          : Number(body.send_end_hour)
        : old.send_end_hour,
    timezone: "timezone" in body ? resolveTimezone(body.timezone) : resolveTimezone(old.timezone),
    daily_cap:
      "daily_cap" in body ? Math.max(0, Number(body.daily_cap) || 0) : Number(old.daily_cap) || 0,
    daily_budget:
      "daily_budget" in body
        ? Math.max(0, Number(body.daily_budget) || 0)
        : Number(old.daily_budget) || 0,
    telnyx_profile_id:
      "telnyx_profile_id" in body ? (body.telnyx_profile_id?.trim() || null) : old.telnyx_profile_id,
  };

  const result = await pool.query(
    `UPDATE campaigns SET
       name = $1, status = $2, scheduled_at = $3, ai_enabled = $4,
       ai_system_prompt = $5, min_delay_seconds = $6,
       send_start_hour = $7, send_end_hour = $8, timezone = $9,
       daily_cap = $10, daily_budget = $11, telnyx_profile_id = $12
     WHERE id = $13
     RETURNING ${SELECT.replace("SELECT ", "")}`,
    [
      merged.name,
      merged.status,
      merged.scheduled_at,
      merged.ai_enabled,
      merged.ai_system_prompt,
      merged.min_delay_seconds,
      merged.send_start_hour,
      merged.send_end_hour,
      merged.timezone,
      merged.daily_cap,
      merged.daily_budget,
      merged.telnyx_profile_id,
      id,
    ]
  );

  return NextResponse.json({ ...result.rows[0], timezone: resolveTimezone(result.rows[0].timezone) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await pool.query(`DELETE FROM campaigns WHERE id = $1`, [id]);

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}