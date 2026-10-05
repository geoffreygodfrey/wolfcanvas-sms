import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const campaign = await pool.query(`SELECT 1 FROM campaigns WHERE id = $1`, [id]);
  if (campaign.rowCount === 0) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const result = await pool.query(
    `SELECT c.id, c.name, c.email, c.phone, c.consent_status, c.opted_out, c.created_at,
            cc.variant_id, v.label AS variant_label
     FROM contacts c
     LEFT JOIN campaign_contacts cc ON cc.contact_id = c.id AND cc.campaign_id = $1
     LEFT JOIN campaign_variants v ON v.id = cc.variant_id
     ORDER BY c.created_at DESC`,
    [id]
  );

  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const contactIds: string[] | undefined = body.contactIds;
  const variantId: string | null = body.variantId ?? null;

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return NextResponse.json({ error: "Select at least one contact." }, { status: 400 });
  }

  if (variantId) {
    const variant = await pool.query(`SELECT 1 FROM campaign_variants WHERE id = $1 AND campaign_id = $2`, [variantId, id]);
    if (variant.rowCount === 0) {
      return NextResponse.json({ error: "Variant not found in this campaign." }, { status: 400 });
    }

    await pool.query(
      `INSERT INTO campaign_contacts (campaign_id, contact_id, variant_id)
       SELECT $1, unnest($2::uuid[]), $3
       ON CONFLICT (campaign_id, contact_id)
       DO UPDATE SET variant_id = EXCLUDED.variant_id, added_at = now()`,
      [id, contactIds, variantId]
    );
  } else {
    await pool.query(
      `DELETE FROM campaign_contacts WHERE campaign_id = $1 AND contact_id = ANY($2::uuid[])`,
      [id, contactIds]
    );
  }

  return NextResponse.json({ updated: contactIds.length });
}