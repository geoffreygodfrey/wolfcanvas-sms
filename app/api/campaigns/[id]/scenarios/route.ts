import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const SELECT = `SELECT id, campaign_id, label, keywords, reply_template, action, priority, enabled, created_at`;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await pool.query(
    `${SELECT} FROM campaign_scenarios WHERE campaign_id = $1 ORDER BY priority ASC, created_at ASC`,
    [id]
  );
  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const label = body.label?.trim();
  if (!label) {
    return NextResponse.json({ error: "Scenario label is required." }, { status: 400 });
  }
  const action = ["reply", "book", "opt_out", "none"].includes(body.action) ? body.action : "reply";

  const result = await pool.query(
    `INSERT INTO campaign_scenarios (campaign_id, label, keywords, reply_template, action, priority, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${SELECT.replace("SELECT ", "")}`,
    [
      id,
      label,
      body.keywords?.trim() || "",
      body.reply_template?.trim() || "",
      action,
      Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100,
      body.enabled ?? true,
    ]
  );

  return NextResponse.json(result.rows[0], { status: 201 });
}