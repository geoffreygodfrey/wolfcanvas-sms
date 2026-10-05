import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await pool.query(`SELECT 1 FROM campaigns WHERE id = $1`, [id]);
  if (campaign.rowCount === 0) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  const result = await pool.query(
    `SELECT id, campaign_id, position, delay_days, delay_hours, message_template, enabled, created_at
     FROM campaign_follow_ups WHERE campaign_id = $1 ORDER BY position ASC, created_at ASC`,
    [id]
  );
  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const message_template = body.message_template?.trim();
  const delay_days = body.delay_days != null ? Math.max(0, Number(body.delay_days)) : 1;
  const delay_hours = body.delay_hours != null ? Math.max(0, Math.min(23, Number(body.delay_hours))) : 0;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
  let position =
    body.position != null ? Math.max(1, Number(body.position)) : null;

  if (!message_template) {
    return NextResponse.json({ error: "Message template is required." }, { status: 400 });
  }
  if (delay_days === 0 && delay_hours === 0) {
    return NextResponse.json({ error: "Delay must be at least 1 hour." }, { status: 400 });
  }

  const campaign = await pool.query(`SELECT 1 FROM campaigns WHERE id = $1`, [id]);
  if (campaign.rowCount === 0) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  if (position == null) {
    const maxRes = await pool.query(`SELECT COALESCE(MAX(position),0)::int as m FROM campaign_follow_ups WHERE campaign_id=$1`, [id]);
    position = maxRes.rows[0].m + 1;
  }

  const result = await pool.query(
    `INSERT INTO campaign_follow_ups (campaign_id, position, delay_days, delay_hours, message_template, enabled)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, campaign_id, position, delay_days, delay_hours, message_template, enabled, created_at`,
    [id, position, delay_days, delay_hours, message_template, enabled]
  );
  return NextResponse.json(result.rows[0], { status: 201 });
}
