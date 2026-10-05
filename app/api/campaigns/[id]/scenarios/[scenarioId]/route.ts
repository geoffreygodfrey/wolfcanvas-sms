import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const SELECT = `SELECT id, campaign_id, label, keywords, reply_template, action, priority, enabled, created_at`;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; scenarioId: string }> }
) {
  const { id, scenarioId } = await params;
  const body = await req.json();

  const cur = await pool.query(
    `SELECT label, keywords, reply_template, action, priority, enabled
     FROM campaign_scenarios WHERE id = $1 AND campaign_id = $2`,
    [scenarioId, id]
  );
  if (cur.rowCount === 0) {
    return NextResponse.json({ error: "Scenario not found." }, { status: 404 });
  }
  const old = cur.rows[0];

  const merged = {
    label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : old.label,
    keywords: "keywords" in body ? (body.keywords?.trim() ?? "") : old.keywords,
    reply_template: "reply_template" in body ? (body.reply_template?.trim() ?? "") : old.reply_template,
    action: ["reply", "book", "opt_out", "none"].includes(body.action) ? body.action : old.action,
    priority:
      "priority" in body && Number.isFinite(Number(body.priority)) ? Number(body.priority) : old.priority,
    enabled: typeof body.enabled === "boolean" ? body.enabled : old.enabled,
  };

  const result = await pool.query(
    `UPDATE campaign_scenarios SET
       label = $1, keywords = $2, reply_template = $3, action = $4, priority = $5, enabled = $6
     WHERE id = $7 AND campaign_id = $8
     RETURNING ${SELECT.replace("SELECT ", "")}`,
    [
      merged.label,
      merged.keywords,
      merged.reply_template,
      merged.action,
      merged.priority,
      merged.enabled,
      scenarioId,
      id,
    ]
  );

  return NextResponse.json(result.rows[0]);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; scenarioId: string }> }
) {
  const { id, scenarioId } = await params;
  const result = await pool.query(
    `DELETE FROM campaign_scenarios WHERE id = $1 AND campaign_id = $2`,
    [scenarioId, id]
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Scenario not found." }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}