import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const campaign = await pool.query(`SELECT 1 FROM campaigns WHERE id = $1`, [id]);
  if (campaign.rowCount === 0) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const result = await pool.query(
    `SELECT v.id, v.campaign_id, v.label, v.message_template, v.created_at,
            COUNT(cc.id)::int AS contact_count
     FROM campaign_variants v
     LEFT JOIN campaign_contacts cc ON cc.variant_id = v.id
     WHERE v.campaign_id = $1
     GROUP BY v.id, v.campaign_id, v.label, v.message_template, v.created_at
     ORDER BY v.label`,
    [id]
  );

  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const label = body.label?.trim();
  const message_template = body.message_template?.trim();

  if (!label || !message_template) {
    return NextResponse.json({ error: "Label and message template are required." }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `INSERT INTO campaign_variants (campaign_id, label, message_template)
       VALUES ($1, $2, $3)
       RETURNING id, campaign_id, label, message_template, created_at`,
      [id, label, message_template]
    );
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err: any) {
    if (err.code === "23505") {
      return NextResponse.json({ error: `A variant labeled "${label}" already exists.` }, { status: 409 });
    }
    if (err.code === "23503") {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to create variant." }, { status: 500 });
  }
}