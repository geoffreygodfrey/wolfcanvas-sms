import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; followUpId: string }> }) {
  const { id, followUpId } = await params;
  const body = await req.json();

  const cur = await pool.query(`SELECT * FROM campaign_follow_ups WHERE id=$1 AND campaign_id=$2`, [followUpId, id]);
  if (cur.rowCount === 0) {
    return NextResponse.json({ error: "Follow-up not found." }, { status: 404 });
  }
  const old = cur.rows[0];

  const merged = {
    position: "position" in body ? Math.max(1, Number(body.position) || old.position) : old.position,
    delay_days: "delay_days" in body ? Math.max(0, Number(body.delay_days)) : old.delay_days,
    delay_hours: "delay_hours" in body ? Math.max(0, Math.min(23, Number(body.delay_hours))) : old.delay_hours,
    message_template: typeof body.message_template === "string" ? body.message_template.trim() || old.message_template : old.message_template,
    enabled: typeof body.enabled === "boolean" ? body.enabled : old.enabled,
  };

  if (!merged.message_template) {
    return NextResponse.json({ error: "Message template is required." }, { status: 400 });
  }
  if (merged.delay_days === 0 && merged.delay_hours === 0) {
    return NextResponse.json({ error: "Delay must be at least 1 hour." }, { status: 400 });
  }

  const result = await pool.query(
    `UPDATE campaign_follow_ups SET position=$1, delay_days=$2, delay_hours=$3, message_template=$4, enabled=$5
     WHERE id=$6 AND campaign_id=$7
     RETURNING id, campaign_id, position, delay_days, delay_hours, message_template, enabled, created_at`,
    [merged.position, merged.delay_days, merged.delay_hours, merged.message_template, merged.enabled, followUpId, id]
  );
  return NextResponse.json(result.rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; followUpId: string }> }) {
  const { id, followUpId } = await params;
  const result = await pool.query(`DELETE FROM campaign_follow_ups WHERE id=$1 AND campaign_id=$2`, [followUpId, id]);
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Follow-up not found." }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
