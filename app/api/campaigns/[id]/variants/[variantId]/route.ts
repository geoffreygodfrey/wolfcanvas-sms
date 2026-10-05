import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; variantId: string }> }) {
  const { id, variantId } = await params;
  const body = await req.json();
  const label = body.label?.trim();
  const message_template = body.message_template?.trim();

  if (!label || !message_template) {
    return NextResponse.json({ error: "Label and message template are required." }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE campaign_variants SET label = $1, message_template = $2
       WHERE id = $3 AND campaign_id = $4
       RETURNING id, campaign_id, label, message_template, created_at`,
      [label, message_template, variantId, id]
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Variant not found." }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      return NextResponse.json({ error: `A variant labeled "${label}" already exists.` }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to update variant." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; variantId: string }> }) {
  const { id, variantId } = await params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query(`SELECT 1 FROM campaign_variants WHERE id = $1 AND campaign_id = $2`, [variantId, id]);
    if (exists.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Variant not found." }, { status: 404 });
    }
    await client.query(`UPDATE campaign_contacts SET variant_id = NULL WHERE variant_id = $1`, [variantId]);
    await client.query(`UPDATE messages SET variant_id = NULL WHERE variant_id = $1`, [variantId]);
    await client.query(`DELETE FROM campaign_variants WHERE id = $1`, [variantId]);
    await client.query("COMMIT");
    return NextResponse.json({ deleted: true });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Failed to delete variant." }, { status: 500 });
  } finally {
    client.release();
  }
}